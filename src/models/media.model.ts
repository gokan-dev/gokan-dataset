/**
 * Media (anime) vocabulary data, for the listening library.
 *
 * Sourced from Jiten (https://jiten.moe), whose derived data (vocabulary lists,
 * frequency and difficulty statistics) is CC BY-SA 4.0. Jiten never distributes
 * the subtitles it analyses, and neither does this dataset: what is stored is
 * which words an episode uses and how often, never what is said.
 */

/** One title picked by hand for the library (`data/raw/media/selection.json`). */
export interface MediaSelectionEntry {
    jitenDeckId: number;
    /** Free text for whoever maintains the list; not compiled. */
    note?: string;
}

/** A word as Jiten counts it: its JMdict id and how many times the deck uses it. */
export type JitenWordCount = [wordId: number, occurrences: number];

export interface JitenDeckStats {
    characterCount: number;
    wordCount: number;
    uniqueWordCount: number;
    uniqueKanjiCount: number;
    /** Morae per minute of speech. 0 when Jiten has no timing for the deck. */
    speechSpeed: number;
    /** Jiten's own difficulty estimate, roughly 0 (easiest) to 5. */
    difficulty: number;
}

/**
 * The trimmed snapshot `fetch-jiten.ts` writes to `data/raw/media/jiten/{deckId}.json`.
 * Only what the build reads is kept: the API also returns every word's full
 * dictionary entry, which the dataset already has from JMdict.
 */
export interface JitenMediaSnapshot {
    source: 'jiten';
    deckId: number;
    fetchedAt: string;
    sourceUrl: string;
    mediaType: number;
    title: { original: string; romaji: string | null; english: string | null };
    releaseDate: string | null;
    links: { type: number; url: string }[];
    stats: JitenDeckStats;
    episodes: {
        deckId: number;
        number: number;
        title: string;
        stats: JitenDeckStats;
        /** Aggregated by word id: Jiten lists a word once per reading it appears under. */
        words: JitenWordCount[];
    }[];
}

/** A compiled word count: a Gokan vocab id and its occurrences. */
export type MediaWordCount = [vocabId: string, occurrences: number];

export interface MediaEpisode {
    number: number;
    title: string;
    /** Morae per minute. 0 when unknown. */
    speechSpeed: number;
    /** Every word Jiten counted in the episode, Gokan vocabulary or not. */
    sourceUniqueWords: number;
    /** Only words that resolve to a Gokan vocab entry, most frequent first. */
    words: MediaWordCount[];
}

/** One entry of `compiled/media/index.json`. */
export interface MediaIndexEntry {
    id: string;
    kind: 'anime';
    title: { original: string; romaji?: string; english?: string };
    releaseYear?: number;
    episodeCount: number;
    /** Morae per minute across the whole series. 0 when unknown. */
    speechSpeed: number;
    /** Jiten's difficulty estimate, roughly 0 (easiest) to 5. */
    difficulty: number;
    links: { anilist?: string; myanimelist?: string };
    source: { name: 'Jiten'; url: string; license: 'CC BY-SA 4.0' };
}

/** `compiled/media/{id}.json`. */
export interface MediaTitle extends MediaIndexEntry {
    episodes: MediaEpisode[];
}
