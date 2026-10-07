import fs from 'fs';
import path from 'path';

/**
 * Attaches each vocab's near-synonym list to its own compiled vocab file
 * (`compiled/vocab/{id}.json` gains a `synonyms: [{ id, relation, shared, overlap, w, r, pos }]`
 * field, see SynonymEntry / SynonymForms) for the
 * production quiz's synonym-aware grading (gokan-srs#71 Part B). Symmetric,
 * relation ∈ { 'interchangeable', 'confusable' }.
 *
 * DELIVERY is per-vocab, NOT a monolithic index. An earlier version wrote one
 * compiled/index/synonyms.json the app loaded whole; at full vocab coverage with
 * the lenient rules below that file is ~11MB, several times the largest other index
 * (frequency.json ~3.2MB) and too heavy to hold in browser memory. The app already
 * fetches the target's own vocab file to render a production card, so embedding the
 * list there is lazy and free - no extra request, no big load. Candidates are still
 * resolved by their own `loadVocab`, exactly as before.
 *
 * COVERAGE is the full vocab set (not just the top-N by frequency). Learners are
 * drilled well past the old 8k cutoff - 作文/作曲 sit near rank 14k - and a word
 * outside the pool got no synonym support at all. Per-vocab delivery makes full
 * coverage affordable (each file grows by its own handful of entries).
 *
 * OUT-OF-CONTEXT TIER is auto-derived and deliberately LENIENT, REGARDLESS of part
 * of speech (see CONTEXT below for membership). A pair is `interchangeable` when ANY of:
 *   - their gloss sets overlap (`glossOverlap`): >= 1 shared normalized sense that
 *     is at least OVERLAP_RATIO of the smaller word's set. This is deliberately low
 *     enough to accept single-shared English homographs (作文 "essay" / 作曲 "music"
 *     share only "composition", 1/3 = 0.33) - a decision to prefer accepting a
 *     defensible answer over marking it wrong, even when the shared gloss is an
 *     English coincidence (see the tier note), or
 *   - one has a whole SENSE the other expresses entirely (`senseCovered`), which a
 *     flattened ratio dilutes away on a polysemous word: 一番 has 18 glosses across
 *     6 senses, so the 2 it shares with 最高 score 0.25 even though one whole sense
 *     is "best, most", or
 *   - they are a TRANSITIVITY PAIR (`isTransitivityPair`): same leading-kanji stem,
 *     opposite transitivity (one vi, one vt), and >= 1 shared gloss. This catches
 *     自他 pairs like 並ぶ/並べる that share only "line up" (ratio 0.2, below the
 *     overlap floor) but are the same verb in different transitivity.
 * Leniency is the point: a learner who types 強い for 丈夫, 締める for 縛る, 並べる for
 * 並ぶ, or 作曲 for 作文 is giving an answer the gloss cue cannot exclude, and being
 * marked flat wrong is the frustration this removes. Two earlier guards were dropped
 * for being too strict: a required SHARED major POS (blocked 強い/丈夫) and a
 * >=2-shared-gloss floor. `sharesPos` is kept exported so the POS check is a
 * one-line re-tighten; raising OVERLAP_RATIO is the other precision knob.
 *
 * TIER is where curation happens. An auto-derived pair defaults to
 * `interchangeable` (graded `minor_error` by the app: real-but-reduced credit, and
 * moves on) rather than the old `confusable` (no credit, re-ask). The hand-authored
 * data/raw/vocab/synonyms.json then DEMOTES genuinely non-interchangeable pairs to
 * `confusable`, EXCLUDES false positives, and ADDS pairs that do not gloss-overlap
 * (the escape hatch for both directions). Policy: start lenient, tighten later.
 *
 * CONTEXT. The rules above decide a pair's tier only when the quiz
 * is NOT using the shared meaning. Membership itself is now any shared gloss, and
 * each entry records `shared` (the glosses both words carry) and `overlap` (the
 * ratio score). The app checks `shared` against the text in front of the learner:
 * "Japan is a small country" uses "small", so 小さい answers 狭い correctly there,
 * while in a sentence about a narrow street the same pair falls back to its tier.
 * Why: a word is a synonym of another only in a given sense, and a per-pair verdict
 * computed once at build time cannot know which sense a quiz uses. Pairs the old
 * rules missed (狭い / 小さい at 0.14, 人物 / 男 at 0.10) now exist with tier
 * `confusable`, so out of context they cost nothing and earn nothing. A curated
 * pair is flagged `curated` and the app never overrides its tier from context
 * (必ず / 常に share "always" and stay confusable even in a sentence using it).
 *
 * Inert wherever absent: a word in no cluster gets no `synonyms` field and grades
 * exactly as it does today.
 *
 * Run: `bun run build:synonyms` (after build:data - it reads the compiled vocab
 * files and writes them back). Pure helpers are exported for the test file.
 */

