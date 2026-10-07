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

/** JPDB frequency data as build-data.ts loads it: written form -> reading -> ranks. */
export type JpdbFrequencies = Record<string, Record<string, { frequency: number; kanaFrequency: number | null }>>;

/** Hand-authored owners for kana keys the automatic pick gets wrong (data/raw/vocab/jlpt-kana-owners.json). */
export interface KanaOwnerOverrides {
    owners: Record<string, { owner: string | null; word?: string; why: string }>;
}

/** JLPT kana key -> the JMdict id it names, or null when it names no entry. */
export type KanaKeyOwners = Map<string, string | null>;

const KANA_ONLY = /^[぀-ヿー]+$/;
const NO_RANK = Number.MAX_SAFE_INTEGER;

/**
 * Decide which JMdict entry each JLPT kana key names.
 *
 * The JLPT list files many words under kana only: 鞄 as かばん, 石鹸 as
 * せっけん, 綺麗 as きれい. A kana key names one word, but every homophone
 * carries that reading, so crediting each word whose reading matches handed
 * soap's N5 to 席巻 ("sweeping conquest") and 接見 ("audience"), and the N5
 * やる to 殺る ("to kill"). Each key is therefore awarded to exactly one entry:
 *
 *  1. When some candidate is usually written in kana (`uk`) or has no kanji
 *     at all, the list wrote the word in kana because that is how it is
 *     written, so the owner is one of those: こう is 斯う, もし is 若し,
 *     やる is 遣る. A kana-only owner (でも, どうぞ) is simply absent from this
 *     dataset, which stops a kanji homophone (はい: 灰, 肺) from taking it.
 *  2. Otherwise the list spelled a kanji word in kana for beginners (いす for
 *     椅子, せっけん for 石鹸), and the owner is the most frequent candidate.
 *
 * Common kana spellings rank first in both cases, then JPDB frequency. The
 * overrides file corrects the residue (はく is 履く, not 吐く).
 */
export function buildKanaKeyOwners(
    jlptVocab: Record<string, unknown>,
    words: Array<{
        id: string;
        kanji: Array<{ text: string }>;
        kana: Array<{ text: string; common: boolean; tags: unknown[] }>;
        sense: Array<{ misc: unknown[] }>;
    }>,
    jpdb: JpdbFrequencies,
    overrides: KanaOwnerOverrides = { owners: {} },
): KanaKeyOwners {
    const byKana = new Map<string, typeof words>();
    for (const word of words) {
        for (const kana of word.kana) {
            // Search-only spellings are not how the word is written.
            if (kana.tags.includes('sk')) continue;
            const list = byKana.get(kana.text) ?? [];
            list.push(word);
            byKana.set(kana.text, list);
        }
    }

    const isUsuallyKana = (w: typeof words[number]) => w.sense.some(s => s.misc.includes('uk'));
    const kanaUncommon = (w: typeof words[number], key: string) =>
        w.kana.find(k => k.text === key)?.common ? 0 : 1;
    // How often the word appears written as this kana.
    const kanaRank = (w: typeof words[number], key: string) => w.kanji.length
        ? Math.min(NO_RANK, ...w.kanji.map(k => jpdb[k.text]?.[key]?.kanaFrequency ?? NO_RANK))
        : jpdb[key]?.[key]?.frequency ?? NO_RANK;
    // How often the word appears at all, written in kanji.
    const kanjiRank = (w: typeof words[number], key: string) =>
        Math.min(NO_RANK, ...w.kanji.map(k => jpdb[k.text]?.[key]?.frequency ?? NO_RANK));

    const owners: KanaKeyOwners = new Map();
    for (const key of Object.keys(jlptVocab)) {
        if (!KANA_ONLY.test(key)) continue;
        const candidates = byKana.get(key);
        if (!candidates?.length) continue;

        const kanaWritten = candidates.filter(w => !w.kanji.length || isUsuallyKana(w));
        const [owner] = kanaWritten.length
            ? [...kanaWritten].sort((a, b) => kanaUncommon(a, key) - kanaUncommon(b, key) || kanaRank(a, key) - kanaRank(b, key))
            : [...candidates].sort((a, b) => kanaUncommon(a, key) - kanaUncommon(b, key) || kanjiRank(a, key) - kanjiRank(b, key));
        owners.set(key, owner.id);
    }

    for (const [key, { owner }] of Object.entries(overrides.owners)) {
        if (!(key in jlptVocab)) {
            throw new Error(`jlpt-kana-owners: "${key}" is not a key of the JLPT list.`);
        }
        if (owner !== null && !byKana.get(key)?.some(w => w.id === owner)) {
            throw new Error(`jlpt-kana-owners: ${owner} is not a JMdict entry read "${key}".`);
        }
        owners.set(key, owner);
    }

    return owners;
}

