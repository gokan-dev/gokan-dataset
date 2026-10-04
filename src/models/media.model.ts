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
    /** 'hand' for a title picked by hand (the default), 'easiest' for one added by select-easiest-anime.ts. */
    source?: 'hand' | 'easiest';
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
    /** Jiten genre ids (see JITEN_GENRES). Absent in snapshots taken before genres were recorded. */
    genres?: number[];
    /** Jiten's community tags with their vote percentage, strongest first. */
    tags?: { name: string; percentage: number }[];
    episodes: {
        deckId: number;
        number: number;
        title: string;
        stats: JitenDeckStats;
        /** Aggregated by word id: Jiten lists a word once per reading it appears under. */
        words: JitenWordCount[];
    }[];
}

/**
 * One entry of `data/raw/media/covers.json` (keyed by Jiten deck id), written by
 * fetch-anilist-covers.ts. URLs only: the images stay on AniList's CDN.
 */
export interface MediaCoverSnapshot {
    anilistId: number;
    /** About 230px wide, for cards. */
    url: string;
    /** About 460px wide, for a title's own page. */
    urlHiRes: string;
    /** AniList's dominant colour for the art, a placeholder while it loads. */
    color?: string;
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
    /** Genre names, e.g. "Comedy", "Slice of Life". */
    genres: string[];
    /** Up to five of Jiten's strongest community tags, e.g. "Cute Girls Doing Cute Things". */
    tags: string[];
    /**
     * Cover art hosted by AniList. Not covered by this dataset's license: the
     * artwork belongs to its studio, so only the URL is stored and a consumer
     * loads it from AniList.
     */
    cover?: { url: string; urlHiRes: string; color?: string; source: 'AniList' };
    source: { name: 'Jiten'; url: string; license: 'CC BY-SA 4.0' };
}

/** `compiled/media/library.json`: each title's whole-series word list, for ranking the library without loading every title file. */
export type MediaLibraryWords = Record<string, MediaWordCount[]>;

/** Jiten's genre enum (Jiten.Core/Data/Genre.cs). */
export const JITEN_GENRES: Record<number, string> = {
    1: 'Action', 2: 'Adventure', 3: 'Comedy', 4: 'Drama', 5: 'Ecchi', 6: 'Fantasy', 7: 'Horror', 8: 'Mecha',
    9: 'Music', 10: 'Mystery', 11: 'Psychological', 12: 'Romance', 13: 'Sci-Fi', 14: 'Slice of Life',
    15: 'Sports', 16: 'Supernatural', 17: 'Thriller', 18: 'Adult',
};

/** `compiled/media/{id}.json`. */
export interface MediaTitle extends MediaIndexEntry {
    episodes: MediaEpisode[];
}
