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