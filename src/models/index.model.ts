export interface KKLCIndex {
    [step: number]: string[];
}

/**
 * One vocab in a learning-order index. `containedKanji` are the kanji a learner must
 * know to be shown the word: empty for a word learned in kana (`usuallyKana`), whose
 * vocab file still lists its kanji spelling's kanji.
 */
export interface VocabIndexEntry {
    id: string;
    containedKanji: string[];
    usuallyKana?: true;
}

/** Every vocab, most frequent first (a word learned in kana at its kana spelling's rank). */
export type FrequencyIndex = VocabIndexEntry[];

export type KKLCKanjiIndex = Record<number, string[]>;

export type KanjiVocabIndex = Record<string, string[]>;

/**
 * JLPT level (1 = N1 hardest .. 5 = N5 easiest) -> vocab at that level,
 * sorted by frequency rank. Entries mirror FrequencyIndex's shape so the
 * candidate-finding code can share the same filtering.
 */
export type JlptIndex = Record<number, VocabIndexEntry[]>;

export const JLPT_LEVELS = [5, 4, 3, 2, 1] as const;

export interface SearchIndexEntry {
    id: string;
    w: string; // kanji
    r: string; // reading
    m: string; // meaning
    u?: true; // learned in kana: show `r` as the headword
}

export type SearchIndex = SearchIndexEntry[];
