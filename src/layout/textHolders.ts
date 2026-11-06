// Which objects of an assembled file carry text, and the id each one's text is keyed by in the
// file's text files (docs/MULTILINGUAL.md, "Compiled output"). The layout splits a file through
// this (scripts/build-layout.ts) and the layout check joins it back through the same list
// (scripts/check-layout.ts), so the two cannot disagree about where a text belongs. No language
// is named here.
import type {
    GrammarConjugations, GrammarContrastIndex, GrammarExample, GrammarFamilyIndex, GrammarPoint, GrammarSlot, GrammarTeachingOrder,
} from '../models/grammar.model';
import type { MediaIndexEntry, MediaTitle } from '../models/media.model';
import type { EntityKind, EntityText, LanguageTag, TextByLanguage } from '../models/text.model';
import { episodeId } from '../text/media';
import { contrastCaseId, grammarExampleId } from '../text/grammarText';

/** An object carrying text (or, in a core file, the place its text goes back), and its id. */
export interface TextHolder {
    id: string;
    holder: { text?: TextByLanguage };
}

export interface HolderSpec {
    /** A file, or a directory of files, relative to compiled/. */
    path: string;
    /** The kind of the file's entities, for its text files. */
    kind: EntityKind;
    /** For a directory of entity files, its name in each language's list of files with text (its pages there). */
    group?: string;
    /** The file's text holders, in order. `name` is the file's name without .json (a point's id). */
    holders(file: unknown, name: string): TextHolder[];
    /** For a directory, whether a file in it is a page (media/index.json is not); every file is by default. */
    isPage?: (name: string) => boolean;
}

function spec<T>(path: string, kind: EntityKind, holders: (file: T, name: string) => TextHolder[], group?: string): HolderSpec {
    // A file of this repository's own build, assembled or core: the core is the assembled shape
    // without its `text`, which joining puts back.
    return { path, kind, holders: (file, name) => holders(file as T, name), ...(group ? { group } : {}) };
}

const examplesOf = (pointId: string, examples: GrammarExample[]): TextHolder[] =>
    examples.map(e => ({ id: grammarExampleId(pointId, e.jp), holder: e }));

/** The grammar files, each listing its point, examples, slots, families, cases or chapters. */
export const GRAMMAR_HOLDERS: readonly HolderSpec[] = [
    spec<GrammarPoint>('grammar/points', 'grammar', p => [{ id: p.id, holder: p }, ...examplesOf(p.id, p.examples)], 'grammar'),
    spec<GrammarExample[]>('grammar/mined', 'grammar', (examples, pointId) => examplesOf(pointId, examples)),
    spec<GrammarSlot[]>('grammar/slots.json', 'grammarSlot', slots => slots.map(s => ({ id: s.code, holder: s }))),
    spec<GrammarConjugations>('grammar/conjugations.json', 'conjugation', drills => Object.entries(drills).map(([id, holder]) => ({ id, holder }))),
    spec<GrammarFamilyIndex>('grammar/index/families.json', 'family', families => Object.entries(families).map(([id, holder]) => ({ id, holder }))),
    spec<GrammarContrastIndex>('grammar/index/contrasts.json', 'family', families => Object.entries(families).flatMap(([familyId, family]) => [
        { id: familyId, holder: family },
        ...family.lessons.flatMap(lesson => lesson.cases.map(c => ({ id: contrastCaseId(familyId, lesson.id, c.focus, c.vs), holder: c }))),
    ])),
    spec<GrammarTeachingOrder>('grammar/index/teaching-order.json', 'chapter', order => order.chapters.map(c => ({ id: c.id, holder: c }))),
];

/** Not pages: the media index lists every title, the library their word counts. */
const MEDIA_LISTS = new Set(['index', 'library']);

/** The media files: each title (and its episodes), and the index that repeats each title's text. */
export const MEDIA_HOLDERS: readonly HolderSpec[] = [{
    path: 'media',
    kind: 'media',
    group: 'media',
    isPage: name => !MEDIA_LISTS.has(name),
    // A file of this repository's own build, assembled or core (see `spec`).
    holders: (file, name) => {
        if (name === 'library') return [];
        if (name === 'index') return (file as MediaIndexEntry[]).map(entry => ({ id: entry.id, holder: entry }));
        const title = file as MediaTitle;
        return [{ id: title.id, holder: title }, ...title.episodes.map(e => ({ id: episodeId(title.id, e.number), holder: e }))];
    },
}];

/** Every file whose text sits on objects inside it. */
export const TEXT_HOLDERS: readonly HolderSpec[] = [...GRAMMAR_HOLDERS, ...MEDIA_HOLDERS];

/**
 * Takes the text out of an assembled file, which becomes its core: each language's entities,
 * keyed by id, holding only those with something in that language.
 */
export function splitText(file: unknown, spec: HolderSpec, name: string): Record<LanguageTag, Record<string, EntityText>> {
    const byLang: Record<LanguageTag, Record<string, EntityText>> = {};
    const seen = new Set<string>();
    for (const { id, holder } of spec.holders(file, name)) {
        if (seen.has(id)) throw new Error(`${spec.path}/${name}: two entities share the id "${id}", so their text could not be told apart.`);
        seen.add(id);
        const text = holder.text ?? {};
        delete holder.text;
        for (const [lang, entity] of Object.entries(text)) {
            if (entity.renderings.length > 0 || entity.synonyms !== undefined) (byLang[lang] ??= {})[id] = entity;
        }
    }
    return byLang;
}

/** Puts each language's text back into a core file, the inverse of `splitText`. */
export function joinText(core: unknown, spec: HolderSpec, name: string, byLang: Record<LanguageTag, Record<string, EntityText>>): void {
    for (const { id, holder } of spec.holders(core, name)) {
        const text: TextByLanguage = {};
        for (const [lang, entities] of Object.entries(byLang)) {
            const entity = entities[id];
            if (entity) text[lang] = entity;
        }
        holder.text = text;
    }
}