const VOCAB_DIR = './compiled/vocab';
const FREQUENCY_PATH = './compiled/index/frequency.json';
const OVERRIDES_PATH = './data/raw/vocab/synonyms.json';

/** The overlap floor (see `glossOverlap`): a shared normalized sense counts when
 *  the shared set is at least this fraction of the SMALLER word's set. Low enough
 *  to accept single-shared English homographs (作文/作曲 = 1/3) by design - the
 *  product decision is to over-accept rather than mark a gloss-matching answer
 *  wrong. Raise this to tighten once false positives are worth cutting. */
const OVERLAP_RATIO = 0.30;
/** Minimum shared glosses outright. */
const MIN_SHARED = 1;
/** `senseCovered`'s own floor, kept at 2 and deliberately NOT tied to MIN_SHARED:
 *  a single-gloss sense wholly "covered" by another word is almost always a
 *  coincidence (best, most, ...), so the sense-coverage path still demands a
 *  >=2-gloss sense even though the overlap path now accepts a single shared gloss. */
const MIN_COVERED_SENSE = 2;

export type SynonymRelation = 'interchangeable' | 'confusable';

/**
 * EVERY major part of speech a word carries, coarse enough that 必ず and 常に
 * (both adv) match.
 *
 * A set rather than the first recognised class, because JMdict lists a word's
 * codes in its own order and many words are genuinely more than one class. This
 * returned `'noun'` for 一番 (n, adj-no, adv...) and `'na-adj'` for 最高
 * (adj-no, adj-na, n...), so two words that are both nouns never reached the
 * gloss comparison at all. 2054 of the 7701 scanned words carry more than one
 * class, so the arbitrary pick was suppressing real pairs across the index.
 */
export function coarsePosSet(posCodes: string[]): Set<string> {
    const classes = new Set<string>();
    for (const p of posCodes) {
        if (p.startsWith('v')) classes.add('verb');
        else if (p === 'adj-i' || p === 'adj-ix') classes.add('i-adj');
        else if (p === 'adj-na') classes.add('na-adj');
        else if (p === 'adv' || p === 'adv-to') classes.add('adv');
        else if (p === 'n' || p.startsWith('n-')) classes.add('noun');
    }
    return classes;
}

/** Do two words share any major class? */
export function sharesPos(a: Set<string>, b: Set<string>): boolean {
    for (const p of a) if (b.has(p)) return true;
    return false;
}

/** lowercase; drop a leading "to "/"a "/"an "/"the "; drop parentheticals;
 *  collapse whitespace; strip surrounding punctuation. So "to consider",
 *  "State (of affairs)" and "the state" normalize to comparable senses. */
