import fs from 'fs';
import path from 'path';
import type { VocabIndexEntry } from '../src/models/index.model';
import type { Vocabulary } from '../src/models/vocabulary.model';

export function parseJPDBEntry(entry: string): {
    kanjiRank?: number;
    hiraganaRank?: number;
} {
    const parts = entry.replace('㋕', '').split(',').map(p => p.trim());
    return {
        kanjiRank: parts[0] ? Number(parts[0]) : undefined,
        hiraganaRank: parts[1] ? Number(parts[1]) : undefined,
    };
}

export function extractKanji(text: string): string[] {
    return [...text].filter(c => /[\u4e00-\u9faf]/.test(c));
}

/** One row of the JPDB frequency TSV: the spelling's rank, and its kana spelling's rank when JPDB lists one. */
export interface JpdbRow {
    frequency: number;
    kanaFrequency: number | null;
}

/**
 * The JPDB frequency TSV as rows keyed `${term}|${reading}`, in file order.
 *
 * The JSON build-data.ts also loads collapses a repeated key to its last row, and
 * keys do repeat: ボタン|ボタン is both "button" (rank 3397) and the peony's katakana
 * spelling (45485), and the TSV carries no entry id to tell them apart. Anything that
 * must know a row is unambiguous reads it from here.
 */
export interface JpdbTable {
    rows: Map<string, JpdbRow[]>;
    /** Every term with at least one row, whatever its reading. */
    terms: Set<string>;
}

export function parseJpdbTsv(text: string): JpdbTable {
    const rows = new Map<string, JpdbRow[]>();
    const terms = new Set<string>();
    for (const line of text.split('\n').slice(1)) {
        const [term, reading, frequency, kanaFrequency] = line.trim().split('\t');
        if (!term || !reading || !frequency) continue;
        const key = `${term}|${reading}`;
        const row = { frequency: Number(frequency), kanaFrequency: kanaFrequency ? Number(kanaFrequency) : null };
        const list = rows.get(key);
        if (list) list.push(row);
        else rows.set(key, [row]);
        terms.add(term);
    }
    return { rows, terms };
}

const toKatakana = (text: string) => text.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));

/** How much more often the kana spelling must appear than the kanji one for a `uk` word to be shown in kana. */
export const USUALLY_KANA_RATIO = 2;

export interface UsuallyKanaInput {
    /** The entry's headword (writtenForm.kanji). */
    kanji: string;
    /** Its primary reading. */
    reading: string;
    /** Every reading the entry lists, primary included: a katakana spelling only counts when it is one of them. */
    readings: string[];
    /** JMdict tags the first sense `uk` (usually written using kana alone). */
    firstSenseUk: boolean;
    /** The headword has no normal display kanji: JMdict tags it `rK` (rarely used) or `sK` (search-only). */
    rareKanjiForm: boolean;
}

export interface UsuallyKanaDecision {
    usuallyKana: boolean;
    /** Best JPDB rank of the word written in kana (hiragana or its own katakana spelling), when known. */
    kanaRank: number | null;
}

/**
 * Whether a word is learned in kana rather than through its kanji spelling: ここ,
 * not 此処; あの, not 彼の. Chosen by benchmarking every available signal against
 * 1,175 hand-labelled words (see docs/SCHEMA.md, "usuallyKana"):
 *
 *  - JMdict's `uk` tag alone flags 分かる, 眼鏡 and 大体: it is set per sense and
 *    is noisy. JPDB's kana/kanji frequency alone flags 物, 所 and 訳, whose kanji
 *    spellings are standard. Requiring both leaves almost only real cases.
 *  - The kana side counts the word's own katakana spelling too (ゴミ, カルタ), but
 *    only a row whose key is unique: ボタン is also "button".
 *  - Only the row for the word's own reading is evidence. Borrowing another
 *    reading's row made 皆/みな look usually-kana through みんな.
 *  - When JPDB has no row at all for the kanji spelling, the standalone kana row
 *    is the evidence (すみません, ございます), again only when unambiguous.
 *  - JMdict's `rK` (rarely used) and `sK` (search-only) kanji stand in for
 *    frequency JPDB cannot give: 此方/こちら has a row only under こっち, and の's
 *    only kanji (乃, 之) are both search-only, so JPDB never ranks it in kanji.
 *
 * Doubtful cases stay in kanji: the kanji spelling disambiguates homophones (いる
 * is 居る and 要る), so a wrong kana display costs more than a missed one. The
 * residue is excluded by hand in data/raw/vocab/usually-kana-overrides.json.
 */
