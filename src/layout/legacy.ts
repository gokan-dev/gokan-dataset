// The dataset's files as they were before the text layer, rebuilt from a core file and its
// English text: the shape both apps read, through the English view (english.ts). The text layer
// was proven to change nothing for an app that reads English (docs/MULTILINGUAL.md, "Phases",
// phase 2); scripts/check-english.ts now proves the view changes only on purpose.
import type {
    GrammarBrowseIndex, GrammarBrowseRow, GrammarBrowseText, GrammarBrowseTexts, GrammarChapter, GrammarConjugation, GrammarContrastCase,
    GrammarContrastIndex, GrammarContrastLesson, GrammarExample, GrammarFamilyIndex, GrammarPoint, GrammarTeachingOrder, GrammarVariantGroups,
} from '../models/grammar.model';
import type { Kanji } from '../models/kanji.model';
import type { MediaEpisode, MediaIndexEntry } from '../models/media.model';
import type { Sentence } from '../models/sentence.model';
import type { EntityText, Label, TextByLanguage, TextFile, VocabSynonym } from '../models/text.model';
import type { MergedVocabInfo, Sense, Vocabulary } from '../models/vocabulary.model';
import { romajiIn, titleIn, type SlotLabels } from '../text/grammarSlots';
import { contrastCaseId, grammarExampleId } from '../text/grammarText';
import { jmdictDefinitions, jmdictSenses } from '../text/jmdict';
import { episodeId, MEDIA_FIELDS } from '../text/media';
import { labelsOf, proseOf, translationsOf, valueText } from '../text/renderings';

/** How many glosses of a merged homograph's first sense summarized it. */
const MERGED_SUMMARY_GLOSSES = 3;

export type LegacyVocabulary = Omit<Vocabulary, 'pos' | 'text' | 'mergedVocabs'> & {
    senses: Sense[];
    mergedVocabs?: (MergedVocabInfo & { originalGlosses: string[] })[];
    synonyms?: VocabSynonym[];
};

export type LegacySentence = Omit<Sentence, 'text'> & { en: { id: string; text: string }[] };

export type LegacyKanji = Omit<Kanji, 'text'> & { meanings: string[] };

const english = (text: EntityText | undefined): TextByLanguage => (text ? { en: text } : {});

export function legacyVocab(core: Omit<Vocabulary, 'text'>, en: EntityText | undefined): LegacyVocabulary {
    const { pos: _pos, mergedVocabs, ...rest } = core;
    const text = english(en);
    const definitions = jmdictDefinitions(text);
    const summary = (entryId: string): string[] =>
        (definitions.find(d => d.source.ref === entryId)?.senses[0]?.glosses ?? []).slice(0, MERGED_SUMMARY_GLOSSES).map(valueText);
    return {
        ...rest,
        senses: jmdictSenses(text),
        ...(mergedVocabs ? { mergedVocabs: mergedVocabs.map(m => ({ ...m, originalGlosses: summary(m.id) })) } : {}),
        ...(en?.synonyms ? { synonyms: en.synonyms } : {}),
    };
}

export function legacySentence(core: Omit<Sentence, 'text'>, en: EntityText | undefined): LegacySentence {
    return { ...core, en: translationsOf(english(en), 'en').map(t => ({ id: t.ref, text: t.text })) };
}

export function legacyKanji(core: Omit<Kanji, 'text'>, en: EntityText | undefined): LegacyKanji {
    const meanings = (en?.renderings ?? []).filter((r): r is Label => r.role === 'label' && r.field === undefined).map(r => valueText(r.value));
    return { ...core, meanings };
}

type Core<T> = Omit<T, 'text'>;

