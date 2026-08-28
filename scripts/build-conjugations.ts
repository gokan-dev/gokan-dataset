import fs from 'fs';
import path from 'path';
import kuromoji from 'kuromoji';
import type { GrammarPoint } from '../src/models/grammar.model';
import type { SearchIndex } from '../src/models/index.model';
import { classify, conjugate, FORM_LABELS } from '../src/utils/conjugator';
import type { ConjugationForm, WordClass } from '../src/utils/conjugator';

/**
 * Generates the answer keys for the transformation quiz (gokan-srs#54) into
 * `compiled/grammar/conjugations.json`.
 *
 * Only `kind: 'inflection'` points get entries - those are the points whose
 * identity is an OPERATION rather than a fixed marker, so the cloze quiz has
 * nothing invariant to blank and they are currently excluded from the app's
 * introduction pipeline entirely.
 *
 * Nothing here is authored Japanese content: the drill lemmas come from the
 * compiled vocab index (already frequency-ordered) and the target forms are
 * computed by src/utils/conjugator.ts, which is tested per form x class.
 *
 * Run: `bun run build:conjugations` (chained from `bun run build:grammar`).
 */

const POINTS_DIR = './compiled/grammar/points';
const SEARCH_INDEX_PATH = './compiled/index/search.json';
const OUTPUT_PATH = './compiled/grammar/conjugations.json';

/** Drill items generated per point. */
const ITEMS_PER_POINT = 12;
/** Below this, a point would serve the same handful of items forever - fail instead. */
const MIN_ITEMS_PER_POINT = 6;
/** How far down the frequency-ordered vocab index to look for drillable words. */
const INVENTORY_SCAN_LIMIT = 4000;

/**
 * Which derived form each inflection point drills. Explicit rather than parsed
 * out of `derives`, so a new inflection point cannot silently arrive without a
 * form - the coverage assertion below turns that into a build failure.
 *
 * `n4-063` teaches "passive / potential" and is drilled as the PASSIVE, because
 * `n1-178` already drills the potential and the two are homophonous for ichidan
 * verbs (see PREFERRED_CLASSES).
 */
const POINT_FORMS: Record<string, ConjugationForm> = {
    'n5-046': 'te',
    'n5-045': 'tai',
    'n3-025': 'zu',
    'n3-040': 'chatta',
    'n3-062': 'toku',
    'n4-021': 'causative',
    'n4-020': 'causative-passive',
    'n4-063': 'passive',
    'n1-178': 'potential',
    'n5-014': 'i-adj-adverbial',
    'n4-005': 'i-adj-adverbial',
    'n5-017': 'i-adj-te',
    'n5-016': 'i-adj-negative-polite',
    'n5-018': 'na-adj-adverbial',
};

type ClassKey = 'godan' | 'ichidan' | 'irregular' | 'i-adjective' | 'na-adjective';

/**
 * Which word classes each form may draw from.
 *
 * The passive and potential deliberately exclude ichidan: 食べられる is BOTH the
 * passive and the potential of 食べる, so an ichidan item cannot tell the learner
 * which form was asked for, and a correct answer to one is indistinguishable
 * from a correct answer to the other. Godan keeps them apart (書かれる vs 書ける),
 * which is the whole point of the drill.
 */
const PREFERRED_CLASSES: Record<ConjugationForm, ClassKey[]> = {
    'te': ['godan', 'ichidan', 'irregular'],
    'tai': ['godan', 'ichidan', 'irregular'],
    'zu': ['godan', 'ichidan', 'irregular'],
    'chatta': ['godan', 'ichidan', 'irregular'],
    'toku': ['godan', 'ichidan', 'irregular'],
    'causative': ['godan', 'ichidan', 'irregular'],
    'causative-passive': ['godan', 'ichidan', 'irregular'],
    'passive': ['godan'],
    'potential': ['godan'],
    'i-adj-adverbial': ['i-adjective'],
    'i-adj-te': ['i-adjective'],
    'i-adj-negative-polite': ['i-adjective'],
    'na-adj-adverbial': ['na-adjective'],
};

/**
 * Lemmas skipped even though they classify cleanly, because a mechanically
 * correct form would mislead. ある is godan ラ行 so `zu` yields あらず - attested
 * but archaic, while the form a learner needs for ある is the irregular ない.
 */
const EXCLUDED_LEMMAS = new Set(['ある', '居る', 'いる']);

/**
 * Injected rather than discovered. する is one of only two irregular verbs in
 * Japanese, but the vocab index carries it as 為る at position ~18,200 - far
 * outside INVENTORY_SCAN_LIMIT - so scanning alone never finds it and the
 * irregular pool ends up holding 来る only. The displayed lemma is する, not the
 * 為る spelling nobody writes.
 */
