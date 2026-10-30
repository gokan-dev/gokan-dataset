import type { AudioRef } from './audio.model';

export interface Sentence {
    id: string;       // JP_ID from source
    original: string; // Japanese text
    en: {
        id: string;     // EN_ID from source
        text: string;   // English translation
    }[];
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
