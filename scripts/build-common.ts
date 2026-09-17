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
 * Keying only on the kanji headword silently dropped ~490 words, including N5
 * vocabulary as basic as かばん and ごはん.
 *
 * Order matters. Written forms are tried first and accept the dataset's own
 * fallback entry, since a written-form hit is already strong evidence. A reading
 * key is only accepted when the matched entry's reading equals this word's
 * primary reading: readings are far more ambiguous than written forms, and a
 * loose reading match would hand 紙's N5 to every rare homophone of かみ.
 */
export function resolveJlptLevel(
    jlptVocab: Record<string, Array<{ reading: string; level: number }>>,
    writtenForms: string[],
    readings: string[],
): number | undefined {
    const primaryReading = readings[0];

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
        return match.level;
    }

    for (const reading of readings) {
        const entries = jlptVocab[reading];
        if (!entries?.length) continue;
        const match = entries.find(e => e.reading === primaryReading);
        if (match) return match.level;
    }

    return undefined;
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