export function decideUsuallyKana(input: UsuallyKanaInput, jpdb: JpdbTable): UsuallyKanaDecision {
    const unique = (key: string) => {
        const rows = jpdb.rows.get(key);
        return rows?.length === 1 ? rows[0] : undefined;
    };
    const katakana = toKatakana(input.reading);
    const katakanaRank = katakana !== input.reading && input.readings.includes(katakana)
        ? unique(`${katakana}|${katakana}`)?.frequency ?? null
        : null;
    const best = (...ranks: (number | null | undefined)[]) => {
        const known = ranks.filter((r): r is number => typeof r === 'number');
        return known.length ? Math.min(...known) : null;
    };

    const own = jpdb.rows.get(`${input.kanji}|${input.reading}`)?.[0];
    let kanjiRank: number | null;
    let kanaRank: number | null;
    if (own) {
        kanjiRank = own.frequency;
        kanaRank = best(own.kanaFrequency, katakanaRank);
    } else if (jpdb.terms.has(input.kanji)) {
        // JPDB knows this spelling only under another reading: no evidence either way.
        kanjiRank = null;
        kanaRank = null;
    } else {
        kanjiRank = Number.POSITIVE_INFINITY;
        kanaRank = best(unique(`${input.reading}|${input.reading}`)?.frequency, katakanaRank);
    }

    const kanaDominant = kanjiRank !== null && kanaRank !== null && kanjiRank / kanaRank >= USUALLY_KANA_RATIO;
    return {
        usuallyKana: input.firstSenseUk && (kanaDominant || input.rareKanjiForm),
        kanaRank,
    };
}

/** Hand corrections to decideUsuallyKana (data/raw/vocab/usually-kana-overrides.json). */
export interface UsuallyKanaOverrides {
    /** Vocab id -> why it stays in kanji although the rule flags it. */
    exclude: Record<string, { word: string; why: string }>;
}

/**
 * The flagged ids minus the hand exclusions. An exclusion that names no compiled
 * word, or a word the rule no longer flags, is an error: the list only holds live
 * corrections, so a JPDB or JMdict update that fixes a case also cleans it up.
 */
export function applyUsuallyKanaOverrides(
    flagged: ReadonlySet<string>,
    compiledIds: ReadonlySet<string>,
    overrides: UsuallyKanaOverrides,
): Set<string> {
    const kept = new Set(flagged);
    for (const [id, { word }] of Object.entries(overrides.exclude)) {
        if (!compiledIds.has(id)) {
            throw new Error(`usually-kana-overrides: ${id} (${word}) is not a compiled vocab id.`);
        }
        if (!flagged.has(id)) {
            throw new Error(`usually-kana-overrides: ${id} (${word}) is no longer flagged usually-kana; remove the exclusion.`);
        }
        kept.delete(id);
    }
    return kept;
}

/** The frequency a word is met at: its kana spelling's for a word learned in kana, else its kanji spelling's. */
export function learningRank(vocab: Pick<Vocabulary, 'frequency' | 'usuallyKana'>): number {
    return vocab.usuallyKana
        ? vocab.frequency.kanaRank ?? vocab.frequency.kanjiRank
        : vocab.frequency.kanjiRank;
}

/**
 * A word's entry in the learning-order indexes (frequency.json, jlpt.json). Its
 * `containedKanji` are the kanji the learner must know to be shown it, so a word
 * learned in kana has none: ここ never waits on 此 and 処. The vocab file keeps the
 * kanji spelling's real kanji for display.
 */
export function learningIndexEntry(vocab: Pick<Vocabulary, 'id' | 'writtenForm' | 'usuallyKana'>): VocabIndexEntry {
    return vocab.usuallyKana
        ? { id: vocab.id, containedKanji: [], usuallyKana: true }
        : { id: vocab.id, containedKanji: vocab.writtenForm.containedKanji };
}

/** The fields compareMergeBase orders homographs by. */
export interface MergeCandidate {
    /** The first sense is only a suffix, prefix or counter (時/じ "o'clock", 君/くん): see isAffixOnly. */
    affixOnly: boolean;
    /** JMdict marks the headword common. */
    isCommon: boolean;
    /** JLPT level of this JMdict entry itself (5 = N5), undefined when not listed. */
    jlptLevel?: number;
    /** How often anime says this exact entry (Jiten, by JMdict id). */
    spoken: number;
    ownRank: number | null;
    frequency: { kanjiRank: number };
}

