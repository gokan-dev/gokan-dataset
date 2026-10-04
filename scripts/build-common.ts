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