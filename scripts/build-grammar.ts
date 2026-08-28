import fs from 'fs';
import path from 'path';
import kuromoji from 'kuromoji';
import type { GrammarExample, GrammarExampleWord, GrammarJlptIndex, GrammarPoint } from '../src/models/grammar.model';
import type { SearchIndex } from '../src/models/index.model';
import { locatePattern } from './grammar-pattern-matcher';
import { SentenceTokenizer } from '../src/utils/tokenizer';

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
const DUPLICATES_PATH = './data/raw/grammar/duplicates.json';
const KINDS_PATH = './data/raw/grammar/kinds.json';

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
    /**
     * What this member adds over its family siblings, which is what decides
     * whether they may be taught together - see docs/SCHEMA.md and the
     * grammar-axis issue:
     *  - 'register'   differs ONLY by formality. No new structure, so these
     *                 group across JLPT levels (だが N2 belongs beside でも N5).
     *  - 'constraint' adds a semantic restriction the learner can get wrong
     *                 (おかげで is positive-only, ばかりに negative-only).
     *                 Stays level-gated.
     *  - 'variant'    no differentiator exists at all; the siblings are
     *                 interchangeable stylistic choices. Taught as one
     *                 recognition set, not as N independent points.
     */
    axis?: 'register' | 'constraint' | 'variant';
}
type FormalityMap = Record<string, FormalityEntry>;

/**
 * One entry of the hand-authored duplicates.json mapping: a point id that is
 * the same pattern as `canonical`, ingested twice from the upstream
 * alphabetical files (usually at two different JLPT levels). The duplicate is
 * NOT emitted to compiled/grammar/points/, and its id is published in
 * index/aliases.json so consumers holding stored progress against it can
 * migrate rather than stranding it.
 *
 * `canonical` is the member a learner meets FIRST - the easiest level, i.e.
 * the HIGHEST jlptLevel (5 = N5). Chains are resolved when the file is
 * authored, so no canonical is itself a duplicate; the build asserts that.
 */
interface DuplicateEntry {
    canonical: string;
    note: string;
}
type DuplicateMap = Record<string, DuplicateEntry>;

/**
 * One entry of the hand-authored kinds.json mapping. Only points that are NOT
 * plain constructions appear; everything absent defaults to 'construction'.
 *
 * The discriminating test is about the ANSWER KEY, not about the text - see
 * docs/SCHEMA.md. It cannot be detected mechanically: signals like "the located
 * pattern includes a conjugated word" fire on 386 of 788 points, because most
 * Japanese grammar attaches to a conjugated word. Presupposing a form is not the
 * same as teaching one.
 */
interface KindEntry {
    kind: 'construction' | 'inflection' | 'lexical';
    /** For 'inflection': which derivation this point teaches, e.g. "て-form". */
    derives?: string;
    note?: string;
}
type KindMap = Record<string, KindEntry>;

// Content POS categories eligible to become a blank - particles, symbols, and
// auxiliary verbs are always shown literally (they carry the grammar
// construction itself, not a vocabulary item the user is being tested on).
const CONTENT_POS = new Set(['名詞', '動詞', '形容詞', '副詞']);

