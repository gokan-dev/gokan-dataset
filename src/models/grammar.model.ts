/**
 * One tokenized word within a GrammarExample's Japanese sentence. `vocabId` is
 * resolved at build time by matching this word's surface/dictionary form against
 * the compiled vocab dataset (via compiled/index/search.json) - null for
 * particles, symbols, and anything that couldn't be resolved, which are always
 * shown literally and never turned into a blank. Concatenating every word's
 * `surface` in order reconstructs the example's `jp` string exactly.
 *
 * Consumer-side (gokan-srs app) note: this file mirrors only the data-shape
 * subset of the app's own grammar.model.ts (the app additionally carries
 * GrammarProgress / DEFAULT_GRAMMAR_PROGRESS, which are user-progress types,
 * not build-time DTOs - same split as vocabulary.model.ts).
 */
export interface GrammarExampleWord {
    surface: string;
    vocabId: string | null;
    /** The matched vocab's primary reading (hiragana) - only set when vocabId is set. Used to grade a blank without a runtime vocab fetch. */
    reading?: string;
}

export interface GrammarExample {
    jp: string;
    romaji: string;
    en: string;
    words: GrammarExampleWord[];
}

/**
 * A single grammar point (e.g. "A が いちばん～"). Sourced from the
 * hanabira.org-japanese-content dataset (data/raw/grammar/*.json, CC license,
 * attribution required - see the credit link on the gokan-srs About page).
 */
export interface GrammarPoint {
    /** Stable id assigned at build time from this vendored snapshot (e.g. "n5-001") - the upstream dataset has no ids of its own. */
    id: string;
    title: string;
    /** JLPT level (1 = N1 hardest .. 5 = N5 easiest), matching Vocabulary.jlptLevel's convention. Every grammar point carries one, since this dataset is itself organized by level. */
    jlptLevel: number;
    shortExplanation: string;
    longExplanation: string;
    /** Formation template shown to the user, e.g. "Noun + が + いちばん + Adjective/Verb". */
    formation: string;
    examples: GrammarExample[];
}

/** JLPT level (1..5) -> grammar point ids, in the source's original order (alphabetical - grammar has no frequency data to sort by, unlike vocab). */
export type GrammarJlptIndex = Record<number, string[]>;
