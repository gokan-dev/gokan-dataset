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
 * MEMBERSHIP is a shared normalized gloss that both words USE THE SAME WAY
 * (`sharedMeanings`, `usesMatch`). Sharing the English word is not enough when it
 * means two different things, and these cases can be told apart from the data alone:
 *   - an English verb gloss is not a noun or adjective one: 述べる "to state" and 国家
 *     "state", 書く "to pen" and 筆 "pen". A suru noun's bare gloss stands for its verb
 *     too (利用 "use" and 使う "to use"), and an expression matches either;
 *   - a sense that is only a prefix, suffix or counter is a bound form, not a word:
 *     来 "next (year, spring, etc.)" is not a synonym of ここ "the next ... days";
 *   - an interjection sense matches only an interjection or an expression (嫌 "stop!"
 *     is not 停車 "stop"), a conjunction sense only a conjunction, an adverb or an
 *     expression (ところで "now" is not これ "now");
 *   - a rare, archaic or dated sense (`isRareSense`, the senses a word page hides) does
 *     not count, unless the word has no other (婦人's one sense is dated).
 * Measured on the pairs a word page can show (both words in the 10,000 most frequent):
 * these remove 16% of them, about 10 times less often confirmed by Japanese WordNet
 * than the pairs they keep, and keep every reported case (gokan-srs docs/MODIFICATION_LOG.md).
 * What they cannot see is one polysemous English word shared in two meanings by
 * two words of the same kind (国家 "state" / 容態 "state (of health)").
 *
 * OUT-OF-CONTEXT TIER is auto-derived and deliberately LENIENT, REGARDLESS of part
 * of speech (see CONTEXT below). A pair is `interchangeable` when ANY of:
 *   - their gloss sets overlap (`overlaps`): the shared glosses are at least
 *     OVERLAP_RATIO of the smaller word's glosses. This is deliberately low enough to
 *     accept single-shared English homographs (作文 "essay" / 作曲 "music" share only
 *     "composition", 1/3 = 0.33) - a decision to prefer accepting a defensible answer
 *     over marking it wrong, even when the shared gloss is an English coincidence. One
 *     shared gloss must also be at least SINGLE_GLOSS_RATIO of both words together
 *     (1/√(|A|·|B|)): もう一人 shares only "another" with 今's 11 glosses, 1/3 but
 *     1/√33 = 0.17, or
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
 * for being too strict: a required SHARED major POS (blocked 強い/丈夫; checked per
 * sense it loses 一番/最高, so `usesMatch` compares only what the gloss itself shows)
 * and a >=2-shared-gloss floor. `sharesPos` stays exported for reference. Every
 * ratio counts all of a word's glosses, rare senses included (`size`): leaving those
 * senses out of membership must not make a word look more focused and promote its
 * pairs (お目にかかる's one common gloss would score 1/1 against any word).
 *
 * TIER is where curation happens. The hand-authored data/raw/vocab/synonyms.json
 * DEMOTES genuinely non-interchangeable pairs to `confusable`, EXCLUDES false
 * positives, and ADDS pairs that do not gloss-overlap (the escape hatch for both
 * directions). Policy: start lenient, tighten later; a reported false positive is
 * corrected here by hand (止む / 埋める). `applyOverrides` fails the build on an id
 * the scan skipped, a pair both excluded and clustered, and a pair given two tiers.
 *
 * CONTEXT. The rules above decide a pair's tier only when the quiz
 * is NOT using the shared meaning. Each entry records `shared` (the glosses both
 * words use the same way) and `overlap` (the ratio score). What an answer earns
 * (gokan-srs services/exercise/wordRelation.ts,
 * the one reader of these entries in the app):
 *   - a curated `confusable` pair: neutral (no credit, no penalty), even in context
 *     (必ず / 常に share "always" and stay confusable in a sentence using it);
 *   - any other pair whose shared meaning the card's text uses: `correct`
 *     ("Japan is a small country" uses "small", so 小さい answers 狭い there);
 *   - out of context, an `interchangeable` pair (auto or curated): `minor_error`;
 *   - out of context, an auto `confusable` pair: neutral.
 * Why: a word is a synonym of another only in a given sense, and a per-pair verdict
 * computed once at build time cannot know which sense a quiz uses. Pairs the old
 * rules missed (狭い / 小さい at 0.14, 人物 / 男 at 0.10) exist with tier
 * `confusable`, so out of context they cost nothing and earn nothing.
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
/** One shared gloss also needs this much of both words together, shared / √(|A|·|B|):
 *  measured, it moves 10k of the 30k "=" pairs a page can show to "≈", and the "=" left
 *  are more often confirmed by Japanese WordNet (36% instead of 29%). The same ratio
 *  for every pair demoted real ones sharing several glosses (また / 再び) and promoted
 *  two 4-gloss words sharing one (1/4 = 0.25), so it applies to one shared gloss only. */
const SINGLE_GLOSS_RATIO = 0.25;
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

/** Do `shared` glosses make words of `a` and `b` glosses overlap? POS-agnostic (see
 *  the file header): at least MIN_SHARED, forming at least OVERLAP_RATIO of the
 *  smaller word's glosses, and a single one at least SINGLE_GLOSS_RATIO of both. The
 *  floor is low enough to accept single-shared English homographs (作文/作曲 = 1/3) by
 *  design; `isTransitivityPair` and `senseCovered` add the pairs this bag-ratio still
 *  misses. */
export function overlaps(shared: number, a: number, b: number): boolean {
    if (shared < MIN_SHARED || shared / Math.min(a, b) < OVERLAP_RATIO) return false;
    return shared >= 2 || shared / Math.sqrt(a * b) >= SINGLE_GLOSS_RATIO;
}

/** `overlaps`, on two gloss sets. */
export function glossOverlap(a: Set<string>, b: Set<string>): boolean {
    return overlaps(sharedGlosses(a, b), a.size, b.size);
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
 * `shared` is what the two words share (`sharedMeanings`), so a gloss the other word
 * uses another way does not cover; `otherSize` is the covering word's every gloss.
 */
export function senseCovered(senses: Set<string>[], otherSize: number, shared: Set<string>): boolean {
    if (otherSize > MAX_COVERING_GLOSSES) return false;
    return senses.some(sense =>
        sense.size >= MIN_COVERED_SENSE && sharedGlosses(sense, shared) === sense.size
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

/** `shared` glosses over the smaller word's gloss count, rounded to 2 decimals (the `overlap` field). */
function overlapOf(shared: number, a: number, b: number): number {
    const smaller = Math.min(a, b);
    if (smaller === 0) return 0;
    return Math.round((shared / smaller) * 100) / 100;
}

/** `overlapOf`, on two gloss sets. */
export function overlapScore(a: Set<string>, b: Set<string>): number {
    return overlapOf(sharedGlosses(a, b), a.size, b.size);
}

type TierWord = Pick<Word, 'glosses' | 'senses' | 'size' | 'stem' | 'vi' | 'vt'>;

/**
 * The OUT-OF-CONTEXT tier of an auto pair. A shared gloss used the same way
 * makes a pair; this decides what it earns when the quiz's own text does not use
 * the shared meaning. The three original detection rules (ratio floor, sense
 * coverage, transitivity) still mark a pair `interchangeable` (minor_error);
 * every other pair, typically one shared gloss between two polysemous words
 * (狭い / 小さい share only "small"), is `confusable` (no credit, no penalty).
 * In context the app upgrades either to correct, so this tier only matters when
 * the sentence or gloss cue uses a different sense. `shared` defaults to every
 * gloss the two words carry.
 */
export function autoTier(a: TierWord, b: TierWord, shared: Set<string> = new Set(sharedGlossList(a.glosses, b.glosses))): SynonymRelation {
    if (shared.size < MIN_SHARED) return 'confusable';
    const covered = senseCovered(a.senses, b.size, shared) || senseCovered(b.senses, a.size, shared);
    return overlaps(shared.size, a.size, b.size) || covered || isTransitivityPair(a, b) ? 'interchangeable' : 'confusable';
}

/** Sense tags whose senses a word page hides: gokan-srs reads @gokan/dataset-schema's
 *  RARE_SENSE_TAGS in isRareSense, and these must stay the same, or grading would pair
 *  through a sense the page does not show. */
const RARE_SENSE_TAGS = new Set(['arch', 'obs', 'rare', 'dated']);
/** A sense carrying only these is a bound form (a prefix, suffix or counter), not a word. */
const AFFIX_POS = new Set(['pref', 'suf', 'n-pref', 'n-suf', 'ctr']);
const INTERJECTION_POS = new Set(['int']);
const CONJUNCTION_POS = new Set(['conj']);

/** A sense as a compiled vocab file stores it, the fields read here. */
interface CompiledSense {
    pos?: string[];
    glosses?: string[];
    misc?: { isArchaic?: boolean; isRare?: boolean; rawTags?: string[] };
}

/** A rare, archaic, obsolete or dated sense: one a word page hides (gokan-srs isRareSense). */
export function isRareSense(sense: CompiledSense): boolean {
    const misc = sense.misc ?? {};
    return misc.isArchaic === true || misc.isRare === true || (misc.rawTags ?? []).some(tag => RARE_SENSE_TAGS.has(tag));
}

/** How a sense uses one of its glosses: what tells whether two words sharing it mean the same thing. */
export interface GlossUse {
    /** The English is a verb ("to face"), not a noun or adjective ("face"). */
    verb: boolean;
    /** The sense's POS codes. */
    pos: string[];
}

const only = (pos: string[], codes: ReadonlySet<string>) => pos.length > 0 && pos.every(p => codes.has(p));

/** One side of the function-word rule: an interjection sense ("stop!") fits only an
 *  interjection or an expression, a conjunction ("now") a conjunction, an adverb or an
 *  expression; any other sense fits anything. */
function functionWordFits(x: GlossUse, y: GlossUse): boolean {
    if (only(x.pos, INTERJECTION_POS)) return y.pos.includes('int') || y.pos.includes('exp');
    if (only(x.pos, CONJUNCTION_POS)) return y.pos.some(p => p === 'conj' || p === 'adv' || p === 'exp');
    return true;
}

/** Do two senses use a gloss they share the same way? See MEMBERSHIP in the file header. */
export function usesMatch(x: GlossUse, y: GlossUse): boolean {
    // "to face" is the verb, "face" the noun; a suru noun's bare gloss stands for its
    // verb, and an expression for either.
    const sameKind = x.pos.includes('exp') || y.pos.includes('exp') || x.verb === y.verb
        || (!x.verb && x.pos.includes('vs')) || (!y.verb && y.pos.includes('vs'));
    return sameKind && only(x.pos, AFFIX_POS) === only(y.pos, AFFIX_POS)
        && functionWordFits(x, y) && functionWordFits(y, x);
}

/** An English verb gloss: "to face", "(to be) able to". */
const isVerbGloss = (gloss: string) => /^to\s/i.test(gloss.replace(/^\s*\([^)]*\)\s*/, ''));

/**
 * What the pair scan reads of a word's senses. A rare sense (`isRareSense`) is left
 * out unless every sense is rare, so a word page and grading pair through the same
 * senses; `size` still counts every gloss, rare senses included (see the file header).
 */
export function readSenses(compiled: CompiledSense[]): Pick<Word, 'senses' | 'glosses' | 'uses' | 'size'> {
    const glossed = compiled.filter(s => (s.glosses ?? []).some(g => normalizeGloss(g)));
    const common = glossed.filter(s => !isRareSense(s));
    const senses: Set<string>[] = [];
    const uses = new Map<string, GlossUse[]>();
    for (const sense of common.length > 0 ? common : glossed) {
        const set = new Set<string>();
        for (const raw of sense.glosses ?? []) {
            const g = normalizeGloss(raw);
            if (!g) continue;
            set.add(g);
            uses.set(g, [...(uses.get(g) ?? []), { verb: isVerbGloss(raw), pos: sense.pos ?? [] }]);
        }
        senses.push(set);
    }
    const size = new Set(glossed.flatMap(s => (s.glosses ?? []).map(normalizeGloss).filter(Boolean))).size;
    return { senses, glosses: new Set(uses.keys()), uses, size };
}

/** The glosses two words share and use the same way (`usesMatch`), sorted so the output is stable. */
export function sharedMeanings(a: Pick<Word, 'uses'>, b: Pick<Word, 'uses'>): string[] {
    return [...a.uses]
        .filter(([g, xs]) => (b.uses.get(g) ?? []).some(y => xs.some(x => usesMatch(x, y))))
        .map(([g]) => g)
        .sort();
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
    /**
     * The word's frequency rank: its 1-based position in index/frequency.json. Absent
     * when JPDB does not rank it (those sit at the end of the file in no real order).
     * Lets a word page order and cut its synonyms without loading that 3 MB index.
     */
    f?: number;
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

/** The rank JPDB gives a word with none (build-data.ts): such a word has no real frequency rank. */
const UNRANKED = 999999;

/** Whether the word has a frequency rank of its own, rather than build-data's placeholder. */
export function isRanked(v: { frequency?: { kanjiRank?: number; kanaRank?: number } }): boolean {
    const { kanjiRank, kanaRank } = v.frequency ?? {};
    return [kanjiRank, kanaRank].some(r => r !== undefined && r < UNRANKED);
}

interface Word {
    id: string;
    forms: SynonymForms;
    pos: Set<string>;       // every coarse class the word carries
    glosses: Set<string>;   // normalized, flattened across the senses pairs are read from (readSenses)
    senses: Set<string>[];  // the same, kept per sense for senseCovered
    uses: Map<string, GlossUse[]>; // how each of those senses uses each gloss, for sharedMeanings
    size: number;           // every normalized gloss, rare senses included: what the tier's ratios count
    stem: string;           // leading-kanji run of the primary written form
    vi: boolean;            // carries an intransitive-verb sense
    vt: boolean;            // carries a transitive-verb sense
}

export interface RawOverrides {
    clusters?: { ids: string[]; relation: SynonymRelation }[];
    exclude?: [string, string][];
}

/** Undirected pair key, order-independent. */
function pairKey(a: string, b: string): string {
    return a < b ? `${a} ${b}` : `${b} ${a}`;
}

type OverridePair = Omit<SynonymEntry, 'id'>;

/**
 * Applies data/raw/vocab/synonyms.json to the auto pairs, in place: `exclude` drops a
 * pair, then each cluster sets a curated tier on every pair inside it. Throws on a
 * curation the build would otherwise apply silently and wrongly:
 * - an id the scan skipped (a typo, or a word with no glosses): its pair would ship
 *   with no forms, so grading could never match it;
 * - a pair both excluded and clustered: the cluster used to re-add it unnoticed;
 * - one pair in two clusters with different tiers: the last cluster used to win.
 */
export function applyOverrides(
    relations: Map<string, OverridePair>,
    overrides: RawOverrides,
    byId: Map<string, Pick<Word, 'glosses'>>,
): { excluded: number; promoted: number; handAdded: number } {
    const excludedKeys = new Set((overrides.exclude ?? []).map(([a, b]) => pairKey(a, b)));
    const curatedTier = new Map<string, SynonymRelation>();
    const problems: string[] = [];
    for (const [a, b] of overrides.exclude ?? []) {
        for (const id of [a, b]) if (!byId.has(id)) problems.push(`exclude names ${id}, which the scan skipped`);
    }
    for (const { ids, relation } of overrides.clusters ?? []) {
        for (const id of ids) if (!byId.has(id)) problems.push(`a cluster names ${id}, which the scan skipped`);
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const key = pairKey(ids[i], ids[j]);
                if (excludedKeys.has(key)) problems.push(`${key} is both excluded and clustered`);
                const earlier = curatedTier.get(key);
                if (earlier && earlier !== relation) problems.push(`${key} is clustered as both ${earlier} and ${relation}`);
                curatedTier.set(key, relation);
            }
        }
    }
    if (problems.length > 0) throw new Error(`${OVERRIDES_PATH}:\n  ${problems.join('\n  ')}`);

    let excluded = 0, promoted = 0, handAdded = 0;
    for (const key of excludedKeys) if (relations.delete(key)) excluded++;
    for (const [key, relation] of curatedTier) {
        if (relations.has(key)) promoted++; else handAdded++;
        const [x, y] = key.split(' ');
        const a = byId.get(x), b = byId.get(y);
        relations.set(key, {
            relation,
            shared: a && b ? sharedGlossList(a.glosses, b.glosses) : [],
            overlap: a && b ? overlapScore(a.glosses, b.glosses) : 0,
            curated: true,
        });
    }
    return { excluded, promoted, handAdded };
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
    const rankOf = new Map(ids.map((id, i) => [id, i + 1]));

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
        const read = readSenses(v.senses ?? []);
        if (read.senses.length === 0) continue;
        words.push({
            id, pos, ...read,
            forms: { ...synonymForms(v), ...(isRanked(v) ? { f: rankOf.get(id) } : {}) },
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
                // A shared gloss both words use the same way makes a pair. Whether
                // a word is a synonym depends on the sense the quiz is using, which
                // only the app knows, so the build records WHICH glosses are shared
                // and lets the app check them against the sentence or cue in front of
                // the learner. The original three rules only set the out-of-context
                // tier (autoTier).
                const shared = sharedMeanings(a, b);
                if (shared.length === 0) continue;
                relations.set(key, {
                    relation: autoTier(a, b, new Set(shared)),
                    shared,
                    overlap: overlapOf(shared.length, a.size, b.size),
                });
                autoPairs++;
            }
        }
    }

    // Hand-authored overrides: exclude false positives, then add/set curated tiers.
    const overrides: RawOverrides = fs.existsSync(OVERRIDES_PATH)
        ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8'))
        : {};
    const { excluded, promoted, handAdded } = applyOverrides(relations, overrides, byId);

    // Build the symmetric adjacency, then embed each word's list into its OWN
    // compiled vocab file (per-vocab delivery - see the file header) rather than one
    // big index.
    const index = new Map<string, (SynonymEntry & Partial<SynonymForms>)[]>();
    const add = (from: string, to: string, pair: Pair) => {
        const list = index.get(from) ?? [];
        // Every curated id is a scanned word (applyOverrides), so every entry carries forms.
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