/**
 * Orders homographs sharing a kanji spelling so the first becomes the merged
 * entry's base, whose id, primary reading and senses the merged word takes.
 *
 *  1. A reading on Waller's JLPT lists before one that is not: 内 is うち (N4), not
 *     the rare ない; 達 is たち, not the slang だち.
 *  2. Then, when the group has a common word that stands alone, that word before an
 *     affix: the headword is shown alone, so 時 is とき, not the suffix じ ("o'clock",
 *     which the decks list at N5 while the id list has とき at N3), and 君 is きみ, not
 *     くん, which anime says more often. Only a COMMON standalone word: otherwise an
 *     obscure noun beat a core suffix (氏 went to うじ "clan", N1, over し "Mr.; he",
 *     N3), so without one the level decides.
 *  3. Then the easiest level: 上手 is じょうず (N5), not うわて (N1).
 *  4. Then the reading anime actually says, counted per JMdict entry by Jiten, so a
 *     JPDB row inflated by a homophone cannot win: JPDB ranks 内|ない through the
 *     auxiliary ない, while Jiten counts うち 1925 times and ない 19.
 *  5. Then JPDB, as before: a word JPDB ranks under one of its own readings
 *     (`ownRank`) before one ranked on its spelling's stand-in row (build-data.ts
 *     gives a reading with no row its spelling's first row). The tie used to go to
 *     JMdict order: N4 点 was merged under ちょぼ instead of てん.
 */
export function compareMergeBase(a: MergeCandidate, b: MergeCandidate, demoteAffixes = true): number {
    return Number(a.jlptLevel === undefined) - Number(b.jlptLevel === undefined)
        || (demoteAffixes ? Number(a.affixOnly) - Number(b.affixOnly) : 0)
        || (b.jlptLevel ?? 0) - (a.jlptLevel ?? 0)
        || b.spoken - a.spoken
        || Number(a.ownRank === null) - Number(b.ownRank === null)
        || (a.ownRank ?? a.frequency.kanjiRank) - (b.ownRank ?? b.frequency.kanjiRank);
}

/** Sorts a homograph group so its first member is the merged entry's base (see compareMergeBase). */
export function sortMergeGroup<T extends MergeCandidate>(group: T[]): T[] {
    const hasCommonWord = group.some(c => !c.affixOnly && c.isCommon);
    return group.sort((a, b) => compareMergeBase(a, b, hasCommonWord));
}

const AFFIX_POS = ['suf', 'n-suf', 'pref', 'n-pref', 'ctr'];

/** Whether a sense's parts of speech are only affixes: 君/くん (suf), not 的/てき (suf, adj-na). */
export function isAffixOnly(pos: string[]): boolean {
    return pos.length > 0 && pos.every(p => AFFIX_POS.includes(p));
}

/** JMdict tags marking a spelling that is not how the word is normally written. */
const IRREGULAR_SPELLING_TAGS = ['rK', 'sK', 'ateji', 'iK', 'oK'];

/**
 * Whether a word may be merged with the other words written like it. Only when the
 * shared spelling is a normal spelling of this word: 彼 is how かれ is written, but
 * only a rare spelling of あれ, and 米 is ateji for メートル. Merging on such a
 * spelling folded different words into one entry (あれ became a reading of かれ and
 * lost its N5 level and its kana display; 米 offered メートル as a reading of rice).
 */
export function mayShareHeadword(headwordTags: string[]): boolean {
    return !headwordTags.some(tag => IRREGULAR_SPELLING_TAGS.includes(tag));
}

/**
 * Occurrences per JMdict id across every episode of the listening library's Jiten
 * snapshots (data/raw/media/jiten): how often anime says each exact entry. Jiten
 * parses to JMdict ids, so homographs are counted apart, unlike JPDB's rows.
 */
export function readSpokenCounts(dir: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
        const snapshot = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as { episodes?: Array<{ words: Array<[number, number]> }> };
        for (const episode of snapshot.episodes ?? []) {
            for (const [id, count] of episode.words) counts.set(String(id), (counts.get(String(id)) ?? 0) + count);
        }
    }
    return counts;
}

export function buildMiscFlags(misc: Array<string>) {
    return {
        isAbbreviation: misc.includes("abbr"),
        isSuffix: misc.includes("suf") || misc.includes("n-suf"),
        isPrefix: misc.includes("pref") || misc.includes("n-pref"),
        isArchaic: misc.includes("arch"),
        isRare: misc.includes("rare"),
        rawTags: misc,
    };
}