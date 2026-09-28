import fs from 'fs';
import path from 'path';

/**
 * Builds compiled/index/synonyms.json for the production quiz's synonym-aware
 * grading (gokan-srs#71 Part B): `vocabId -> [{ id, relation }]`, symmetric,
 * relation ∈ { 'interchangeable', 'confusable' }.
 *
 * MEMBERSHIP is auto-derived and deliberately LENIENT: two reasonably common
 * words cluster, REGARDLESS of part of speech, when either
 *   - their gloss sets look alike overall (`glossOverlap`: share >=1 sense that
 *     is a meaningful fraction of the smaller word's set), or
 *   - one of them has a whole SENSE the other expresses entirely
 *     (`senseCovered`), which is what a flattened ratio dilutes away on a
 *     polysemous word: 一番 carries 18 glosses across 6 senses, so the 2 it
 *     shares with 最高 score 0.25 even though one entire sense is "best, most".
 * Leniency is the point: a learner who types 強い (i-adj) for 丈夫 (na-adj) in
 * "This string is strong" is giving a genuine answer the gloss cue cannot exclude,
 * and being marked flat wrong for it is the frustration this exists to remove.
 * Two earlier guards were dropped for being too strict: requiring a SHARED major
 * POS (blocked 強い/丈夫, which share four full glosses but are i-adj vs na-adj)
 * and requiring >=2 shared glosses. `MIN_OVERLAP_RATIO` is now the one remaining
 * precision knob on the overlap path; `senseCovered` keeps its own >=2-gloss-sense
 * floor so single coincidental senses still do not fire it. This is meant to scale
 * without hand-listing members; the override file below is for the residue.
 *
 * TIER is where curation happens. An auto-derived pair defaults to
 * `interchangeable` (graded `minor_error` by the app: real-but-reduced credit,
 * and moves on) rather than the old `confusable` (no credit, re-ask) - being
 * lenient means accepting a defensible near-synonym, not re-asking until the exact
 * word is produced. The hand-authored data/raw/vocab/synonyms.json then DEMOTES
 * genuinely non-interchangeable pairs to `confusable`, EXCLUDES false-positive
 * auto-clusters, and ADDS pairs that do not gloss-overlap but are still confused
 * (the file is the escape hatch for both directions). Policy: start lenient,
 * tighten the ratio (or re-introduce the POS check via `sharesPos`, still exported
 * for exactly this) once false positives are worth cutting.
 *
 * Inert wherever absent: a word in no cluster gets no entry and grades exactly
 * as it does today.
 *
 * Run: `bun run build:synonyms` (after build:data). Pure helpers are exported
 * for scripts/build-synonyms.test.ts.
 */

const VOCAB_DIR = './compiled/vocab';
const FREQUENCY_PATH = './compiled/index/frequency.json';
const OVERRIDES_PATH = './data/raw/vocab/synonyms.json';
const OUTPUT_PATH = './compiled/index/synonyms.json';

/** Only the most common words are drilled in production, and bounding the pool
 *  keeps the O(n) gloss-bucketing cheap and the index relevant. */
const FREQUENCY_LIMIT = 8000;
/** The one remaining precision knob on the overlap path (POS-match and the
 *  >=2-shared requirement were removed for leniency - see the file header). A
 *  shared sense counts only if the shared set is at least this fraction of the
 *  SMALLER word's set, so one shared "to do" among twenty glosses is still not
 *  synonymy. Raise this to tighten once false positives are worth cutting. */
const MIN_OVERLAP_RATIO = 0.34;
/** Minimum shared glosses outright. Lowered from 2 to 1 so weak-but-real pairs
 *  that share a single sense (必ず/常に share just "always") cluster automatically
 *  instead of needing a hand-added entry; the ratio floor above is what now keeps
 *  a lone shared common token from clustering a big-gloss word with everything. */
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

/** Do two words cluster on gloss overlap? POS-agnostic now (see the file header):
 *  the only bar is >=MIN_SHARED shared senses meeting the MIN_OVERLAP_RATIO floor. */
export function glossOverlap(a: Set<string>, b: Set<string>): boolean {
    const shared = sharedGlosses(a, b);
    if (shared < MIN_SHARED) return false;
    return shared / Math.min(a.size, b.size) >= MIN_OVERLAP_RATIO;
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

interface Word {
    id: string;
    pos: Set<string>;       // every coarse class the word carries
    glosses: Set<string>;   // normalized, flattened across senses
    senses: Set<string>[];  // normalized, kept per sense for senseCovered
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
    const ids = frequency.slice(0, FREQUENCY_LIMIT).map(e => e.id);

    // Load the common words, keeping only those with a major POS and glosses.
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
        words.push({ id, pos, glosses, senses });
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
                // Two ways in. The flattened ratio catches words whose gloss sets
                // look alike overall; sense coverage catches a polysemous word
                // one of whose senses the other word expresses entirely, which
                // the ratio dilutes away (一番 / 最高).
                const overlaps = glossOverlap(a.glosses, b.glosses);
                const covered = sharedGlosses(a.glosses, b.glosses) >= MIN_SHARED
                    && (senseCovered(a.senses, b.glosses) || senseCovered(b.senses, a.glosses));
                if (overlaps || covered) {
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

    // Emit the symmetric adjacency index.
    const index: Record<string, { id: string; relation: SynonymRelation }[]> = {};
    const add = (from: string, to: string, relation: SynonymRelation) => {
        (index[from] ??= []).push({ id: to, relation });
    };
    for (const [key, relation] of relations) {
        const [a, b] = key.split(' ');
        add(a, b, relation);
        add(b, a, relation);
    }
    for (const list of Object.values(index)) list.sort((x, y) => x.id.localeCompare(y.id));

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(index));

    const total = relations.size;
    const inter = [...relations.values()].filter(r => r === 'interchangeable').length;
    console.log(`✅ Synonym index written to ${OUTPUT_PATH}`);
    console.log(`   - Words scanned: ${words.length} (top ${FREQUENCY_LIMIT} by frequency)`);
    console.log(`   - Pairs: ${total} (${inter} interchangeable, ${total - inter} confusable)`);
    console.log(`   - Auto ${autoPairs}, then hand: +${handAdded} added, ${promoted} promoted, ${excluded} excluded`);
    console.log(`   - Words with at least one synonym: ${Object.keys(index).length}`);
}

if (import.meta.main) {
    main().catch(err => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
