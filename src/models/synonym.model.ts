// A word's near-synonyms as compiled into its English text (scripts/build-synonyms.ts computes
// them). Types only, apart from that script, so a reader's type graph (src/layout/englishFile.ts,
// which runs in a browser) never reaches a Node script.

export type SynonymRelation = 'interchangeable' | 'confusable';

/** One entry of a compiled vocab file's `synonyms` list. */
export interface SynonymEntry {
    id: string;
    relation: SynonymRelation;
    /** Normalized glosses both words carry; empty for a hand-added pair with no overlap. */
    shared: string[];
    /** shared / smaller word's gloss count (see overlapScore). */
    overlap: number;
    /** Set when data/raw/vocab/synonyms.json decided the tier; the app never overrides a curated tier from context. */
    curated?: true;
}

/**
 * The OTHER word's answerable forms, embedded on each entry so a consumer can
 * tell whether a typed answer is that word without fetching its vocab file
 * (a word can list hundreds of pairs). Kept terse because it repeats on every
 * one of ~475k entries.
 */
export interface SynonymForms {
    /** Written forms: kanji first, then alternatives. */
    w: string[];
    /** Readings: primary first, then alternatives, then merged homographs' readings. */
    r: string[];
    /** The word's inflecting POS codes only (v5k, v1, vs, adj-i...), so its conjugated forms can be accepted too. */
    pos?: string[];
    /** Learned in kana (Vocabulary.usuallyKana): a consumer naming the word shows `r[0]`, not `w[0]`. */
    u?: true;
    /**
     * The word's frequency rank: its 1-based position in index/frequency.json. Absent
     * when JPDB does not rank it (those sit at the end of the file in no real order).
     * Lets a word page order and cut its synonyms without loading that 3 MB index.
     */
    f?: number;
}