export function buildVocabLookup(searchIndex: SearchIndex) {
    const byWrittenForm = new Map<string, { id: string; r: string }>();
    const byReading = new Map<string, { id: string; r: string }>();
    // Readings claimed by more than one distinct written form. A reading match on
    // an ambiguous reading is a coin flip between homophones, and the index is
    // frequency-ordered, so "first wins" silently picks the commonest homophone -
    // which is how あり (the stem of ある) came to be linked to 蟻 "ant".
    const ambiguousReadings = new Set<string>();

    for (const entry of searchIndex) {
        if (!byWrittenForm.has(entry.w)) byWrittenForm.set(entry.w, { id: entry.id, r: entry.r });

        const existing = byReading.get(entry.r);
        if (!existing) byReading.set(entry.r, { id: entry.id, r: entry.r });
        else if (existing.id !== entry.id) ambiguousReadings.add(entry.r);
    }

    return { byWrittenForm, byReading, ambiguousReadings };
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

/** kuromoji tokens annotated with their character-offset span in the original sentence. */
interface SpannedToken {
    token: kuromoji.IpadicFeatures;
    start: number;
    end: number;
}

function spanTokens(tokens: kuromoji.IpadicFeatures[]): SpannedToken[] {
    let offset = 0;
    return tokens.map(token => {
        const start = offset;
        offset += token.surface_form.length;
        return { token, start, end: offset };
    });
}

/** Builds a single per-kuromoji-token GrammarExampleWord, the fallback for text a sentence-match didn't cover. */
const KANA_ONLY = /^[ぁ-ゟ゠-ヿー]+$/;

/**
 * Resolves one kuromoji token to a vocab entry, or to null.
 *
 * Null is a perfectly good answer: an unlinked word is rendered literally, is
 * never turned into a blank, and is never clickable - so precision matters far
 * more than coverage here. A WRONG link is actively harmful, because
 * `useGrammarOrchestration` feeds positive SRS credit to the linked vocabId when
 * its blank is answered correctly: a mislinked word silently trains the wrong
 * entry in the learner's vocab queue.
 *
 * The reading fallback below used to fire for any token that missed a
 * written-form match, which produced systematically wrong links - 25.4% of all
 * links were a kana surface resolved to a kanji entry, including あり -> 蟻
 * ("ant", the reported bug), なく -> 泣く ("to cry"), なり -> 鳴り ("ringing"),
 * し -> 死 ("death") and する -> 擦る ("to rub"). Two guards now apply:
 *
 *  1. Never look up a CONJUGATED surface's reading as if it were a dictionary
 *     word. あり's reading is あり, but あり is not a word - ある is. Only the
 *     dictionary form's own reading is looked up.
 *  2. Never accept an AMBIGUOUS reading. Several entries sharing a reading means
 *     the frequency-ordered index would just hand back the commonest homophone.
 */
function wordFromToken(token: kuromoji.IpadicFeatures, lookup: ReturnType<typeof buildVocabLookup>): GrammarExampleWord {
    let match: { id: string; r: string } | undefined;

    if (CONTENT_POS.has(token.pos)) {
        match = lookup.byWrittenForm.get(token.surface_form) ?? lookup.byWrittenForm.get(token.basic_form);

        if (!match) {
            const hasBase = token.basic_form && token.basic_form !== '*';
            const isInflected = hasBase && token.basic_form !== token.surface_form;
            // Short inflected kana fragments are where kuromoji's analysis is
            // least reliable, and a wrong basic_form sends the match to an
            // unrelated lexeme: すれ (する's conditional stem) is analysed as a
            // form of 擦れる "to chafe", せれ as 競る "to compete", てら as 照る
            // "to shine". Requiring 3+ characters drops those while keeping real
            // inflections like わから -> 分かる.
            const tooShortToTrust = isInflected && token.surface_form.length < 3;
            // A kana dictionary form is its own reading, so this reaches entries
            // stored under a kanji written form (あります -> あり, base ある).
            const dictionaryReading = tooShortToTrust ? null
                : hasBase && KANA_ONLY.test(token.basic_form)
                ? token.basic_form
                // Otherwise only an uninflected kana token may be looked up by
                // its reading (いつも, かたわら).
                : (KANA_ONLY.test(token.surface_form) && token.basic_form === token.surface_form && token.reading)
                    ? katakanaToHiragana(token.reading)
                    : null;

            if (dictionaryReading && !lookup.ambiguousReadings.has(dictionaryReading)) {
                match = lookup.byReading.get(dictionaryReading);
            }
        }
    }

    // kuromoji uses the literal string '*' as its "no base form" sentinel
    // (particles, symbols); only keep baseForm when it's a real, different form.
    const baseForm = token.basic_form && token.basic_form !== '*' && token.basic_form !== token.surface_form
        ? token.basic_form
        : undefined;

    return match
        ? { surface: token.surface_form, vocabId: match.id, reading: match.r, baseForm }
        : { surface: token.surface_form, vocabId: null, baseForm };
}

/**
 * Tokenizes one example sentence and resolves each word against the compiled
 * vocab dataset, reusing `gokan-dataset`'s own sentence-matching pipeline
 * (`SentenceTokenizer`, the same one vocab's `compiled/sentences/*.json` is
 * built with - see `build-data.ts`) instead of grammar's own earlier
 * per-token-only lookup. That earlier approach only matched a token's bare
 * surface/base form one at a time, missing multi-token compounds (顰蹙を買う)
 * and conjugation-aware deinflection (かい→買う) the same way vocab sentences
 * already handled - grammar's word-linking quality was needlessly worse than
 * vocab's for no reason other than not sharing the pipeline. Reusing it here
 * closes that gap and keeps the two activities' "click a word to see its
 * vocab entry" experience consistent, per the project's "minimize duplicated
 * UX/logic between quiz types" principle (mirrors `useQuizFocusManagement`
 * and `SRSHistoryGraph` being shared rather than reimplemented per activity).
 *
 * `SentenceTokenizer.extractMatches` returns matches keyed by DICTIONARY term
 * (not necessarily the literal surface text - a conjugated span like
 * "くれました" is returned under the key "くれる"), with character-offset
 * `start`/`length` spans into `jp` (possibly covering several kuromoji tokens
 * at once, e.g. a compound or a verb + its trailing auxiliary chain). Matches
 * are resolved to a vocabId via the SAME `lookup.byWrittenForm` grammar
 * already builds from `compiled/index/search.json` - no new vocab index is
 * needed. `GrammarExampleWord[]` still needs one entry per contiguous
 * surface slice (not an offset map, unlike vocab's `Sentence.matches`) so
 * `words[].map(w => w.surface).join('')` keeps reconstructing `jp` exactly
 * and `grammar-pattern-matcher.ts`'s span-based matching keeps working
 * unchanged - accepted sentence-matches become ONE merged word entry each
 * (spanning what was previously several kuromoji tokens), and any text a
 * match didn't cover falls back to the original per-kuromoji-token entries.
 *
 * A sentence-match is only accepted if at least one of the kuromoji tokens
 * it spans has a content POS tag (`CONTENT_POS`) - preserves the existing
 * "particles/symbols always stay literal, never a blank candidate" guarantee
 * even though `SentenceTokenizer` itself has no POS awareness (it matches
 * purely against the vocab surface-form set, which does include some
 * particle/conjunction JMDict entries).
 *
 * One real tension worth documenting rather than silently accepting: this
 * merging is actively BAD for `grammar-pattern-matcher.ts`'s pattern-marker
 * discovery, which wants maximally FINE-grained tokens so its multi-token
 * span search can find arbitrary `formation` substrings - a formation
 * literal like "ずにはいられない" can no longer be found once those characters
 * get swallowed into one large merged word (e.g. a verb match's trailing
 * auxiliary-chain absorption; `SentenceTokenizer`'s own look-ahead extension
 * for verb/adjective conjugations - see its doc comment). Measured directly:
 * running `locatePattern` against the merged output regressed pattern
 * coverage from 99.9%/98.1% to 98.9%/94.6% (8 more points losing their
 * anchor). Fixed by NOT accepting that regression - `locatePattern` runs
 * against a separate fine-grained, one-word-per-kuromoji-token array (same
 * granularity as before this change), and the resulting indices are mapped
 * onto the merged output afterward via `fineToMerged` (every original token
 * index a merged word absorbed maps to that merged word's index). This
 * keeps both properties: full pattern-location accuracy AND compound/
 * conjugation-aware vocab linking, rather than trading one for the other.
 */
export function buildExampleWords(
    tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures>,
    sentenceTokenizer: SentenceTokenizer,
    vocabSet: Set<string>,
    lookup: ReturnType<typeof buildVocabLookup>,
    jp: string,
    formation: string
): { words: GrammarExampleWord[]; patternWordIndices: number[] } {
    const spanned = spanTokens(tokenizer.tokenize(jp));

    // Fine-grained pass, purely to feed locatePattern - see doc comment.
    const fineWords = spanned.map(st => wordFromToken(st.token, lookup));
    const fineHit = locatePattern(formation, fineWords) ?? [];

    const rawMatches = sentenceTokenizer.extractMatches(jp, vocabSet);
    const candidates: { term: string; start: number; length: number; reading?: string }[] = [];
    for (const [term, occurrences] of Object.entries(rawMatches)) {
        for (const m of occurrences) candidates.push({ term, ...m });
    }

    // Keep only matches covering at least one content-POS token - see doc comment.
    const eligible = candidates.filter(m => {
        const end = m.start + m.length;
        return spanned.some(st => st.start < end && st.end > m.start && CONTENT_POS.has(st.token.pos));
    });

    // Overlap resolution, mirroring build-data.ts's vocab sentence pipeline exactly:
    // longest span wins, ties broken by longer literal term, then earliest first.
    eligible.sort((a, b) => b.length - a.length || b.term.length - a.term.length);
    const accepted: typeof eligible = [];
    for (const m of eligible) {
        const mEnd = m.start + m.length;
        const overlaps = accepted.some(a => m.start < a.start + a.length && mEnd > a.start);
        if (!overlaps) accepted.push(m);
    }
    accepted.sort((a, b) => a.start - b.start);

    const words: GrammarExampleWord[] = [];
    // Maps an original (fine-grained) token index to the index in `words[]` it
    // ended up merged into - lets a fine-grained patternWordIndices hit be
    // translated onto the merged output below.
    const fineToMerged = new Map<number, number>();
    let cursor = 0;

    const emitGap = (from: number, to: number) => {
        spanned.forEach((st, fineIndex) => {
            if (st.start >= from && st.end <= to) {
                fineToMerged.set(fineIndex, words.length);
                words.push(wordFromToken(st.token, lookup));
            }
        });
    };

    for (const m of accepted) {
        emitGap(cursor, m.start);

        const surface = jp.slice(m.start, m.start + m.length);
        const resolved = lookup.byWrittenForm.get(m.term);
        // baseForm only when the matched dictionary term differs from the actual
        // surface text (e.g. surface "くれました" matched under term "くれる") -
        // a compound match's term already equals its surface, so no baseForm needed.
        const baseForm = m.term !== surface ? m.term : undefined;

        const mergedIndex = words.length;
        spanned.forEach((st, fineIndex) => {
            if (st.start >= m.start && st.end <= m.start + m.length) fineToMerged.set(fineIndex, mergedIndex);
        });

        words.push(resolved
            ? { surface, vocabId: resolved.id, reading: m.reading ?? resolved.r, baseForm }
            : { surface, vocabId: null, baseForm });

        cursor = m.start + m.length;
    }
    emitGap(cursor, jp.length);

    const patternWordIndices = Array.from(new Set(
        fineHit.map(i => fineToMerged.get(i)).filter((i): i is number => i !== undefined)
    )).sort((a, b) => a - b);

    return { words, patternWordIndices };
}

async function main() {
    console.log('📖 Building grammar dataset...');

    if (!fs.existsSync(SEARCH_INDEX_PATH)) {
        throw new Error(`Vocab search index not found at ${SEARCH_INDEX_PATH}. Run 'bun run build:data' first.`);
    }

    const searchIndex: SearchIndex = JSON.parse(fs.readFileSync(SEARCH_INDEX_PATH, 'utf-8'));
    const lookup = buildVocabLookup(searchIndex);
    // Written forms only (matches build-data.ts's own vocabSet for its sentence
    // pipeline) - SentenceTokenizer matches literal surface text, not readings.
    const vocabSet = new Set(lookup.byWrittenForm.keys());

    // Optional - most points have no close synonym and simply won't appear in
    // this mapping. Points present get formalityLevel/usageNote/family merged
    // into their output; absent points build exactly as before.
    const formalityMap: FormalityMap = fs.existsSync(FORMALITY_PATH)
        ? JSON.parse(fs.readFileSync(FORMALITY_PATH, 'utf-8'))
        : {};

    // Optional too - an empty/absent file simply means nothing is deduplicated.
    const duplicateMap: DuplicateMap = fs.existsSync(DUPLICATES_PATH)
        ? JSON.parse(fs.readFileSync(DUPLICATES_PATH, 'utf-8'))
        : {};
    const droppedIds = new Set(Object.keys(duplicateMap));

    // Keys beginning with '_' are documentation, not point ids.
    const kindMapRaw: Record<string, unknown> = fs.existsSync(KINDS_PATH)
        ? JSON.parse(fs.readFileSync(KINDS_PATH, 'utf-8'))
        : {};
    const kindMap: KindMap = Object.fromEntries(
        Object.entries(kindMapRaw).filter(([key]) => !key.startsWith('_'))
    ) as KindMap;

    // A canonical that is itself dropped would leave consumers chasing an alias
    // to a point that doesn't exist. Chains must be collapsed when the file is
    // authored, so this is a hard error rather than a silent re-resolve.
    for (const [dupId, entry] of Object.entries(duplicateMap)) {
        if (droppedIds.has(entry.canonical)) {
            throw new Error(
                `duplicates.json: "${dupId}" points at canonical "${entry.canonical}", which is itself ` +
                `listed as a duplicate. Collapse the chain so every canonical is a surviving point.`
            );
        }
        if (dupId === entry.canonical) {
            throw new Error(`duplicates.json: "${dupId}" is listed as its own canonical.`);
        }
    }

    // Group by family.id so `relatedPoints` can be derived rather than hand-
    // maintained, and so families.json can be emitted. Also catches a real
    // authoring mistake: the same family.id used with two different names.
    // Dropped duplicates are excluded up front, so no family ever lists a
    // member that was never written.
    const familyMembers = new Map<string, { name: string; ids: string[] }>();
    for (const [id, entry] of Object.entries(formalityMap)) {
        if (!entry.family) continue;
        if (droppedIds.has(id)) continue;
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
    const sentenceTokenizer = new SentenceTokenizer(tokenizer);

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
    let droppedForDuplicate = 0;
    const seenIds = new Set<string>();
    // Every id the raw files produce, including dropped duplicates - lets the
    // build tell "typo in duplicates.json" apart from "correctly dropped".
    const allRawIds = new Set<string>();
    const pointsWithNoTitleRomaji: string[] = [];

    for (const [levelStr, filename] of Object.entries(LEVEL_FILES)) {
        const level = Number(levelStr);
        const raw: RawGrammarEntry[] = JSON.parse(fs.readFileSync(path.join(RAW_DIR, filename), 'utf-8'));
        const levelSlug = `n${level}`;

        raw.forEach((entry, i) => {
            const id = `${levelSlug}-${String(i + 1).padStart(3, '0')}`;
            allRawIds.add(id);

            // Dropped duplicate: not emitted, not indexed. Ids stay positional
            // (derived from the raw file index), so dropping one NEVER renumbers
            // the survivors - the id space just becomes sparse. That's a
            // guarantee consumers depend on, since they store these ids against
            // user progress; see docs/SCHEMA.md.
            if (droppedIds.has(id)) {
                droppedForDuplicate++;
                return;
            }

            let pointAnchored = false;

            const examples: GrammarExample[] = entry.examples.map(ex => {
                const { words, patternWordIndices } = buildExampleWords(tokenizer, sentenceTokenizer, vocabSet, lookup, ex.jp, entry.formation);
                totalWords += words.length;
                matchedWords += words.filter(w => w.vocabId !== null).length;

                totalExamples++;
                if (patternWordIndices.length > 0) { examplesAnchored++; pointAnchored = true; }

                return { jp: ex.jp, romaji: ex.romaji, en: ex.en, words, patternWordIndices };
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
                    ...(formality.axis ? { axis: formality.axis } : {}),
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
                // Absent from kinds.json means a plain construction - the vast
                // majority - so the default is applied here rather than
                // requiring an entry for all 788 points.
                kind: kindMap[id]?.kind ?? 'construction',
                ...(kindMap[id]?.derives ? { derives: kindMap[id]!.derives } : {}),
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

    // Aliases: dropped duplicate id -> the surviving canonical. Published so a
    // consumer holding stored progress against a dropped id can transfer it
    // instead of stranding an item it can no longer load. Kept as its own file
    // (not folded into a point) precisely because the dropped point has no file.
    const aliases: Record<string, string> = {};
    for (const [dupId, entry] of Object.entries(duplicateMap)) aliases[dupId] = entry.canonical;
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index', 'aliases.json'), JSON.stringify(aliases));

    // id -> kind, for consumers that need to filter the introduction pipeline by
    // kind without fetching all 788 point files just to read one field.
    const kindsIndex: Record<string, string> = {};
    for (const id of seenIds) kindsIndex[id] = kindMap[id]?.kind ?? 'construction';
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index', 'kinds.json'), JSON.stringify(kindsIndex));

    console.log(`✅ Grammar dataset written to ${OUTPUT_DIR}`);
    console.log(`   - Grammar points: ${totalPoints}`);
    console.log(`   - Words tokenized: ${totalWords} (${matchedWords} resolved to a vocab id, ${(100 * matchedWords / totalWords).toFixed(1)}%)`);
    console.log(`   - Pattern located: ${totalPoints - pointsWithNoAnchor.length}/${totalPoints} points (${(100 * (totalPoints - pointsWithNoAnchor.length) / totalPoints).toFixed(1)}%), ${examplesAnchored}/${totalExamples} examples (${(100 * examplesAnchored / totalExamples).toFixed(1)}%)`);
    console.log(`   - Formality metadata: ${pointsWithFormality}/${totalPoints} points (from ${FORMALITY_PATH})`);
    console.log(`   - Duplicates dropped: ${droppedForDuplicate} (aliased in index/aliases.json, from ${DUPLICATES_PATH})`);
    const kindCounts = { construction: 0, inflection: 0, lexical: 0 } as Record<string, number>;
    for (const id of seenIds) kindCounts[kindMap[id]?.kind ?? 'construction']++;
    console.log(`   - Point kinds: ${kindCounts.construction} construction, ${kindCounts.inflection} inflection, ${kindCounts.lexical} lexical (from ${KINDS_PATH})`);

    const staleKindIds = Object.keys(kindMap).filter(id => !seenIds.has(id) && !droppedIds.has(id));
    if (staleKindIds.length > 0) {
        throw new Error(`kinds.json names ${staleKindIds.length} id(s) that no grammar point was built for: ${staleKindIds.join(', ')}`);
    }
    const inflectionWithoutDerives = Object.entries(kindMap)
        .filter(([, e]) => e.kind === 'inflection' && !e.derives)
        .map(([id]) => id);
    if (inflectionWithoutDerives.length > 0) {
        // `derives` is what the transformation quiz keys off, so an inflection
        // point without it would be classified but unteachable.
        throw new Error(`kinds.json: inflection points missing \`derives\`: ${inflectionWithoutDerives.join(', ')}`);
    }

    // A canonical that never got written means duplicates.json names an id the
    // raw files don't produce - the alias would dangle. Hard error, not a warning.
    const danglingCanonicals = [...new Set(Object.values(duplicateMap).map(e => e.canonical))].filter(id => !seenIds.has(id));
    if (danglingCanonicals.length > 0) {
        throw new Error(
            `duplicates.json names ${danglingCanonicals.length} canonical id(s) that no grammar point was built for: ` +
            danglingCanonicals.join(', ')
        );
    }
    if (droppedForDuplicate !== droppedIds.size) {
        // Every key in duplicates.json should have matched a raw entry. A
        // mismatch means a typo'd id that would otherwise silently do nothing.
        const unmatched = [...droppedIds].filter(id => !allRawIds.has(id));
        throw new Error(
            `duplicates.json lists ${droppedIds.size} id(s) but only ${droppedForDuplicate} matched a raw grammar entry. ` +
            `Unmatched (typo?): ${unmatched.join(', ')}`
        );
    }
    console.log(`   - Families: ${familyMembers.size} (${[...familyMembers.values()].reduce((n, f) => n + f.ids.length, 0)} points total)`);
    console.log(`   - Title/romaji split: ${totalPoints - pointsWithNoTitleRomaji.length}/${totalPoints} points (${(100 * (totalPoints - pointsWithNoTitleRomaji.length) / totalPoints).toFixed(1)}%)`);

    if (pointsWithNoTitleRomaji.length > 0) {
        console.warn(`⚠️  ${pointsWithNoTitleRomaji.length} points had no trailing-parenthetical romaji to split out of their title (kept as-is):`);
        pointsWithNoTitleRomaji.forEach(s => console.warn(`     ${s}`));
    }

    // Dropped duplicates legitimately have a formality.json entry and no built
    // point, so they're excluded here - otherwise every deduplicated id would
    // show up as a false "typo" warning.
    const staleFormalityIds = Object.keys(formalityMap).filter(id => !seenIds.has(id) && !droppedIds.has(id));
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
