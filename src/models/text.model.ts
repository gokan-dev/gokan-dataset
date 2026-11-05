// Explanation-language text: what one source says about one entity, in one language
// (docs/MULTILINGUAL.md, "The model"). Every language is held this way, English included.
import type { SynonymEntry, SynonymForms } from '../../scripts/build-synonyms';
import type { Sense } from './vocabulary.model';

/** BCP 47, always lowercase: `en`, `zh-hans`, `nan`. */
export type LanguageTag = string;

/** A directory of data/sources/. */
export type SourceId = string;

export type TextStatus = 'imported' | 'corroborated' | 'reviewed' | 'rejected';

/** Why a source's item was attached to this entity (docs/MULTILINGUAL.md, "Matching"). */
export type MatchEvidence = 'id' | 'spelling+reading' | 'spelling';

/** The allowlist of mechanical transforms (decision D3). */
export type Transform = 'script:hant-to-hans';

/** A value produced by an allowlisted transform, keeping what the source wrote. */
export interface DerivedValue {
    value: string;
    derivedFrom: { value: string; lang: LanguageTag; transform: Transform };
}

/** Text as the source wrote it (a plain string), or derived from it. */
export type Value = string | DerivedValue;

export interface SourceRef {
    source: SourceId;
    /** The item in that source: an entry id, a sentence id, a page title. */
    ref?: string;
}

interface RenderingBase {
    /** A hash of what the rendering says and where it comes from; reviews are recorded against it. */
    id: string;
    /** Only when it differs from the file's language (a `zh` value in a `zh-hans` file). */
    lang?: LanguageTag;
    source: SourceRef;
    match: MatchEvidence;
    status: TextStatus;
    /** The independent texts that corroborate it. */
    evidence?: SourceRef[];
    /**
     * Set when an entity carries a rendering that belongs to another: a mined grammar example
     * carries its sentence's translation, a grammar point its family's name. The id is that
     * entity's, so one review covers every place the text appears.
     */
    of?: { kind: EntityKind; id: string };
}

/**
 * One sense of a source's definition. Senses belong to their source and are never aligned
 * across sources, so the source's own facts about a sense travel with it: JMdict's part of
 * speech, flags, cross-references and reading restrictions.
 */
export interface DefinitionSense {
    glosses: Value[];
    pos?: string[];
    misc?: Sense['misc'];
    related?: Sense['related'];
    appliesToReadings?: string[];
    /** The spellings the source says the sense applies to (Chinese Wiktionary's `飲む，呑む： 喝，饮`). */
    appliesToSpellings?: string[];
    /** The source's own labels for the sense (Chinese Wiktionary's `archaic`, a dialect's name). */
    tags?: string[];
}

/** A source's own list of senses for a word, never merged with another source's. */
export interface Definition extends RenderingBase {
    role: 'definition';
    senses: DefinitionSense[];
}

/** One word in another language. */
export interface Equivalent extends RenderingBase {
    role: 'equivalent';
    value: Value;
    /** OntoLex vartrans translation categories. */
    category?: 'direct' | 'cultural' | 'lexical';
}

/** A translation of a Japanese text. */
export interface Translation extends RenderingBase {
    role: 'translation';
    value: Value;
    /** Where the source records it (Tatoeba does). */
    direction?: 'fromJapanese' | 'toJapanese';
}

/** A short name: a kanji's meaning, a tag's description, a title. `field` when an entity has several kinds. */
export interface Label extends RenderingBase {
    role: 'label';
    field?: string;
    value: Value;
}

/** Explanatory text in a named field (shortExplanation, usageNote...). */
export interface Prose extends RenderingBase {
    role: 'prose';
    field: string;
    value: Value;
}

/** Text for one audience only (a false friend for Chinese readers). */
export interface Note extends RenderingBase {
    role: 'note';
    value: Value;
}

export type Rendering = Definition | Equivalent | Translation | Label | Prose | Note;

/**
 * The kinds of entity whose text has moved into the text layer so far. A part of an entity (a
 * grammar point's example, a family's contrast case) has the entity's kind and an id of the form
 * `<entity id>#<part>`.
 */
export type EntityKind = 'vocab' | 'kanji' | 'sentence' | 'grammar' | 'grammarSlot' | 'family' | 'chapter' | 'conjugation' | 'media';

/** One near-synonym of a word, as scripts/build-synonyms.ts computes it from a language's glosses. */
export type VocabSynonym = SynonymEntry & Partial<SynonymForms>;

/**
 * Data computed from a language's text, stored with it: a word's near-synonyms are pairs
 * sharing a gloss, so English ones mean nothing in another language.
 */
export interface DerivedText {
    synonyms?: VocabSynonym[];
}

export interface EntityText extends DerivedText {
    renderings: Rendering[];
}

/** An entity's text in every language it has some, as the build carries it until the layout stage. */
export type TextByLanguage = Record<LanguageTag, EntityText>;

/**
 * One text file: `compiled/text/<lang>/` followed by the path of the core file it explains,
 * holding the text of every entity in that core file, keyed by entity id.
 */
export interface TextFile {
    kind: EntityKind;
    lang: LanguageTag;
    entities: Record<string, EntityText>;
}