export type GrammarExampleCore = Core<GrammarExample>;
export type GrammarPointCore = Omit<GrammarPoint, 'text' | 'examples'> & { examples: GrammarExampleCore[] };
export type GrammarFamiliesCore = Record<string, Core<GrammarFamilyIndex[string]>>;
export type GrammarContrastLessonCore = Omit<GrammarContrastLesson, 'cases'> & { cases: Core<GrammarContrastCase>[] };
export type GrammarContrastsCore = Record<string, Omit<GrammarContrastIndex[string], 'text' | 'lessons'> & { lessons: GrammarContrastLessonCore[] }>;
export type GrammarTeachingOrderCore = Omit<GrammarTeachingOrder, 'chapters'> & { chapters: Core<GrammarChapter>[] };
export type GrammarConjugationsCore = Record<string, Core<GrammarConjugation>>;

export type LegacyGrammarExample = GrammarExampleCore & { en: string };
export type LegacyGrammarPoint = Omit<GrammarPointCore, 'examples' | 'family'> & {
    shortExplanation: string;
    longExplanation: string;
    formation: string;
    usageNote?: string;
    derives?: string;
    examples: LegacyGrammarExample[];
    family?: NonNullable<GrammarPoint['family']> & { name: string };
};
export type LegacyGrammarFamilies = Record<string, { name: string; memberIds: string[] }>;
export type LegacyGrammarContrasts = Record<string, Omit<GrammarContrastsCore[string], 'lessons'> & {
    name: string;
    lessons: (Omit<GrammarContrastLessonCore, 'cases'> & { cases: { focus: string; vs: string[]; situation: string; guidance: string }[] })[];
}>;
export type LegacyGrammarTeachingOrder = Omit<GrammarTeachingOrder, 'chapters'> & {
    chapters: (Core<GrammarChapter> & { title: string; summary: string })[];
};
export type LegacyGrammarBrowse = GrammarBrowseIndex<GrammarBrowseRow & GrammarBrowseText>;
export type LegacyGrammarConjugations = Record<string, Omit<GrammarConjugationsCore[string], 'marker'> & { formLabel: string }>;

/** One entity's English text, from its file's English text file. */
const englishOf = (file: TextFile | undefined, id: string): TextByLanguage => english(file?.entities[id]);
const labelIn = (text: TextByLanguage, field: string): string | undefined => labelsOf(text, 'en', { field })[0];

export function legacyGrammarExample(core: GrammarExampleCore, en: EntityText | undefined): LegacyGrammarExample {
    return { ...core, en: translationsOf(english(en), 'en')[0]?.text ?? '' };
}

/** A point's examples or mined examples, each with its English translation. */
export function legacyGrammarExamples(pointId: string, cores: GrammarExampleCore[], en: TextFile | undefined): LegacyGrammarExample[] {
    return cores.map(e => legacyGrammarExample(e, en?.entities[grammarExampleId(pointId, e.jp)]));
}

/** A grammar point as it was: its title and romaji in English, its prose and labels as fields. */
export function legacyGrammarPoint(core: GrammarPointCore, en: TextFile | undefined, slots: SlotLabels): LegacyGrammarPoint {
    const { examples, family, ...rest } = core;
    const text = englishOf(en, core.id);
    const usageNote = proseOf(text, 'en', 'usageNote');
    const derives = labelIn(text, 'derives');
    return {
        ...rest,
        title: titleIn({ title: core.title, text }, 'en', slots) ?? core.title,
        ...(core.romaji !== undefined ? { romaji: romajiIn({ romaji: core.romaji, text }, 'en', slots) ?? core.romaji } : {}),
        shortExplanation: proseOf(text, 'en', 'shortExplanation') ?? '',
        longExplanation: proseOf(text, 'en', 'longExplanation') ?? '',
        formation: proseOf(text, 'en', 'formation') ?? '',
        ...(usageNote !== undefined ? { usageNote } : {}),
        ...(derives !== undefined ? { derives } : {}),
        ...(family ? { family: { ...family, name: labelIn(text, 'family') ?? '' } } : {}),
        examples: legacyGrammarExamples(core.id, examples, en),
    };
}

export function legacyGrammarFamilies(core: GrammarFamiliesCore, en: TextFile | undefined): LegacyGrammarFamilies {
    return Object.fromEntries(Object.entries(core).map(([id, family]) => [id, { name: labelIn(englishOf(en, id), 'family') ?? '', ...family }]));
}

