import fs from 'fs';
import path from 'path';

/**
 * Attaches each vocab's near-synonym list to its own compiled vocab file
 * (`compiled/vocab/{id}.json` gains a `synonyms: [{ id, relation }]` field) for the
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
 * MEMBERSHIP is auto-derived and deliberately LENIENT, REGARDLESS of part of
 * speech. Two words cluster when ANY of:
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
export function isTransitivityPair(a: Word, b: Word): boolean {
    if (!a.stem || a.stem !== b.stem) return false;
    const opposite = (a.vi && b.vt) || (a.vt && b.vi);
    if (!opposite) return false;
    return sharedGlosses(a.glosses, b.glosses) >= 1;
}

interface Word {
    id: string;
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

    // Load every word with a major POS and glosses.
    const words: Word[] = [];
    for (const id of ids) {
        const p = path.join(VOCAB_DIR, `${id}.json`);
        if (!fs.existsSync(p)) continue;
        const v = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const posCodes: string[] = (v.senses ?? []).flatMap((s: { pos: string[] }) => s.pos ?? []);
        const pos = coarsePosSet(posCodes);
        if (pos.size === 0) continue;
        const senses: Set<string>[] = (v.senses ?? [])
            .map((s: { glosses: string[] }) => new Set<string>((s.glosses ?? []).map(normalizeGloss).filter(Boolean)))
            .filter((s: Set<string>) => s.size > 0);
        if (senses.length === 0) continue;
        const glosses = new Set<string>(senses.flatMap(s => [...s]));
        words.push({
            id, pos, glosses, senses,
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

    const relations = new Map<string, SynonymRelation>(); // pairKey -> relation
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
                // NOTE: the POS guard (`if (!sharesPos(a.pos, b.pos)) continue;`)
                // is intentionally disabled for leniency - clustering is cross-POS
                // now, so 強い (i-adj) and 丈夫 (na-adj) can pair. sharesPos/pos are
                // kept for the one-line re-tighten (see the file header).
                // Three ways in (see the file header): the flattened ratio for
                // words whose gloss sets look alike, sense coverage for a
                // polysemous word one of whose senses the other expresses (一番/
                // 最高), and transitivity pairs the ratio misses (並ぶ/並べる).
                const overlaps = glossOverlap(a.glosses, b.glosses);
                const covered = sharedGlosses(a.glosses, b.glosses) >= MIN_SHARED
                    && (senseCovered(a.senses, b.glosses) || senseCovered(b.senses, a.glosses));
                if (overlaps || covered || isTransitivityPair(a, b)) {
                    relations.set(key, 'interchangeable'); // lenient default; hand-demote to confusable / exclude
                    autoPairs++;
                }
            }
        }
    }

    // Hand-authored overrides: exclude false positives, then add/promote pairs.
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
                relations.set(key, relation);
            }
        }
    }

    // Build the symmetric adjacency, then embed each word's list into its OWN
    // compiled vocab file (per-vocab delivery - see the file header) rather than one
    // big index.
    const index = new Map<string, { id: string; relation: SynonymRelation }[]>();
    const add = (from: string, to: string, relation: SynonymRelation) => {
        const list = index.get(from) ?? [];
        list.push({ id: to, relation });
        index.set(from, list);
    };
    for (const [key, relation] of relations) {
        const [a, b] = key.split(' ');
        add(a, b, relation);
        add(b, a, relation);
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
    const inter = [...relations.values()].filter(r => r === 'interchangeable').length;
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
