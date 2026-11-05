// Building and reading explanation-language text (docs/MULTILINGUAL.md, "The model"). A source
// reader makes renderings with `rendering`, as it reads its source; every later stage reads them
// through the accessors here, never by language-specific fields.
import { createHash } from 'node:crypto';
import type {
    Definition,
    DefinitionSense,
    EntityKind,
    EntityText,
    Equivalent,
    Label,
    LanguageTag,
    Prose,
    Rendering,
    SourceId,
    TextByLanguage,
    Translation,
    Value,
} from '../models/text.model';

type Unidentified<R extends Rendering> = R extends Rendering ? Omit<R, 'id'> : never;

/**
 * A rendering's identity: a hash of the entity, the language, the source and what the rendering
 * says. Not its status, match evidence or corroboration: a review records a decision against this
 * id, so reviewing or corroborating a text must not change it.
 */
export function renderingId(kind: EntityKind, entityId: string, lang: LanguageTag, rendering: Unidentified<Rendering>): string {
    const { status: _status, match: _match, evidence: _evidence, of: _of, ...said } = rendering;
    return createHash('sha256').update(JSON.stringify([kind, entityId, lang, said])).digest('hex').slice(0, 16);
}

/** A rendering with its identity, for the entity it explains. */
export function rendering<R extends Rendering>(kind: EntityKind, entityId: string, lang: LanguageTag, unidentified: Omit<R, 'id'>): R {
    const id = renderingId(kind, entityId, lang, unidentified as Unidentified<Rendering>);
    return { id, ...unidentified } as R;
}

/** A rendering of one entity, as another entity carries it (see Rendering's `of`). */
export function sharedFrom<R extends Rendering>(r: R, kind: EntityKind, id: string): R {
    return { ...r, of: { kind, id } };
}

/** Adds renderings to an entity's text in one language, keeping the order they come in. */
export function addRenderings(text: TextByLanguage, lang: LanguageTag, renderings: Rendering[]): void {
    if (renderings.length === 0) return;
    const entry: EntityText = text[lang] ?? { renderings: [] };
    entry.renderings.push(...renderings);
    text[lang] = entry;
}

export function valueText(value: Value): string {
    return typeof value === 'string' ? value : value.value;
}

/** The languages an entity has text in, in a stable order. */
export function languagesOf(text: TextByLanguage | undefined): LanguageTag[] {
    return Object.keys(text ?? {}).sort();
}

function renderingsIn(text: TextByLanguage | undefined, lang: LanguageTag): Rendering[] {
    return text?.[lang]?.renderings ?? [];
}

/** Every definition of a word in a language, optionally of one source, in order. */
export function definitionsOf(text: TextByLanguage | undefined, lang: LanguageTag, source?: SourceId): Definition[] {
    return renderingsIn(text, lang).filter((r): r is Definition => r.role === 'definition' && (source === undefined || r.source.source === source));
}

/** The equivalents of a word in a language, whole, in order. */
export function equivalentsOf(text: TextByLanguage | undefined, lang: LanguageTag): Equivalent[] {
    return renderingsIn(text, lang).filter((r): r is Equivalent => r.role === 'equivalent');
}

/**
 * An entity's text without the renderings of the given sources, dropping a language left empty:
 * a stage that adds its sources' text starts from this, so running it twice adds nothing twice.
 */
export function withoutSources(text: TextByLanguage, sources: ReadonlySet<SourceId>): TextByLanguage {
    const kept: TextByLanguage = {};
    for (const [lang, entity] of Object.entries(text)) {
        const renderings = entity.renderings.filter(r => !sources.has(r.source.source));
        if (renderings.length > 0 || entity.synonyms !== undefined) kept[lang] = { ...entity, renderings };
    }
    return kept;
}

/** One source's definition of a word in a language. */
export function definitionOf(text: TextByLanguage | undefined, lang: LanguageTag, source: SourceId): Definition | undefined {
    return renderingsIn(text, lang).find((r): r is Definition => r.role === 'definition' && r.source.source === source);
}

/** One source's senses of a word in a language; none when it has no definition there. */
export function sensesOf(text: TextByLanguage | undefined, lang: LanguageTag, source: SourceId): DefinitionSense[] {
    return definitionOf(text, lang, source)?.senses ?? [];
}

/** One source's glosses per sense, as plain strings. */
export function glossesOf(text: TextByLanguage | undefined, lang: LanguageTag, source: SourceId): string[][] {
    return sensesOf(text, lang, source).map(s => s.glosses.map(valueText));
}

/** The labels in a language, optionally of one field or one source, as plain strings. */
export function labelsOf(text: TextByLanguage | undefined, lang: LanguageTag, filter: { field?: string; source?: SourceId; ref?: string } = {}): string[] {
    return renderingsIn(text, lang)
        .filter((r): r is Label => r.role === 'label')
        .filter(r => r.field === filter.field)
        .filter(r => filter.source === undefined || r.source.source === filter.source)
        .filter(r => filter.ref === undefined || r.source.ref === filter.ref)
        .map(r => valueText(r.value));
}

/** The text of one prose field in a language, when there is one. */
export function proseOf(text: TextByLanguage | undefined, lang: LanguageTag, field: string): string | undefined {
    const prose = renderingsIn(text, lang).find((r): r is Prose => r.role === 'prose' && r.field === field);
    return prose ? valueText(prose.value) : undefined;
}

/**
 * The translation renderings in a language, whole: an entity that shows another's translation
 * (a mined grammar example is a corpus sentence) carries the rendering itself, so its provenance
 * and any review of it stay one.
 */
export function translationRenderingsOf(text: TextByLanguage | undefined, lang: LanguageTag): Translation[] {
    return renderingsIn(text, lang).filter((r): r is Translation => r.role === 'translation');
}

/** The translations in a language, with the source's id for each. */
export function translationsOf(text: TextByLanguage | undefined, lang: LanguageTag): { ref: string; text: string }[] {
    return translationRenderingsOf(text, lang).map(r => ({ ref: r.source.ref ?? '', text: valueText(r.value) }));
}
