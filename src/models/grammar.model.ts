import type { AudioRef } from './audio.model';
import type { LanguageTag, TextByLanguage } from './text.model';

/**
 * The grammar dataset as the build assembles it: every entity carries its explanation-language
 * text in `text`, by language (docs/MULTILINGUAL.md, "Compiled output"). The layout writes each
 * file without it as its core, and the text under compiled/text/<lang>/. The shapes the files had
 * before the text layer are rebuilt by src/layout/legacy.ts.
 */

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

/** An example sentence. Its translation is a translation rendering in `text`. */
export interface GrammarExample {
    jp: string;
    romaji: string;
    words: GrammarExampleWord[];
    /**
     * Indices into `words[]` identifying this example's grammar-pattern markers
     * (the literal, invariant part of the formation - e.g. が and いちばん for
     * "Noun + が + いちばん + Adjective/Verb"), located at build time by
     * matching the formation against `words[]` surface/baseForm/reading. Always
     * present (possibly empty) so the app never needs to run this matching
     * itself. Empty when the pattern could not be confidently located in this
     * specific example - see docs/SCHEMA.md and the grammar-pattern-location
     * issue for the small set of points where this happens across all examples.
     */
    patternWordIndices: number[];
    /** The example read aloud, when a clip of it exists (scripts/attach-audio.ts). */
    audio?: AudioRef;
    text: TextByLanguage;
}

/**
 * A single grammar point (e.g. "{a} が いちばん～"). Sourced from the
 * hanabira.org-japanese-content dataset (data/raw/grammar/*.json, CC license,
 * attribution required - see the credit link on the gokan-srs About page).
 *
 * Its text, by language: labels `name` (the title's name, "Polite past"),
 * `derives`, `family` (the family's name, the family's own rendering), and
 * `title` / `romaji` (the source's spelling, only where rendering the core
 * would not give it back); prose `shortExplanation`, `longExplanation`,
 * `formation` and `usageNote`.
 */
