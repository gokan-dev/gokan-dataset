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
    /** Kuromoji's dictionary/base form (e.g. "思う" for the conjugated token "思っ"), only set when it differs from `surface`. Lets pattern-location match a formation's dictionary-form literal (e.g. "くれる") against a conjugated token in the sentence (e.g. "くれ") without needing fuzzy/edit-distance matching. */
    baseForm?: string;
}

export interface GrammarExample {
    jp: string;
    romaji: string;
    en: string;
    words: GrammarExampleWord[];
    /**
     * Indices into `words[]` identifying this example's grammar-pattern markers
     * (the literal, invariant part of `formation` - e.g. が and いちばん for
     * "Noun + が + いちばん + Adjective/Verb"), located at build time by
     * matching `formation` against `words[]` surface/baseForm/reading. Always
     * present (possibly empty) so the app never needs to run this matching
     * itself. Empty when the pattern could not be confidently located in this
     * specific example - see docs/SCHEMA.md and the grammar-pattern-location
     * issue for the small set of points where this happens across all examples.
     */
    patternWordIndices: number[];
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
    /**
     * Register/formality of this point, for points that have one (most don't -
     * plain descriptive constructions with no close synonym leave this unset).
     * Sourced from a hand-authored, reviewable mapping (data/raw/grammar/formality.json),
     * not derived at build time - see docs/SCHEMA.md and the grammar-formality issue
     * for the methodology. Exists specifically so gokan-srs can disambiguate quiz
     * points that are near-synonyms differing mainly by register (e.g. でも/しかし/
     * けれども all gloss as "but") without relying on longExplanation, which is too
     * long for a quiz card and doesn't consistently cover register today.
     */
    formalityLevel?: 'casual' | 'neutral' | 'polite' | 'formal' | 'very-formal-literary';
    /**
     * One short, quiz-card-length line (~60-80 chars) covering whatever actually
     * disambiguates this point from its near-synonyms. Usually register, but for
     * some clusters (e.g. even-though/although/despite) the real differentiator is
     * connotation/nuance instead (criticism, surprise, unmet expectation) rather
     * than a clean formality ladder - see the grammar-formality issue. Deliberately
     * NOT a duplicate of longExplanation.
     */
    usageNote?: string;
    /**
     * Ids of other GrammarPoints expressing the same core idea at a different
     * formality/nuance (symmetric - if A lists B, B should list A). Not a strict
     * "identical meaning" claim, just "a learner asking how to say X would be
     * shown these together".
     */
    relatedPoints?: string[];
}

/** JLPT level (1..5) -> grammar point ids, in the source's original order (alphabetical - grammar has no frequency data to sort by, unlike vocab). */
export type GrammarJlptIndex = Record<number, string[]>;