const GUARANTEED_LEMMAS: { vocabId: string; lemma: string; lemmaReading: string }[] = [
    { vocabId: '1157170', lemma: 'する', lemmaReading: 'する' },
    { vocabId: '1547720', lemma: '来る', lemmaReading: 'くる' },
];

/**
 * Stative / spontaneous verbs, excluded from the forms that need a volitional
 * agent. Morphology alone cannot catch this: 見えたい is perfectly derivable and
 * is not Japanese, because 見える already means "can be seen".
 *
 * 分かる is also excluded from the potential for a different reason - 分かれる
 * collides with 分かれる / 別れる ("to split", "to part"), so the answer is
 * ambiguous rather than merely unnatural.
 */
const STATIVE_VERBS = new Set(['見える', '聞こえる', '分かる', '要る', 'できる', '思う', '感じる']);
const NEEDS_VOLITION: ConjugationForm[] = ['tai', 'causative', 'causative-passive', 'potential'];

interface DrillItem {
    vocabId: string;
    lemma: string;
    lemmaReading: string;
    target: string;
    targetReading: string;
    /** Equally correct alternatives, e.g. 書かされる for the causative-passive. */
    alternatives?: string[];
    wordClass: ClassKey;
}

interface PointConjugations {
    form: ConjugationForm;
    formLabel: string;
    items: DrillItem[];
}

function classKeyOf(cls: WordClass): ClassKey {
    return cls.kind === 'godan' ? 'godan'
        : cls.kind === 'ichidan' ? 'ichidan'
            : cls.kind === 'irregular' ? 'irregular'
                : cls.kind === 'i-adjective' ? 'i-adjective'
                    : 'na-adjective';
}

interface Candidate {
    vocabId: string;
    lemma: string;
    lemmaReading: string;
    cls: WordClass;
    key: ClassKey;
    /** Godan row, so the picker can spread items across euphony rows. */
    row?: string;
}