/**
 * Resolve a word's JLPT level from the Bluskyo dataset, which is keyed by
 * written form -> one or more { reading, level } pairs.
 *
 * The lookup has to try more than the primary written form, because the source
 * files a word under the form it is normally *written* in, while JMDict files it
 * under its kanji headword. The two disagree in two ways:
 *
 *  - Orthography variants: JMDict's headword is 近づく, the JLPT list says 近付く.
 *  - Kana-usually (`uk`) words: 鞄 is listed as かばん, with no kanji key at all.
 *
 * Written forms are tried first and accept the dataset's own fallback entry,
 * since a written-form hit is already strong evidence. A kana key counts only
 * when this entry owns it (see buildKanaKeyOwners): readings are far more
 * ambiguous than written forms.
 *
 * When both match, the easiest level wins. The source often lists a word twice,
 * its rare kanji spelling at N1 and its kana spelling at N5 (綺麗 and きれい,
 * 美味しい and おいしい), and the word is met at N5. Taking the written-form
 * level alone labelled きれい, おいしい and かわいい as N1.
 */
export function resolveJlptLevel(
    jlptVocab: Record<string, Array<{ reading: string; level: number }>>,
    entryId: string,
    writtenForms: string[],
    readings: string[],
    kanaOwners: KanaKeyOwners,
): number | undefined {
    const primaryReading = readings[0];
    const levels: number[] = [];

    for (const form of writtenForms) {
        const entries = jlptVocab[form];
        if (!entries?.length) continue;
        // Prefer this word's own reading, then any listed reading, then the
        // dataset's first entry - a written form can carry different levels per
        // reading, and the first entry is an arbitrary pick of last resort.
        const match =
            entries.find(e => e.reading === primaryReading)
            ?? entries.find(e => readings.includes(e.reading))
            ?? entries[0];
        levels.push(match.level);
        break;
    }

    for (const reading of readings) {
        if (kanaOwners.get(reading) !== entryId) continue;
        // A kana key can list the word at several levels (ここ at N3 and N5).
        for (const e of jlptVocab[reading] ?? []) {
            if (e.reading === reading) levels.push(e.level);
        }
    }

    // Levels run 1 (N1, hardest) .. 5 (N5, easiest).
    return levels.length ? Math.max(...levels) : undefined;
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
    /** JMdict tags the headword `rK` (rarely used kanji form). */
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
 *  - JMdict's `rK` stands in for frequency JPDB cannot give: 此方/こちら has a
 *    row only under こっち.
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

/**
 * Orders homographs sharing a kanji spelling so the first becomes the merged
 * entry's base, whose id, primary reading and senses the merged word takes.
 *
 * A reading JPDB has no row for gets its spelling's first row as a stand-in rank
 * (build-data.ts), so a rare reading ties with the common one it borrowed from.
 * The tie went to JMdict order: N4 点 was merged under ちょぼ instead of てん, 節
 * under ノット, 種 under くさ. So a word JPDB ranks under one of its own readings
 * (`ownRank`, the best such row) wins first, ordered by that rank. Any reading of
 * the entry counts, not only the primary: JPDB files 此方 under こっち, which is the
 * こちら entry's, and checking the primary alone handed 此方 to the archaic こなた.
 */
export function compareMergeBase(
    a: { ownRank: number | null; frequency: { kanjiRank: number } },
    b: { ownRank: number | null; frequency: { kanjiRank: number } },
): number {
    return Number(a.ownRank === null) - Number(b.ownRank === null)
        || (a.ownRank ?? a.frequency.kanjiRank) - (b.ownRank ?? b.frequency.kanjiRank);
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