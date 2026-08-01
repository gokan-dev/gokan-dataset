export interface KKLCIndex {
    [step: number]: string[];
}

export type FrequencyIndex = Array<{
    id: string,
    containedKanji: string[]
}>

export type KKLCKanjiIndex = Record<number, string[]>;

export type KanjiVocabIndex = Record<string, string[]>;

/**
 * JLPT level (1 = N1 hardest .. 5 = N5 easiest) -> vocab at that level,
 * sorted by frequency rank. Entries mirror FrequencyIndex's shape so the
 * candidate-finding code can share the same filtering.
 */
export type JlptIndex = Record<number, Array<{
    id: string;
    containedKanji: string[];
}>>;

export const JLPT_LEVELS = [5, 4, 3, 2, 1] as const;

export interface SearchIndexEntry {
    id: string;
    w: string; // kanji
    r: string; // reading
    m: string; // meaning
}

export type SearchIndex = SearchIndexEntry[];