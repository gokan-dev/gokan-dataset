// Grammar's text in the text layer. Every grammar text comes from a source whose items are this
// dataset's own ids: hanabira's entries (which have no ids of their own, so a point's positional
// id names the entry it was read from) and Gokan's hand-written files (keyed by point, family,
// chapter or case). So every rendering is matched by `id`, and `ref` is that id.
import type { EntityKind, Label, LanguageTag, Prose, SourceId, TextStatus, Translation } from '../models/text.model';
import { rendering } from './renderings';
import { sha256Hex } from './sha256';

/** Where a grammar text was read from: the source, and the id of the item in it. */
export interface GrammarTextSource {
    source: SourceId;
    ref: string;
}

/** Gokan's own hand-written text is reviewed (decision D4); imported text is not yet. */
const statusOf = (source: SourceId): TextStatus => (source === 'gokan' ? 'reviewed' : 'imported');

export function grammarLabel(kind: EntityKind, id: string, lang: LanguageTag, field: string | undefined, value: string, from: GrammarTextSource): Label {
    return rendering<Label>(kind, id, lang, {
        role: 'label',
        ...(field !== undefined ? { field } : {}),
        source: { source: from.source, ref: from.ref },
        match: 'id',
        status: statusOf(from.source),
        value,
    });
}

export function grammarProse(kind: EntityKind, id: string, lang: LanguageTag, field: string, value: string, from: GrammarTextSource): Prose {
    return rendering<Prose>(kind, id, lang, {
        role: 'prose',
        field,
        source: { source: from.source, ref: from.ref },
        match: 'id',
        status: statusOf(from.source),
        value,
    });
}

export function grammarTranslation(kind: EntityKind, id: string, lang: LanguageTag, value: string, from: GrammarTextSource): Translation {
    return rendering<Translation>(kind, id, lang, {
        role: 'translation',
        source: { source: from.source, ref: from.ref },
        match: 'id',
        status: statusOf(from.source),
        value,
    });
}

/**
 * An example's id: its point's id and a hash of its Japanese sentence. An example has no id of
 * its own, and its position is not one: overrides.json removes, replaces and reorders examples,
 * and a positional id would then move a translation, and any review recorded against it, onto
 * another sentence. The sentence is what the example is, and it is unique within its point (the
 * build asserts it); hashed, so a key stays short.
 */
export function grammarExampleId(pointId: string, jp: string): string {
    return `${pointId}#${sha256Hex(jp).slice(0, 12)}`;
}

/** A contrast case's id: its family, its lesson, and what it contrasts, which is unique within the lesson. */
export function contrastCaseId(familyId: string, lessonId: string, focus: string, vs: string[]): string {
    return `${familyId}#${lessonId}/${focus}>${vs.join(',')}`;
}
