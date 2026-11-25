import type { AudioRef } from './audio.model';
import type { TextByLanguage } from './text.model';

/** Where a word occurs in a sentence: a span of `Sentence.original`. */
export interface SentenceMatch {
    start: number;
    length: number;
    reading?: string;
    /**
     * Which of the word's common patterns this occurrence is, as an index into its
     * `Vocabulary.patterns` (scripts/build-data.ts, src/utils/wordPatterns.ts): a word page
     * finds a pattern's sentences without parsing them. Absent when it is none of them.
     */
    pattern?: number;
}

export interface Sentence {
    id: string;       // JP_ID from source
    original: string; // Japanese text
    /** Its translations, by language: Tatoeba's, one rendering per translated sentence. */
    text: TextByLanguage;
    indices?: string; // Reading hint/furigana string from jpn_indices.csv
    vocabIds: string[]; // List of constituent vocab IDs (for containment checks)
    matches?: Record<string, SentenceMatch[]>; // vocabId -> match locations (for highlighting)
    /** The sentence read aloud, when a clip of it exists (scripts/attach-audio.ts). */
    audio?: AudioRef;
}

export interface SentenceSet {
    vocabId: string;
    sentences: Sentence[];
}