async function main() {
    console.log('🔀 Building conjugation drill items...');

    if (!fs.existsSync(POINTS_DIR)) {
        throw new Error(`${POINTS_DIR} not found. Run 'bun run build:grammar' first.`);
    }
    if (!fs.existsSync(SEARCH_INDEX_PATH)) {
        throw new Error(`${SEARCH_INDEX_PATH} not found. Run 'bun run build:data' first.`);
    }

    const points: GrammarPoint[] = fs.readdirSync(POINTS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(fs.readFileSync(path.join(POINTS_DIR, f), 'utf-8')));
    const inflectionPoints = points.filter(p => p.kind === 'inflection');

    // Coverage guard: an inflection point with no form mapping would be
    // classified as needing this quiz and then silently get no items.
    const unmapped = inflectionPoints.filter(p => !POINT_FORMS[p.id]).map(p => p.id);
    if (unmapped.length > 0) {
        throw new Error(
            `${unmapped.length} inflection point(s) have no entry in POINT_FORMS: ${unmapped.join(', ')}. ` +
            `Add the form they drill, or reclassify them in data/raw/grammar/kinds.json.`
        );
    }
    const stale = Object.keys(POINT_FORMS).filter(id => !inflectionPoints.some(p => p.id === id));
    if (stale.length > 0) {
        throw new Error(`POINT_FORMS names ${stale.length} id(s) that are not inflection points: ${stale.join(', ')}`);
    }

    const searchIndex: SearchIndex = JSON.parse(fs.readFileSync(SEARCH_INDEX_PATH, 'utf-8'));
    const tokenizer = await new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>((resolve, reject) => {
        kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => {
            if (err) reject(err); else resolve(t);
        });
    });

    // Build the inventory by walking the frequency-ordered vocab index, so the
    // drill uses common words rather than obscure ones.
    const byClass = new Map<ClassKey, Candidate[]>();
    for (const entry of searchIndex.slice(0, INVENTORY_SCAN_LIMIT)) {
        if (EXCLUDED_LEMMAS.has(entry.w)) continue;

        const tokens = tokenizer.tokenize(entry.w);
        // Single-token, dictionary-form entries only. Skips サ変 compounds
        // (勉強する) and anything kuromoji reads as more than one word, where the
        // stem operation would apply to the wrong piece.
        if (tokens.length !== 1) continue;
        const t = tokens[0];
        if (t.basic_form !== entry.w) continue;

        const cls = classify(entry.w, t.pos, t.pos_detail_1, t.conjugated_type);
        if (!cls) continue;

        const key = classKeyOf(cls);
        const list = byClass.get(key) ?? [];
        list.push({
            vocabId: entry.id,
            lemma: entry.w,
            lemmaReading: entry.r,
            cls,
            key,
            row: cls.kind === 'godan' ? cls.row : undefined,
        });
        byClass.set(key, list);
    }

    // Guaranteed entries, appended after the scan so frequency order is
    // preserved for everything discovered normally.
    for (const forced of GUARANTEED_LEMMAS) {
        const tokens = tokenizer.tokenize(forced.lemma);
        const t = tokens[0];
        const cls = classify(forced.lemma, t.pos, t.pos_detail_1, t.conjugated_type);
        if (!cls) {
            throw new Error(`GUARANTEED_LEMMAS: "${forced.lemma}" did not classify - the override list is stale.`);
        }
        const key = classKeyOf(cls);
        const list = byClass.get(key) ?? [];
        if (!list.some(c => c.lemma === forced.lemma)) {
            list.push({ ...forced, cls, key, row: cls.kind === 'godan' ? cls.row : undefined });
        }
        byClass.set(key, list);
    }

    console.log('   - Inventory from the frequency-ordered vocab index:');
    for (const key of ['godan', 'ichidan', 'irregular', 'i-adjective', 'na-adjective'] as ClassKey[]) {
        console.log(`       ${key.padEnd(13)} ${byClass.get(key)?.length ?? 0}`);
    }

    const output: Record<string, PointConjugations> = {};
    const failures: string[] = [];

    for (const point of inflectionPoints) {
        const form = POINT_FORMS[point.id];
        const classes = PREFERRED_CLASSES[form];

        // Interleave the eligible classes, and within godan spread across
        // euphony rows, so a point's items are not all the same shape.
        const needsVolition = NEEDS_VOLITION.includes(form);
        const pool: Candidate[] = [];
        const perClass = classes.map(k =>
            (byClass.get(k) ?? []).filter(c => !(needsVolition && STATIVE_VERBS.has(c.lemma)))
        );
        if (classes.includes('godan')) {
            const godanIdx = classes.indexOf('godan');
            const seenRows = new Set<string>();
            const spread: Candidate[] = [];
            const rest: Candidate[] = [];
            for (const c of perClass[godanIdx]) {
                if (c.row && !seenRows.has(c.row)) { seenRows.add(c.row); spread.push(c); }
                else rest.push(c);
            }
            perClass[godanIdx] = [...spread, ...rest];
        }
        let i = 0;
        while (pool.length < ITEMS_PER_POINT * 2 && perClass.some(l => l.length > 0)) {
            const list = perClass[i % perClass.length];
            const next = list.shift();
            if (next) pool.push(next);
            i++;
        }

        const items: DrillItem[] = [];
        for (const candidate of pool) {
            if (items.length >= ITEMS_PER_POINT) break;
            const result = conjugate(candidate.lemma, candidate.lemmaReading, candidate.cls, form);
            if (!result) continue;

            // A "conjugation" identical to its input teaches nothing and almost
            // certainly indicates a table bug.
            if (result.written === candidate.lemma) {
                failures.push(`${point.id}: ${candidate.lemma} + ${form} produced the lemma unchanged`);
                continue;
            }

            items.push({
                vocabId: candidate.vocabId,
                lemma: candidate.lemma,
                lemmaReading: candidate.lemmaReading,
                target: result.written,
                targetReading: result.reading,
                ...(result.alternatives?.length
                    ? { alternatives: result.alternatives.flatMap(a => [a.written, a.reading]) }
                    : {}),
                wordClass: candidate.key,
            });
        }

        if (items.length < MIN_ITEMS_PER_POINT) {
            failures.push(`${point.id} (${form}): only ${items.length} item(s), need ${MIN_ITEMS_PER_POINT}`);
        }

        output[point.id] = { form, formLabel: FORM_LABELS[form], items };
    }

    if (failures.length > 0) {
        throw new Error(`Conjugation generation failed:\n  ${failures.join('\n  ')}`);
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));

    const total = Object.values(output).reduce((n, p) => n + p.items.length, 0);
    console.log(`✅ Conjugation drills written to ${OUTPUT_PATH}`);
    console.log(`   - Points covered: ${Object.keys(output).length}/${inflectionPoints.length} inflection points`);
    console.log(`   - Drill items: ${total}`);
    for (const [id, entry] of Object.entries(output)) {
        const sample = entry.items[0];
        console.log(`       ${id.padEnd(8)} ${entry.form.padEnd(19)} ${String(entry.items.length).padStart(2)} items   e.g. ${sample.lemma} → ${sample.target}`);
    }
}

if (import.meta.main) {
    main().catch(err => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