export interface GrammarPoint {
    /** Stable id assigned at build time from this vendored snapshot (e.g. "n5-001") - the upstream dataset has no ids of its own. */
    id: string;
    /**
     * The Japanese/pattern portion only, with slot codes where the source
     * names a slot in English (`{noun} にもまして`, src/text/grammarSlots.ts).
     * The upstream source bundled this together with a romaji transliteration
     * in a trailing parenthetical (e.g. "～けど、～ (〜kedo、～)"); split apart
     * at build time so a consumer can choose where to show which.
     */
    title: string;
    /**
     * Romaji transliteration split out of the upstream title's trailing
     * parenthetical, with slot codes like `title`. Absent where the upstream
     * title has no trailing parenthetical to split, or has one in an
     * unparseable shape (mid-string rather than trailing) - those keep their
     * full original string as `title` unsplit rather than guessing.
     */
    romaji?: string;
    /** JLPT level (1 = N1 hardest .. 5 = N5 easiest), matching Vocabulary.jlptLevel's convention. Every grammar point carries one, since this dataset is itself organized by level. */
    jlptLevel: number;
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
     *                   drill. Its `derives` label names the derivation.
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
     * Set when this point is a realization VARIANT of another: the same
     * construction with one slot filled differently, enumerated separately by the
     * upstream files (どこへも Verb ません is どこにも Verb ません with a different
     * particle). Such a point is still emitted and browsable, but is kept out of
     * `index/teaching-order.json` - the canonical member teaches the rule, and a
     * consumer rotates through the realizations against one SRS entry.
     *
     * Never set for lexical siblings. でも / しかし / けれども are different words
     * with the same function; no operation relates them, so they stay separate
     * items.
     */
    variantOf?: string;
    /** The operation relating this point to its canonical: politeness, particle, contraction, or a combination. */
    variantRelation?: string;
    examples: GrammarExample[];
    /**
     * Register/formality of this point, for points that have one (most don't -
     * plain descriptive constructions with no close synonym leave this unset).
     * Sourced from a hand-authored, reviewable mapping (data/raw/grammar/formality.json),
     * not derived at build time - see docs/SCHEMA.md and the grammar-formality issue
     * for the methodology. Exists specifically so gokan-srs can disambiguate quiz
     * points that are near-synonyms differing mainly by register (e.g. でも/しかし/
     * けれども all gloss as "but"), alongside the point's `usageNote`.
     */
    formalityLevel?: 'casual' | 'neutral' | 'polite' | 'formal' | 'very-formal-literary';
    /**
     * The syntactic slot this point's marker occupies. Sourced from the same
     * hand-authored data/raw/grammar/formality.json mapping. Exists so the app can
     * decide whether one family sibling can grammatically stand in for another when
     * grading a cloze blank: two near-synonyms are only interchangeable if they fill
     * the same slot. けど (clause-final) and でも (sentence-initial) both gloss "but"
     * and share the same family, but you cannot drop でも into a clause-final けど
     * blank - the sentence becomes ungrammatical, so that substitution must grade
     * wrong, not as a minor register slip. Absent where unclassified.
     */
    slot?: 'clause-final' | 'sentence-initial' | 'predicate-final' | 'pre-noun' | 'adverbial';
    /**
     * The near-synonym family this point belongs to, if any (most points don't
     * have one). `id` is the same for every member of a family (symmetric),
     * sourced from the hand-authored `data/raw/grammar/formality.json` mapping -
     * see docs/SCHEMA.md. Not a strict "identical meaning" claim, just "a learner
     * asking how to say X would be shown these together". Also emitted as
     * `compiled/grammar/index/families.json`. The family's name is its own label,
     * carried in the point's text under the field `family`.
     */
    family?: {
        /** Stable slug, e.g. "contradiction" - shared by every member of this family. */
        id: string;
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
    text: TextByLanguage;
}

/** A slot a title names (`noun`, `i-adjective`), with its label in each language: compiled/grammar/slots.json. */
export interface GrammarSlot {
    code: string;
    text: TextByLanguage;
}

/** JLPT level (1..5) -> grammar point ids, in the source's original order (alphabetical - grammar has no frequency data to sort by, unlike vocab). */
export type GrammarJlptIndex = Record<number, string[]>;

/** Family id -> its members, from compiled/grammar/index/families.json. Its name is a label (field `family`) in `text`. */
export type GrammarFamilyIndex = Record<string, { memberIds: string[]; text: TextByLanguage }>;

/**
 * One chapter of the authored teaching order: a run of grammar points that are
 * meant to be met together. Emitted as part of
 * `compiled/grammar/index/teaching-order.json`. Its text: the label `title`
 * ("But: six ways, one meaning") and the prose `summary` (what the chapter
 * teaches, and why these points sit together).
 */
export interface GrammarChapter {
    /** Stable slug, e.g. "n5-c17". Safe to store against user progress. */
    id: string;
    /**
     * The level this chapter is placed at. A chapter can legitimately CONTAIN
     * points from harder levels when they are register siblings of a point it
     * already teaches (see GrammarPoint.family.axis) - so this is the chapter's
     * position in the curriculum, not a claim about every member's own level.
     */
    jlptLevel: number;
    /** Member point ids, in teaching order. */
    points: string[];
    text: TextByLanguage;
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

/**
 * One CASE inside a lesson: a concrete situation, plus which point to reach for
 * in it and why the obvious alternative does not fit. Authored in
 * data/raw/grammar/contrasts.json (AI-drafted, human-reviewed) and compiled into
 * compiled/grammar/index/contrasts.json. Directed so `focus` is the member met
 * LATER in the teaching order, so by the time it is introduced the `vs` siblings
 * are already known and the contrast lands between two real memories.
 *
 * Its text: the prose `situation` (where the choice matters) and `guidance`
 * (which member fits, and why the obvious alternative does not).
 */
export interface GrammarContrastCase {
    /** The point this case teaches the learner to reach for. */
    focus: string;
    /** The sibling(s) `focus` is most confused with. */
    vs: string[];
    text: TextByLanguage;
}

/**
 * A LESSON: a confusability-first sub-grouping of a family - a small set of
 * points (target 5-6, soft cap) close enough to be actively disambiguated
 * together, like interleaving look-alike kanji. A small family can be one
 * lesson; a large one is split into several. Every case belongs to one lesson,
 * and may only name points that lesson covers.
 *
 * (This was called a "chunk" until the vocabulary was found to collide with
 * "chapter" in practice. A lesson is a set of confusable points plus the cases
 * that tell them apart; a chapter is a slot in the introduction order. They are
 * unrelated groupings and a lesson may span chapters - see taughtInChapterId.)
 */
export interface GrammarContrastLesson {
    /** Stable slug within the family, e.g. "reason-core". */
    id: string;
    /** Short display title in Japanese, e.g. "から / ので". */
    title: string;
    /** The confusable points this lesson covers. */
    points: string[];
    /** The situations taught here. Each case's focus/vs are a subset of `points`. */
    cases: GrammarContrastCase[];
    /**
     * The chapter this lesson can first be taught in: the chapter of whichever
     * point it covers is introduced LAST in the teaching order. Filled in by
     * build-curriculum.ts (which is the only step that knows the chapters), so
     * it is absent from the raw authored file and present in the compiled index.
     *
     * A contrast is only meaningful once every point it names is a real memory,
     * so this is the earliest point at which the lesson is honest. The
     * grammar-curriculum issue assumed the stronger rule that a lesson may not
     * span chapters at all; that rule would delete the から/ので lesson the
     * family-lessons issue opens with (から is introduced in n5-c16, ので in
     * n4-c12), so what is enforced is the weaker, actually-load-bearing
     * invariant: a case's `focus` may never be introduced BEFORE one of its
     * `vs` siblings. Lessons that do span chapters are counted in the build
     * output, because a lesson confined to one chapter is still the better shape
     * where it is achievable.
     */
    taughtInChapterId?: string;
}

/**
 * Family id -> its authored contrast lessons, from
 * compiled/grammar/index/contrasts.json. The family's name is in `text`.
 */
export type GrammarContrastIndex = Record<string, {
    lessons: GrammarContrastLesson[];
    /**
     * Members whose `family.axis` is 'variant': genuinely interchangeable
     * siblings with no differentiator to teach. Present only when there are two
     * or more, and never overlapping with a lesson's points (a lesson naming a
     * variant point is a build error). A family can have this and NO lessons at
     * all, which is the normal shape for a pure variant family.
     *
     * The point of emitting it is that silence is worse than a one-line note: a
     * learner who meets ten near-identical literary forms with no comment will
     * assume a distinction exists and go looking for one. Render it as a note
     * ("these are interchangeable, pick by feel"), not as a lesson.
     */
    interchangeable?: string[];
    text: TextByLanguage;
}>;

/** One realization in compiled/grammar/index/variant-groups.json. `title` is the point's core title. */
export interface GrammarVariantRealization {
    id: string;
    relation: string;
    formalityLevel?: string;
    title: string;
}

/** Canonical id -> every realization of the rule, the canonical first. */
export type GrammarVariantGroups = Record<string, GrammarVariantRealization[]>;

/** One row of compiled/grammar/index/browse.json: what a browse card needs, without its text. */
export interface GrammarBrowseRow {
    id: string;
    /** The point's core title and romaji, with slot codes. */
    title: string;
    romaji?: string;
    jlptLevel: number;
    /** Which exercise can test this point: 'construction' | 'inflection' | 'lexical'. */
    kind: string;
    formalityLevel?: string;
    familyId?: string;
    /** What this member adds over its family siblings: register | constraint | variant. */
    axis?: string;
    /** Set when this point is a realization variant taught via its canonical. */
    variantOf?: string;
    variantRelation?: string;
    /**
     * Zero-based position in the introduction order, or null when the point is
     * deliberately excluded from it (a realization variant).
     */
    orderIndex: number | null;
    chapterId?: string;
    exampleCount: number;
    /** Examples whose pattern was located; the rest fall back to a vocab-only blank. */
    anchoredExampleCount: number;
    /** Drill items available, for an inflection point. */
    conjugationItems?: number;
}

/** A browse row's text in one language, as plain strings: compiled/text/<lang>/grammar/index/browse.json, by point id. */
export interface GrammarBrowseText {
    /** The title and romaji as the language writes them. */
    title?: string;
    romaji?: string;
    /** For an inflection point, the derivation it teaches. */
    derives?: string;
    formation?: string;
    shortExplanation?: string;
    usageNote?: string;
    familyName?: string;
    chapterTitle?: string;
}

/** A browse row as the build assembles it: its text in every language it has some. */
export interface AssembledGrammarBrowseRow extends GrammarBrowseRow {
    text: Record<LanguageTag, GrammarBrowseText>;
}

export interface GrammarBrowseIndex<Row = GrammarBrowseRow> {
    points: Row[];
    stats: {
        points: number;
        introduced: number;
        variants: number;
        variantGroups: number;
        families: number;
        unfamilied: number;
        chapters: number;
        byLevel: Record<number, number>;
        byKind: Record<string, number>;
        byAxis: Record<string, number>;
    };
}

/** compiled/text/<lang>/grammar/index/browse.json: each point's browse text in that language, by id. */
export type GrammarBrowseTexts = Record<string, GrammarBrowseText>;

/** One drill item of compiled/grammar/conjugations.json. */
export interface GrammarDrillItem {
    vocabId: string;
    lemma: string;
    lemmaReading: string;
    target: string;
    targetReading: string;
    /** Equally correct alternatives, e.g. 書かされる for the causative-passive. */
    alternatives?: string[];
    wordClass: 'godan' | 'ichidan' | 'irregular' | 'i-adjective' | 'na-adjective';
}

/**
 * An inflection point's drill. `marker` is the Japanese the form is named by (たい, ました),
 * where it has one; the form's name in a language is the label `formLabel` in `text`.
 */
export interface GrammarConjugation {
    form: string;
    marker?: string;
    items: GrammarDrillItem[];
    text: TextByLanguage;
}

/** Point id -> its drill, compiled/grammar/conjugations.json. */
export type GrammarConjugations = Record<string, GrammarConjugation>;
