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
    /**
     * The Japanese/pattern portion only, e.g. "～けど、～" - the upstream source
     * bundled this together with a romaji transliteration in a trailing
     * parenthetical (e.g. "～けど、～ (〜kedo、～)"); split apart at build time
     * so a consumer can choose where to show which (see `romaji` below) instead
     * of the two being welded into one string.
     */
    title: string;
    /**
     * Romaji transliteration split out of the upstream title's trailing
     * parenthetical (e.g. "kedo" for title "～けど、～"). Absent for the small
     * minority of points (~1.3%, 11/828 as of the last build) where the
     * upstream title has no trailing parenthetical to split, or has one in an
     * unparseable shape (mid-string rather than trailing) - those keep their
     * full original string as `title` unsplit rather than guessing.
     */
    romaji?: string;
    /** JLPT level (1 = N1 hardest .. 5 = N5 easiest), matching Vocabulary.jlptLevel's convention. Every grammar point carries one, since this dataset is itself organized by level. */
    jlptLevel: number;
    shortExplanation: string;
    longExplanation: string;
    /** Formation template shown to the user, e.g. "Noun + が + いちばん + Adjective/Verb". */
    formation: string;
    /**
     * The NATURE of this point, which decides what exercise can test it.
     *
     * The discriminating test is about the answer key, not the text:
     * **can you write the correct answer without knowing which word it attaches
     * to?**
     *
     *  - 'construction' YES. The point's identity IS a fixed string (ので,
     *                   しか〜ない, ことがある). A cloze blank on that string
     *                   tests the point. The vast majority.
     *  - 'inflection'   NO. The point's identity is an OPERATION, and the answer
     *                   differs per input word (飲む→飲んで, 食べる→食べて,
     *                   する→して). There is nothing invariant to blank, so a
     *                   cloze quiz cannot test it - it needs a transformation
     *                   drill.
     *  - 'lexical'      YES, but the answer is a single dictionary word (いつも,
     *                   ほとんど). Testable, though arguably vocabulary wearing
     *                   a grammar hat. Not yet populated - see the kinds issue.
     *
     * Note that PRESUPPOSING a form is not the same as TEACHING one: 339 of 788
     * points presuppose a conjugated form, but only 20 teach a derivation. This
     * is why the classification is hand-authored (data/raw/grammar/kinds.json)
     * and not detected - mechanical signals like "the located pattern includes a
     * conjugated word" fire on 386 of 788.
     */
    kind: 'construction' | 'inflection' | 'lexical';
    /**
     * For `kind: 'inflection'` only: which derivation this point teaches, e.g.
     * "て-form", "causative (させる)". This is what a transformation quiz keys
     * off to generate its answer set, so the build rejects an inflection point
     * without one.
     */
    derives?: string;
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
     * The near-synonym family this point belongs to, if any (most points don't
     * have one - a plain construction with no close synonym leaves this unset).
     * Replaces a flat, unlabeled `relatedPoints: string[]` (issue feedback: a bare
     * list of linked ids gave the app nothing to call the relationship by - "but"
     * and "because" were both just "related points"). `id`/`name` are the same for
     * every member of a family (symmetric), sourced from the same hand-authored
     * `data/raw/grammar/formality.json` mapping as formalityLevel/usageNote - see
     * docs/SCHEMA.md. Not a strict "identical meaning" claim, just "a learner
     * asking how to say X would be shown these together". Also emitted as
     * `compiled/grammar/index/families.json` (familyId -> {name, memberIds}) for
     * any future family-browsing view, so a consumer isn't forced to scan every
     * point file to answer "what's in the Contradiction family".
     */
    family?: {
        /** Stable slug, e.g. "contradiction" - shared by every member of this family. */
        id: string;
        /** Display name, e.g. "Contradiction (But / However)". */
        name: string;
        /** Ids of the OTHER points in this family (excludes this point's own id). */
        relatedPoints: string[];
        /**
         * What this member adds over its siblings - the thing that decides
         * whether they may be taught adjacently. 70 of 84 families span more
         * than one JLPT level, and level alone can't say which of those spreads
         * is safe to collapse:
         *
         *  - 'register'   differs ONLY by formality (でも casual / しかし formal /
         *                 けれども literary). No new structure, so these group
         *                 ACROSS levels - だが (N2) belongs beside でも (N5),
         *                 because once you know でも it's a one-line register fact.
         *  - 'constraint' adds a semantic restriction that can be got wrong
         *                 (おかげで frames the cause favourably, ばかりに
         *                 unfavourably). Stays level-gated as an escalation ladder.
         *  - 'variant'    no differentiator exists - the siblings are
         *                 interchangeable stylistic choices (9 of the 12
         *                 regardless-a-or-b members share one usageNote verbatim).
         *                 Taught as a single recognition set.
         *
         * Also tells a consumer WHAT to say when introducing the point, which is
         * the other half of making adjacency safe: proximity without a stated
         * differentiator is worse than scattering. Absent for members not yet
         * classified. See docs/SCHEMA.md.
         */
        axis?: 'register' | 'constraint' | 'variant';
    };
}

/** JLPT level (1..5) -> grammar point ids, in the source's original order (alphabetical - grammar has no frequency data to sort by, unlike vocab). */
export type GrammarJlptIndex = Record<number, string[]>;

/**
 * One chapter of the authored teaching order: a run of grammar points that are
 * meant to be met together. Emitted as part of
 * `compiled/grammar/index/teaching-order.json`.
 */
export interface GrammarChapter {
    /** Stable slug, e.g. "n5-c17". Safe to store against user progress. */
    id: string;
    /** Short display name, e.g. "But: six ways, one meaning". */
    title: string;
    /** One or two sentences on what the chapter teaches, and why these points sit together. */
    summary: string;
    /**
     * The level this chapter is placed at. A chapter can legitimately CONTAIN
     * points from harder levels when they are register siblings of a point it
     * already teaches (see GrammarPoint.family.axis) - so this is the chapter's
     * position in the curriculum, not a claim about every member's own level.
     */
    jlptLevel: number;
    /** Member point ids, in teaching order. */
    points: string[];
}

/**
 * The authored teaching order. `order` is every surviving point id in the
 * sequence they should be introduced - the flattening of `chapters`, provided
 * so a consumer that only needs "what comes next" doesn't have to flatten it
 * itself. Every non-duplicate point appears in exactly one chapter, and the
 * build fails if that isn't true.
 */
export interface GrammarTeachingOrder {
    order: string[];
    chapters: GrammarChapter[];
}
