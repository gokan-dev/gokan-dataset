export interface Vocabulary {
    /** JMdict word ID (lexeme-level, stable) */
    id: string;

    /** Primary written form (common kanji form) */
    writtenForm: {
        kanji: string;
        alternatives: string[]; // alternative kanji writings
        containedKanji: string[];
    };

    /** Reading information */
    reading: {
        primary: string;        // main reading shown on intro card
        alternatives: string[]; // other valid readings (rare, secondary)
    };

    /** Frequency information */
    frequency: {
        kanjiRank: number;
        kanaRank?: number;
    };

    /** JLPT level (1=N1 hardest ... 5=N5 easiest), if this word is JLPT-tagged. Descriptive/display-only - not used for learning order. */
    jlptLevel?: number;

    /** Learning order constraints */
    progression: {
        kklcStep: number;
    };

    /** IDs of other vocabularies contained within this one (for inheritance) */
    components?: string[];

    /** IDs of other vocabularies this word is a component of */
    parents?: string[];

    /** Linguistic senses (kept separate, structured) */
    senses: Sense[];

    /** Derived helpers for card generation (optional but useful) */
    usageHints?: UsageHints;

    /** If this entry is a unified merged entry from multiple homographs sharing the exact kanji form */
    mergedVocabs?: MergedVocabInfo[];
}

export interface MergedVocabInfo {
    /** The original JMDict ID of the merged word */
    id: string;
    /** True if this was the highest frequency word that absorbed the others */
    isBase: boolean;
    /** The original primary reading for this specific word */
    originalPrimaryReading: string;
    /** A quick summary of what this specific reading meant (e.g. its main glosses) */
    originalGlosses: string[];
}

export interface Sense {
    /** Part(s) of speech for THIS sense */
    pos: string[];

    /** Register / usage flags (arch, abbr, suffix, etc.) */
    misc: {
        isAbbreviation?: boolean;
        isSuffix?: boolean;
        isPrefix?: boolean;
        isArchaic?: boolean;
        isRare?: boolean;
        rawTags: string[]; // kept for display/debug, not logic
    };

    /** Meanings, grouped by sense */
    glosses: string[];

    /** Structured related terms (for context generation) */
    related: {
        compounds: string[]; // e.g. 中学校, 中国
    };

    /** If this sense only applies to specific readings (used for disambiguating merged vocabs) */
    appliesToReadings?: string[];
}

export interface UsageHints {
    /** Suggested minimal context for intro card */
    examplePattern?: string; // e.g. "〜中", "Xの中"

    /** True if reading depends on context (homograph warning) */
    requiresContext: boolean;
}



export interface ReviewLog {
    date: number;
    result: 'correct' | 'minor_error' | 'wrong' | 'pass';
    interval: number;
    latency: number; // ms
}

export interface SRSEntry {
    memoryStrength: number;
    interval: number; // days
    difficulty: number; // 0.0 (hard) to 1.0 (easy) - default 0.3
    lastReviewedAt: Date | null;
    dueDate: Date | null;
    history: ReviewLog[];
}

/** Per-quiz-type immediate-retry flag. A wrong reading answer only forces a reading
 *  retry; it never blocks meaning reviews (and vice versa). */
export interface NeedsRetryFlags {
    reading?: boolean;
    meaning?: boolean;
}

export interface VocabProgress {
    vocabId: string;
    stage: 'learning' | 'graduated';
    introductionAt: Date | null;
    nextReviewAt: Date | null;
    lastReviewedAt: Date | null;
    totalReviews: number;
    consecutiveFailures: number;

    // Detailed SRS data
    reading: SRSEntry;
    meaning: SRSEntry;
    needsRetry?: NeedsRetryFlags;
}

export const DEFAULT_SRS_ENTRY: SRSEntry = {
    memoryStrength: 1.0, // Default start strength (days)
    interval: 0,
    difficulty: 0.3, // Default difficulty
    lastReviewedAt: null,
    dueDate: null,
    history: []
};

export const DEFAULT_VOCABULARY_PROGRESS: VocabProgress = {
    vocabId: '',
    stage: 'learning',
    introductionAt: null,
    nextReviewAt: null,
    lastReviewedAt: null,
    totalReviews: 0,
    consecutiveFailures: 0,
    reading: { ...DEFAULT_SRS_ENTRY },
    meaning: { ...DEFAULT_SRS_ENTRY }
};