export function normalizeGloss(gloss: string): string {
    return gloss
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/^\s*(to|a|an|the)\s+/, '')
        .replace(/[.,;:!?"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Shared normalized senses between two words' gloss sets. */
export function sharedGlosses(a: Set<string>, b: Set<string>): number {
    let n = 0;
    for (const g of a) if (b.has(g)) n++;
    return n;
}

/** Do two words cluster on gloss overlap? POS-agnostic (see the file header): at
 *  least MIN_SHARED shared normalized senses, forming at least OVERLAP_RATIO of the
 *  smaller word's set. The floor is low enough to accept single-shared English
 *  homographs (作文/作曲 = 1/3) by design; `isTransitivityPair` and `senseCovered`
 *  add the pairs this bag-ratio still misses. */
export function glossOverlap(a: Set<string>, b: Set<string>): boolean {
    const shared = sharedGlosses(a, b);
    if (shared < MIN_SHARED) return false;
    return shared / Math.min(a.size, b.size) >= OVERLAP_RATIO;
}

/** A word this polysemous covers small senses by accident, so it is not allowed
 *  to be the COVERING side of `senseCovered`. 取る carries 54 glosses and would
 *  otherwise absorb most of the verb index. */
const MAX_COVERING_GLOSSES = 12;

/**
 * Does a whole SENSE of `senses` have its meaning expressed by `otherGlosses`?
 *
 * The flattened `glossOverlap` above measures one bag against another, which
 * makes a polysemous word look unlike its own synonym: 一番 carries 18 glosses
 * across 6 senses, so the 2 it shares with 最高 ("best", "most") score
 * 2/min(18,8) = 0.25 and fall under the ratio floor, even though one of 一番's
 * six senses is ENTIRELY "best, most". A sense is the unit a meaning actually
 * lives at, so a sense being wholly expressible by the other word is the signal
 * the flattened ratio throws away.
 *
 * Deliberately asymmetric. The covered side may be as polysemous as it likes
 * (that is the case this exists for), while the covering side must be focused,
 * or a 54-gloss verb covers every two-word sense in the index by chance.
 * The covered sense must be >= MIN_COVERED_SENSE glosses (its own floor, not the
 * relaxed MIN_SHARED), so a single-gloss sense matching by coincidence never fires.
 */
export function senseCovered(senses: Set<string>[], otherGlosses: Set<string>): boolean {
    if (otherGlosses.size > MAX_COVERING_GLOSSES) return false;
    return senses.some(sense =>
        sense.size >= MIN_COVERED_SENSE && sharedGlosses(sense, otherGlosses) === sense.size
    );
}

/** Leading run of CJK-ideograph characters of a written form - the shared stem of
 *  a transitivity pair (並ぶ/並べる both "並"). Empty for a kana-only word. */
export function kanjiStem(writtenForm: string): string {
    const m = (writtenForm ?? '').match(/^[一-龯㐀-䶿々]+/);
    return m ? m[0] : '';
}

/**
 * Are `a` and `b` a transitivity pair (自他動詞)? Same leading-kanji stem, opposite
 * transitivity (one intransitive, one transitive), and at least one shared gloss.
 *
 * 並ぶ (vi, "line up") and 並べる (vt, "line up / arrange") share only "line up"
 * (1/5 = 0.2, under the overlap floor), but they are the same verb in different
 * transitivity - the exact near-miss a learner makes. The stem + opposite-vi/vt
 * combination is specific enough that the >=1 shared gloss stays honest (見る/見つかる
 * share the 見 stem and opposite transitivity but no gloss, so they do not pair). */
export function isTransitivityPair(a: Pick<Word, 'stem' | 'vi' | 'vt' | 'glosses'>, b: Pick<Word, 'stem' | 'vi' | 'vt' | 'glosses'>): boolean {
    if (!a.stem || a.stem !== b.stem) return false;
    const opposite = (a.vi && b.vt) || (a.vt && b.vi);
    if (!opposite) return false;
    return sharedGlosses(a.glosses, b.glosses) >= 1;
}

/** The normalized glosses two words share, sorted so the output is stable across builds. */
export function sharedGlossList(a: Set<string>, b: Set<string>): string[] {
    return [...a].filter(g => b.has(g)).sort();
}

/** Shared glosses over the smaller word's gloss count, rounded to 2 decimals (the `overlap` field). */
export function overlapScore(a: Set<string>, b: Set<string>): number {
    const smaller = Math.min(a.size, b.size);
    if (smaller === 0) return 0;
    return Math.round((sharedGlosses(a, b) / smaller) * 100) / 100;
}

/**
 * The OUT-OF-CONTEXT tier of an auto pair. Any shared gloss makes a
 * pair; this decides what it earns when the quiz's own text does not use the
 * shared meaning. The three original detection rules (ratio floor, sense
 * coverage, transitivity) still mark a pair `interchangeable` (minor_error);
 * every other pair, typically one shared gloss between two polysemous words
 * (狭い / 小さい share only "small"), is `confusable` (no credit, no penalty).
 * In context the app upgrades either to correct, so this tier only matters when
 * the sentence or gloss cue uses a different sense.
 */
export function autoTier(a: Pick<Word, 'glosses' | 'senses' | 'stem' | 'vi' | 'vt'>, b: Pick<Word, 'glosses' | 'senses' | 'stem' | 'vi' | 'vt'>): SynonymRelation {
    const overlaps = glossOverlap(a.glosses, b.glosses);
    const covered = sharedGlosses(a.glosses, b.glosses) >= MIN_SHARED
        && (senseCovered(a.senses, b.glosses) || senseCovered(b.senses, a.glosses));
    return overlaps || covered || isTransitivityPair(a, b) ? 'interchangeable' : 'confusable';
}

/** One entry of a compiled vocab file's `synonyms` list. */
export interface SynonymEntry {
    id: string;
    relation: SynonymRelation;
    /** Normalized glosses both words carry; empty for a hand-added pair with no overlap. */
    shared: string[];
    /** shared / smaller word's gloss count (see overlapScore). */
    overlap: number;
    /** Set when data/raw/vocab/synonyms.json decided the tier; the app never overrides a curated tier from context. */
    curated?: true;
}

/**
 * The OTHER word's answerable forms, embedded on each entry so a consumer can
 * tell whether a typed answer is that word without fetching its vocab file
 * (a word can list hundreds of pairs). Kept terse because it repeats on every
 * one of ~475k entries.
 */
export interface SynonymForms {
    /** Written forms: kanji first, then alternatives. */
    w: string[];
    /** Readings: primary first, then alternatives, then merged homographs' readings. */
    r: string[];
    /** The word's inflecting POS codes only (v5k, v1, vs, adj-i...), so its conjugated forms can be accepted too. */
    pos?: string[];
    /** Learned in kana (Vocabulary.usuallyKana): a consumer naming the word shows `r[0]`, not `w[0]`. */
    u?: true;
}

/** POS codes that decide how a word inflects; every other code is irrelevant to matching an answer. */
const INFLECTING_POS = new Set([
    'v5u', 'v5u-s', 'v5k', 'v5k-s', 'v5g', 'v5s', 'v5t', 'v5n', 'v5b', 'v5m', 'v5r', 'v5r-i', 'v5aru',
    'v1', 'v1-s', 'vk', 'vs-i', 'vs-s', 'vs', 'adj-i', 'adj-ix', 'adj-na',
]);

interface CompiledVocabForms {
    writtenForm?: { kanji?: string; alternatives?: string[] };
    reading?: { primary?: string; alternatives?: string[] };
    mergedVocabs?: { originalPrimaryReading?: string }[];
    senses?: { pos?: string[] }[];
    usuallyKana?: boolean;
}

export function synonymForms(v: CompiledVocabForms): SynonymForms {
    const unique = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
    const forms: SynonymForms = {
        w: unique([v.writtenForm?.kanji, ...(v.writtenForm?.alternatives ?? [])]),
        r: unique([
            v.reading?.primary,
            ...(v.reading?.alternatives ?? []),
            ...(v.mergedVocabs ?? []).map(m => m.originalPrimaryReading),
        ]),
    };
    const pos = unique((v.senses ?? []).flatMap(s => s.pos ?? []).filter(p => INFLECTING_POS.has(p))).sort();
    if (pos.length > 0) forms.pos = pos;
    if (v.usuallyKana) forms.u = true;
    return forms;
}

interface Word {
    id: string;
    forms: SynonymForms;
    pos: Set<string>;       // every coarse class the word carries
    glosses: Set<string>;   // normalized, flattened across senses
    senses: Set<string>[];  // normalized, kept per sense for senseCovered
    stem: string;           // leading-kanji run of the primary written form
    vi: boolean;            // carries an intransitive-verb sense
    vt: boolean;            // carries a transitive-verb sense
}

interface RawOverrides {
    clusters?: { ids: string[]; relation: SynonymRelation }[];
    exclude?: [string, string][];
}

/** Undirected pair key, order-independent. */
function pairKey(a: string, b: string): string {
    return a < b ? `${a} ${b}` : `${b} ${a}`;
}

async function main() {
    console.log('🔗 Building production synonym index...');
    if (!fs.existsSync(FREQUENCY_PATH)) {
        throw new Error(`${FREQUENCY_PATH} not found. Run 'bun run build:data' first.`);
    }

    const frequency: { id: string }[] = JSON.parse(fs.readFileSync(FREQUENCY_PATH, 'utf-8'));
    // Full coverage - learners are drilled well past any top-N cutoff, and per-vocab
    // delivery (below) makes covering everything affordable.
    const ids = frequency.map(e => e.id);

    // Load every word with glosses, whatever its part of speech. Pairing has been
    // POS-agnostic for a while, but this loader still skipped any word without a
    // major class: every expression, interjection and conjunction (気を付けて,
    // お願いします, 従って) had no synonyms at all, so 気をつける graded wrong on a
    // card for 気を付けて even though both mean "be careful" (reported).
    const words: Word[] = [];
    for (const id of ids) {
        const p = path.join(VOCAB_DIR, `${id}.json`);
        if (!fs.existsSync(p)) continue;
        const v = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const posCodes: string[] = (v.senses ?? []).flatMap((s: { pos: string[] }) => s.pos ?? []);
        const pos = coarsePosSet(posCodes);
        const senses: Set<string>[] = (v.senses ?? [])
            .map((s: { glosses: string[] }) => new Set<string>((s.glosses ?? []).map(normalizeGloss).filter(Boolean)))
            .filter((s: Set<string>) => s.size > 0);
        if (senses.length === 0) continue;
        const glosses = new Set<string>(senses.flatMap(s => [...s]));
        words.push({
            id, pos, glosses, senses,
            forms: synonymForms(v),
            stem: kanjiStem(v.writtenForm?.kanji ?? ''),
            vi: posCodes.includes('vi'),
            vt: posCodes.includes('vt'),
        });
    }

    // Bucket by (pos, normalized gloss) so only words that share at least one
    // sense are ever compared - O(sum of bucket^2) instead of O(n^2).
    const buckets = new Map<string, Word[]>();
    for (const w of words) {
        for (const g of w.glosses) {
            // Keyed by gloss alone: a word now carries several POS classes, so
            // the class check moved into the comparison, where intersecting two
            // small sets is cheap.
            const list = buckets.get(g) ?? [];
            list.push(w);
            buckets.set(g, list);
        }
    }

    type Pair = Omit<SynonymEntry, 'id'>;
    const relations = new Map<string, Pair>(); // pairKey -> everything but the id
    const byId = new Map(words.map(w => [w.id, w]));
    let autoPairs = 0;
    const seen = new Set<string>();
    for (const list of buckets.values()) {
        if (list.length < 2) continue;
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i], b = list[j];
                const key = pairKey(a.id, b.id);
                if (seen.has(key)) continue;
                seen.add(key);
                // ANY shared gloss makes a pair. Whether a word is a
                // synonym depends on the sense the quiz is using, which only the app
                // knows, so the build records WHICH glosses are shared and lets the
                // app check them against the sentence or cue in front of the learner.
                // The original three rules now only set the out-of-context tier
                // (autoTier). The POS guard stays disabled, as before.
                relations.set(key, {
                    relation: autoTier(a, b),
                    shared: sharedGlossList(a.glosses, b.glosses),
                    overlap: overlapScore(a.glosses, b.glosses),
                });
                autoPairs++;
            }
        }
    }

    // Hand-authored overrides: exclude false positives, then add/set curated tiers.
    const overrides: RawOverrides = fs.existsSync(OVERRIDES_PATH)
        ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8'))
        : {};
    let excluded = 0, promoted = 0, handAdded = 0;
    for (const [a, b] of overrides.exclude ?? []) {
        if (relations.delete(pairKey(a, b))) excluded++;
    }
    for (const cluster of overrides.clusters ?? []) {
        const { ids: cids, relation } = cluster;
        for (let i = 0; i < cids.length; i++) {
            for (let j = i + 1; j < cids.length; j++) {
                const key = pairKey(cids[i], cids[j]);
                if (relations.has(key)) promoted++; else handAdded++;
                const a = byId.get(cids[i]), b = byId.get(cids[j]);
                relations.set(key, {
                    relation,
                    shared: a && b ? sharedGlossList(a.glosses, b.glosses) : [],
                    overlap: a && b ? overlapScore(a.glosses, b.glosses) : 0,
                    curated: true,
                });
            }
        }
    }

    // Build the symmetric adjacency, then embed each word's list into its OWN
    // compiled vocab file (per-vocab delivery - see the file header) rather than one
    // big index.
    const index = new Map<string, (SynonymEntry & Partial<SynonymForms>)[]>();
    const add = (from: string, to: string, pair: Pair) => {
        const list = index.get(from) ?? [];
        // A hand-added pair can name a word the scan skipped (no major POS);
        // its entry then carries no forms and a consumer falls back to fetching it.
        list.push({ id: to, ...pair, ...byId.get(to)?.forms });
        index.set(from, list);
    };
    for (const [key, pair] of relations) {
        const [a, b] = key.split(' ');
        add(a, b, pair);
        add(b, a, pair);
    }
    for (const list of index.values()) list.sort((x, y) => x.id.localeCompare(y.id));

    // Write each SCANNED word's file back with its `synonyms` field set (or cleared),
    // skipping files whose stored value already matches so an unchanged rebuild
    // touches nothing on disk (and git sees no diff).
    let written = 0;
    for (const w of words) {
        const p = path.join(VOCAB_DIR, `${w.id}.json`);
        const v = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const syn = index.get(w.id);
        const current = JSON.stringify(v.synonyms ?? null);
        const next = JSON.stringify(syn ?? null);
        if (current === next) continue;
        if (syn) v.synonyms = syn; else delete v.synonyms;
        fs.writeFileSync(p, JSON.stringify(v));
        written++;
    }

    const total = relations.size;
    const inter = [...relations.values()].filter(r => r.relation === 'interchangeable').length;
    console.log(`✅ Synonyms embedded into compiled vocab files`);
    console.log(`   - Words scanned: ${words.length} (full vocab coverage)`);
    console.log(`   - Pairs: ${total} (${inter} interchangeable, ${total - inter} confusable)`);
    console.log(`   - Auto ${autoPairs}, then hand: +${handAdded} added, ${promoted} promoted, ${excluded} excluded`);
    console.log(`   - Words with at least one synonym: ${index.size}`);
    console.log(`   - Vocab files rewritten: ${written}`);
}

if (import.meta.main) {
    main().catch(err => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
