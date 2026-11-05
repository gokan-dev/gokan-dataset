import type { AudioRef } from './audio.model';
import type { TextByLanguage } from './text.model';

export interface Sentence {
    id: string;       // JP_ID from source
    original: string; // Japanese text
    /** Its translations, by language: Tatoeba's, one rendering per translated sentence. */
    text: TextByLanguage;
    indices?: string; // Reading hint/furigana string from jpn_indices.csv
    vocabIds: string[]; // List of constituent vocab IDs (for containment checks)
    matches?: Record<string, { start: number, length: number, reading?: string }[]>; // vocabId -> match locations (for highlighting)
    /** The sentence read aloud, when a clip of it exists (scripts/attach-audio.ts). */
    audio?: AudioRef;
}

export interface SentenceSet {
    vocabId: string;
    sentences: Sentence[];
}
