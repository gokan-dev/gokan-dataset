import fs from 'fs';
import path from 'path';
import kuromoji from 'kuromoji';
import type { GrammarExample, GrammarExampleWord, GrammarJlptIndex, GrammarPoint } from '../src/models/grammar.model';
import type { SearchIndex } from '../src/models/index.model';
import { locatePattern } from './grammar-pattern-matcher';

/**
 * Compiles the vendored hanabira.org-japanese-content grammar snapshot
 * (data/raw/grammar/*.json) into compiled/grammar/, resolving each example
 * sentence's content words against the already-compiled vocab dataset
 * (compiled/index/search.json) so the gokan-srs app can decide, at review
 * time, which words the user already knows.
 *
 * Kept as a separate, targeted pass (own lightweight kuromoji instance, not
 * chained into build:data) rather than folded into the main corpus build -
 * it only tokenizes ~800 short example sentences, not the whole sentence
 * corpus, and only needs the vocab search index to already exist.
 * Source: https://github.com/tristcoil/hanabira.org-japanese-content
 * (Creative Commons, attribution required).
 *
 * Run: `bun run build:grammar` (requires `bun run build:data` to have been
 * run at least once, so compiled/index/search.json exists).
 */

const RAW_DIR = './data/raw/grammar';
const SEARCH_INDEX_PATH = './compiled/index/search.json';
const OUTPUT_DIR = './compiled/grammar';
const FORMALITY_PATH = './data/raw/grammar/formality.json';

const LEVEL_FILES: Record<number, string> = {
    5: 'grammar_ja_N5_full_alphabetical_0001.json',
    4: 'grammar_ja_N4_full_alphabetical_0001.json',
    3: 'grammar_ja_N3_full_alphabetical_0001.json',
    2: 'grammar_ja_N2_full_alphabetical_0001.json',
    1: 'grammar_ja_N1_full_alphabetical_0001.json',
};

interface RawGrammarEntry {
    title: string;
    short_explanation: string;
    long_explanation: string;
    formation: string;
    examples: Array<{ jp: string; romaji: string; en: string }>;
}

/**
 * One entry of the hand-authored, reviewable formality.json mapping - see
 * docs/SCHEMA.md and the grammar-formality issue. `family` names the
 * near-synonym family this point belongs to (a stable slug + display name);
 * `relatedPoints` on the compiled GrammarPoint is DERIVED at build time from
 * every other entry sharing the same `family.id`, not hand-maintained per
 * point - a point only needs to know its own family, not enumerate every
 * sibling (which doesn't scale and drifts out of sync as siblings are added).
 */
interface FormalityEntry {
    formalityLevel?: GrammarPoint['formalityLevel'];
    usageNote?: string;
    family?: { id: string; name: string };
}
type FormalityMap = Record<string, FormalityEntry>;

// Content POS categories eligible to become a blank - particles, symbols, and
// auxiliary verbs are always shown literally (they carry the grammar
// construction itself, not a vocabulary item the user is being tested on).
const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞']);

function buildVocabLookup(searchIndex: SearchIndex) {
    const byWrittenForm = new Map<string, { id: string; r: string }>();
    const byReading = new Map<string, { id: string; r: string }>();

    for (const entry of searchIndex) {
        if (!byWrittenForm.has(entry.w)) byWrittenForm.set(entry.w, { id: entry.id, r: entry.r });
        if (!byReading.has(entry.r)) byReading.set(entry.r, { id: entry.id, r: entry.r });
    }

    return { byWrittenForm, byReading };
}

function katakanaToHiragana(input: string): string {
    return input.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * Splits the upstream title (e.g. "～けど、～ (〜kedo、～)") into the Japanese/
 * pattern portion and a romaji transliteration pulled out of a trailing
 * parenthetical, so the app can choose where to show which instead of the
 * two being welded into one string. Handles the messier real cases found by
 * scanning all 828 titles: nested parens (finds the OUTERMOST trailing pair
 * via depth tracking, not a naive non-greedy match), and full-width （） vs
 * half-width () mismatches (a normalized copy is used only to locate the
 * matching bracket indices - same length as the original since it's a 1:1
 * character swap, so those indices apply directly to the original string).
 * Falls back to the full original string as `title` with no `romaji` when
 * there's no trailing parenthetical to split (no parens at all, or one that
 * sits mid-string rather than at the end) - about 1.3% of points (11/828 as
 * of the last build) - rather than guessing at an unparseable shape.
 */