export function legacyGrammarContrasts(core: GrammarContrastsCore, en: TextFile | undefined): LegacyGrammarContrasts {
    return Object.fromEntries(Object.entries(core).map(([familyId, family]) => [familyId, {
        ...family,
        name: labelIn(englishOf(en, familyId), 'family') ?? '',
        lessons: family.lessons.map(lesson => ({
            ...lesson,
            cases: lesson.cases.map(c => {
                const text = englishOf(en, contrastCaseId(familyId, lesson.id, c.focus, c.vs));
                return { ...c, situation: proseOf(text, 'en', 'situation') ?? '', guidance: proseOf(text, 'en', 'guidance') ?? '' };
            }),
        })),
    }]));
}

export function legacyGrammarTeachingOrder(core: GrammarTeachingOrderCore, en: TextFile | undefined): LegacyGrammarTeachingOrder {
    return {
        ...core,
        chapters: core.chapters.map(chapter => {
            const text = englishOf(en, chapter.id);
            return { ...chapter, title: labelIn(text, 'title') ?? '', summary: proseOf(text, 'en', 'summary') ?? '' };
        }),
    };
}

/** The variant groups with each realization's English title, which its point's text gives. */
export function legacyGrammarVariantGroups(core: GrammarVariantGroups, titleOf: (pointId: string) => string | undefined): GrammarVariantGroups {
    return Object.fromEntries(Object.entries(core).map(([id, group]) => [id, group.map(r => ({ ...r, title: titleOf(r.id) ?? r.title }))]));
}

/** The browse index with each row's English fields, its title and romaji in English over the core's. */
export function legacyGrammarBrowse(core: GrammarBrowseIndex, en: GrammarBrowseTexts | undefined): LegacyGrammarBrowse {
    return { ...core, points: core.points.map(row => ({ ...row, ...en?.[row.id] })) };
}

export function legacyGrammarConjugations(core: GrammarConjugationsCore, en: TextFile | undefined): LegacyGrammarConjugations {
    return Object.fromEntries(Object.entries(core).map(([id, { marker: _marker, ...drill }]) => [id, { ...drill, formLabel: labelIn(englishOf(en, id), 'formLabel') ?? '' }]));
}

// ---------------------------------------------------------------- media

type MediaCore = Omit<MediaIndexEntry, 'text'>;
export type LegacyMediaIndexEntry = Omit<MediaCore, 'genreIds' | 'title'> & {
    title: MediaCore['title'] & { english?: string };
    genres: string[];
    tags: string[];
};
export type LegacyMediaTitle = LegacyMediaIndexEntry & {
    episodes: (Omit<MediaEpisode, 'text'> & { title: string })[];
};

/** A media index entry or title as it was: its English title, genre names and tags as fields. */
export function legacyMediaEntry(core: MediaCore, en: EntityText | undefined): LegacyMediaIndexEntry {
    const { genreIds: _genreIds, ...rest } = core;
    const text = english(en);
    const englishTitle = labelsOf(text, 'en', { field: MEDIA_FIELDS.title })[0];
    return {
        ...rest,
        title: { ...core.title, ...(englishTitle !== undefined ? { english: englishTitle } : {}) },
        genres: labelsOf(text, 'en', { field: MEDIA_FIELDS.genre }),
        tags: labelsOf(text, 'en', { field: MEDIA_FIELDS.tag }),
    };
}

export function legacyMediaTitle(core: MediaCore & { episodes: Omit<MediaEpisode, 'text'>[] }, en: TextFile | undefined): LegacyMediaTitle {
    const { episodes, ...entry } = core;
    return {
        ...legacyMediaEntry(entry, en?.entities[core.id]),
        episodes: episodes.map(e => ({ ...e, title: labelsOf(englishOf(en, episodeId(core.id, e.number)), 'en', { field: MEDIA_FIELDS.episodeTitle })[0] ?? '' })),
    };
}