export function splitTitle(raw: string): { title: string; romaji?: string } {
    const trimmed = raw.trim();
    const normalized = trimmed.replace(/（/g, '(').replace(/）/g, ')');

    if (!normalized.endsWith(')')) return { title: trimmed };

    let depth = 0;
    let openIndex = -1;
    for (let i = normalized.length - 1; i >= 0; i--) {
        const ch = normalized[i];
        if (ch === ')') depth++;
        else if (ch === '(') {
            depth--;
            if (depth === 0) { openIndex = i; break; }
        }
    }
    if (openIndex === -1) return { title: trimmed }; // unbalanced parens - bail out safely

    const titlePart = trimmed.slice(0, openIndex).trim();
    const romajiPart = trimmed.slice(openIndex + 1, trimmed.length - 1).trim();
    if (!titlePart || !romajiPart) return { title: trimmed };

    return { title: titlePart, romaji: romajiPart };
}

function tokenizeExample(
    tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures>,
    lookup: ReturnType<typeof buildVocabLookup>,
    jp: string
): GrammarExampleWord[] {
    const tokens = tokenizer.tokenize(jp);
    const words: GrammarExampleWord[] = [];

    for (const token of tokens) {
        let match: { id: string; r: string } | undefined;

        if (CONTENT_POS.has(token.pos)) {
            match = lookup.byWrittenForm.get(token.surface_form) ?? lookup.byWrittenForm.get(token.basic_form);

            // Kana-only tokens (no kanji): also try a reading match, since they
            // won't appear under a kanji written form in the search index.
            if (!match && token.reading) {
                const hiraganaReading = katakanaToHiragana(token.reading);
                match = lookup.byReading.get(hiraganaReading);
            }
        }

        // kuromoji uses the literal string '*' as its "no base form" sentinel
        // (particles, symbols); only keep baseForm when it's a real, different form.
        const baseForm = token.basic_form && token.basic_form !== '*' && token.basic_form !== token.surface_form
            ? token.basic_form
            : undefined;

        words.push(match
            ? { surface: token.surface_form, vocabId: match.id, reading: match.r, baseForm }
            : { surface: token.surface_form, vocabId: null, baseForm }
        );
    }

    return words;
}

async function main() {
    console.log('📖 Building grammar dataset...');

    if (!fs.existsSync(SEARCH_INDEX_PATH)) {
        throw new Error(`Vocab search index not found at ${SEARCH_INDEX_PATH}. Run 'bun run build:data' first.`);
    }

    const searchIndex: SearchIndex = JSON.parse(fs.readFileSync(SEARCH_INDEX_PATH, 'utf-8'));
    const lookup = buildVocabLookup(searchIndex);

    // Optional - most points have no close synonym and simply won't appear in
    // this mapping. Points present get formalityLevel/usageNote/family merged
    // into their output; absent points build exactly as before.
    const formalityMap: FormalityMap = fs.existsSync(FORMALITY_PATH)
        ? JSON.parse(fs.readFileSync(FORMALITY_PATH, 'utf-8'))
        : {};

    // Group by family.id so `relatedPoints` can be derived rather than hand-
    // maintained, and so families.json can be emitted. Also catches a real
    // authoring mistake: the same family.id used with two different names.
    const familyMembers = new Map<string, { name: string; ids: string[] }>();
    for (const [id, entry] of Object.entries(formalityMap)) {
        if (!entry.family) continue;
        const existing = familyMembers.get(entry.family.id);
        if (existing) {
            if (existing.name !== entry.family.name) {
                throw new Error(
                    `formality.json: family id "${entry.family.id}" used with two different names ` +
                    `("${existing.name}" vs "${entry.family.name}" on ${id}) - pick one.`
                );
            }
            existing.ids.push(id);
        } else {
            familyMembers.set(entry.family.id, { name: entry.family.name, ids: [id] });
        }
    }

    const tokenizer = await new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>((resolve, reject) => {
        kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => {
            if (err) reject(err);
            else resolve(t);
        });
    });

    const pointsDir = path.join(OUTPUT_DIR, 'points');
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(pointsDir, { recursive: true });

    const index: GrammarJlptIndex = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    let totalPoints = 0;
    let totalWords = 0;
    let matchedWords = 0;
    let totalExamples = 0;
    let examplesAnchored = 0;
    const pointsWithNoAnchor: string[] = [];
    let pointsWithFormality = 0;
    const seenIds = new Set<string>();
    const pointsWithNoTitleRomaji: string[] = [];

    for (const [levelStr, filename] of Object.entries(LEVEL_FILES)) {
        const level = Number(levelStr);
        const raw: RawGrammarEntry[] = JSON.parse(fs.readFileSync(path.join(RAW_DIR, filename), 'utf-8'));
        const levelSlug = `n${level}`;

        raw.forEach((entry, i) => {
            const id = `${levelSlug}-${String(i + 1).padStart(3, '0')}`;
            let pointAnchored = false;

            const examples: GrammarExample[] = entry.examples.map(ex => {
                const words = tokenizeExample(tokenizer, lookup, ex.jp);
                totalWords += words.length;
                matchedWords += words.filter(w => w.vocabId !== null).length;

                totalExamples++;
                const hit = locatePattern(entry.formation, words);
                if (hit) { examplesAnchored++; pointAnchored = true; }

                return { jp: ex.jp, romaji: ex.romaji, en: ex.en, words, patternWordIndices: hit ?? [] };
            });

            if (!pointAnchored) pointsWithNoAnchor.push(`${id}: ${entry.formation}`);

            seenIds.add(id);
            const formality = formalityMap[id];
            if (formality) pointsWithFormality++;

            const family = formality?.family
                ? {
                    id: formality.family.id,
                    name: formality.family.name,
                    relatedPoints: (familyMembers.get(formality.family.id)?.ids ?? []).filter(memberId => memberId !== id),
                }
                : undefined;

            const { title, romaji } = splitTitle(entry.title);
            if (!romaji) pointsWithNoTitleRomaji.push(`${id}: ${entry.title}`);

            const point: GrammarPoint = {
                id,
                title,
                ...(romaji ? { romaji } : {}),
                jlptLevel: level,
                shortExplanation: entry.short_explanation,
                longExplanation: entry.long_explanation,
                formation: entry.formation,
                examples,
                ...(formality?.formalityLevel ? { formalityLevel: formality.formalityLevel } : {}),
                ...(formality?.usageNote ? { usageNote: formality.usageNote } : {}),
                ...(family ? { family } : {}),
            };

            fs.writeFileSync(path.join(pointsDir, `${id}.json`), JSON.stringify(point));
            index[level].push(id);
            totalPoints++;
        });

        console.log(`   - N${level}: ${raw.length} grammar points`);
    }

    fs.mkdirSync(path.join(OUTPUT_DIR, 'index'), { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index', 'jlpt.json'), JSON.stringify(index));

    const familiesIndex: Record<string, { name: string; memberIds: string[] }> = {};
    for (const [familyId, { name, ids }] of familyMembers) {
        familiesIndex[familyId] = { name, memberIds: ids };
    }
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index', 'families.json'), JSON.stringify(familiesIndex));

    console.log(`✅ Grammar dataset written to ${OUTPUT_DIR}`);
    console.log(`   - Grammar points: ${totalPoints}`);
    console.log(`   - Words tokenized: ${totalWords} (${matchedWords} resolved to a vocab id, ${(100 * matchedWords / totalWords).toFixed(1)}%)`);
    console.log(`   - Pattern located: ${totalPoints - pointsWithNoAnchor.length}/${totalPoints} points (${(100 * (totalPoints - pointsWithNoAnchor.length) / totalPoints).toFixed(1)}%), ${examplesAnchored}/${totalExamples} examples (${(100 * examplesAnchored / totalExamples).toFixed(1)}%)`);
    console.log(`   - Formality metadata: ${pointsWithFormality}/${totalPoints} points (from ${FORMALITY_PATH})`);
    console.log(`   - Families: ${familyMembers.size} (${[...familyMembers.values()].reduce((n, f) => n + f.ids.length, 0)} points total)`);
    console.log(`   - Title/romaji split: ${totalPoints - pointsWithNoTitleRomaji.length}/${totalPoints} points (${(100 * (totalPoints - pointsWithNoTitleRomaji.length) / totalPoints).toFixed(1)}%)`);

    if (pointsWithNoTitleRomaji.length > 0) {
        console.warn(`⚠️  ${pointsWithNoTitleRomaji.length} points had no trailing-parenthetical romaji to split out of their title (kept as-is):`);
        pointsWithNoTitleRomaji.forEach(s => console.warn(`     ${s}`));
    }

    const staleFormalityIds = Object.keys(formalityMap).filter(id => !seenIds.has(id));
    if (staleFormalityIds.length > 0) {
        // Loud, not silent: a typo'd id in formality.json would otherwise silently
        // never apply and nobody would notice.
        console.warn(`⚠️  ${staleFormalityIds.length} id(s) in ${FORMALITY_PATH} don't match any built grammar point (typo?): ${staleFormalityIds.join(', ')}`);
    }

    if (pointsWithNoAnchor.length > 0) {
        // Loud, not silent: any point where the pattern couldn't be located in a
        // SINGLE example (of the ones it has) gets logged, so it stays visible
        // and reviewable rather than quietly degrading to a vocab-only quiz at
        // runtime. See docs/SCHEMA.md and the grammar-pattern-location issue.
        console.warn(`⚠️  ${pointsWithNoAnchor.length} points have NO example with a located pattern:`);
        pointsWithNoAnchor.forEach(s => console.warn(`     ${s}`));
    }
}

// Guarded so `splitTitle` can be imported for unit testing (build-grammar.test.ts)
// without triggering the full build pipeline (kuromoji, the vocab search index,
// raw data files) as an import-time side effect.
if (import.meta.main) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
