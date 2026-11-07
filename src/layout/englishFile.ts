// The English view of one compiled file, from inputs a caller has already read: the file's core,
// its English text under text/en/, and the small shared files it declares. Pure (no `node:`
// import anywhere below it, which englishFile.test.ts checks), so it runs wherever the dataset is
// read: english.ts reads the inputs from disk, gokan-srs fetches them in a browser, the
// dictionary's renderer over HTTP. One implementation, reached by every reader.
//
// What a file needs is declared by `englishInputs`, so a reader never guesses: every view file is
// a function of its own core, its own English text, and declared shared files (docs/MULTILINGUAL.md,
// "Consumers").
import type { GrammarBrowseIndex, GrammarBrowseTexts, GrammarSlot, GrammarVariantGroups } from '../models/grammar.model';
import type { SearchGlosses, SearchIndexEntry } from '../models/index.model';
import type { Kanji } from '../models/kanji.model';
import type { MediaIndexEntry } from '../models/media.model';
import type { Sentence } from '../models/sentence.model';
import type { TextFile } from '../models/text.model';
import type { Vocabulary } from '../models/vocabulary.model';
import { slotLabelsIn, type SlotLabels } from '../text/grammarSlots';
import {
    legacyGrammarBrowse, legacyGrammarConjugations, legacyGrammarContrasts, legacyGrammarExamples, legacyGrammarFamilies, legacyGrammarPoint,
    legacyGrammarTeachingOrder, legacyGrammarVariantGroups, legacyKanji, legacyMediaEntry, legacyMediaTitle, legacySentence, legacyVocab,
    type GrammarContrastsCore, type GrammarConjugationsCore, type GrammarExampleCore, type GrammarFamiliesCore, type GrammarPointCore,
    type GrammarTeachingOrderCore,
} from './legacy';

/** A file's English text: under text/en/, at its core's path. */
export const englishTextPath = (relative: string): string => `text/en/${relative}`;

const SLOTS = 'grammar/slots.json';
const SLOT_INPUTS = [SLOTS, englishTextPath(SLOTS)] as const;
const BROWSE_TEXT = englishTextPath('grammar/index/browse.json');

/** What to read for one file of the view, every path relative to compiled/. */
export interface EnglishInputs {
    core: string;
    /**
     * Its English text, when the view reads one. Every such file has it (englishFile.test.ts holds
     * the compiled output to that), so a reader treats a missing one as an error, not as "none".
     */
    text?: string;
    /** Small files several view files read: a reader may fetch each once and reuse it. */
    shared: readonly string[];
}

/** The inputs, parsed. `shared` holds every path `englishInputs(...).shared` named. */
export interface EnglishInputValues {
    core: unknown;
    text?: unknown;
    shared?: ReadonlyMap<string, unknown>;
}

interface Projection {
    text: boolean;
    shared: readonly string[];
    project(core: unknown, text: unknown, shared: ReadonlyMap<string, unknown>, relative: string): unknown;
}

// The inputs are this repository's own build output, already typed by it: each projection names
// the type its file has.
const asText = (text: unknown): TextFile | undefined => text as TextFile | undefined;

function sharedInput(shared: ReadonlyMap<string, unknown>, path: string): unknown {
    if (!shared.has(path)) throw new Error(`[english] ${path} is a declared shared input and was not given.`);
    return shared.get(path);
}

function slotLabels(shared: ReadonlyMap<string, unknown>): SlotLabels {
    const en = asText(sharedInput(shared, englishTextPath(SLOTS)));
    const slots = sharedInput(shared, SLOTS) as Omit<GrammarSlot, 'text'>[];
    return slotLabelsIn(slots.map(s => ({ ...s, text: { en: en?.entities[s.code] ?? { renderings: [] } } })), 'en');
}

const withText = (project: (core: unknown, text: unknown) => unknown): Projection =>
    ({ text: true, shared: [], project: (core, text) => project(core, text) });

/** The files whose shape changed, by exact path. */
const BY_PATH: Record<string, Projection> = {
    'kanji.json': withText((core, text) => (core as Omit<Kanji, 'text'>[]).map(k => legacyKanji(k, asText(text)?.entities[k.character]))),
    'index/search.json': withText((core, text) => {
        const glosses = (text as SearchGlosses | undefined) ?? {};
        return (core as SearchIndexEntry[]).map(({ u, ...e }) => ({ ...e, m: glosses[e.id] ?? '', ...(u ? { u } : {}) }));
    }),
    'grammar/conjugations.json': withText((core, text) => legacyGrammarConjugations(core as GrammarConjugationsCore, asText(text))),
    'grammar/index/families.json': withText((core, text) => legacyGrammarFamilies(core as GrammarFamiliesCore, asText(text))),
    'grammar/index/contrasts.json': withText((core, text) => legacyGrammarContrasts(core as GrammarContrastsCore, asText(text))),
    'grammar/index/teaching-order.json': withText((core, text) => legacyGrammarTeachingOrder(core as GrammarTeachingOrderCore, asText(text))),
    'grammar/index/browse.json': withText((core, text) => legacyGrammarBrowse(core as GrammarBrowseIndex, text as GrammarBrowseTexts | undefined)),
    // A realization's title is its point's English title, which the browse index's English text
    // carries for every point: one shared file, rather than every grammar point.
    'grammar/index/variant-groups.json': {
        text: false,
        shared: [BROWSE_TEXT],
        project: (core, _text, shared) => {
            const titles = sharedInput(shared, BROWSE_TEXT) as GrammarBrowseTexts;
            return legacyGrammarVariantGroups(core as GrammarVariantGroups, id => titles[id]?.title);
        },
    },
    'media/index.json': withText((core, text) => (core as Omit<MediaIndexEntry, 'text'>[]).map(e => legacyMediaEntry(e, asText(text)?.entities[e.id]))),
    'media/library.json': { text: false, shared: [], project: core => core },
};

/** The files whose shape changed, by directory: every file in it. */
const BY_DIR: Record<string, Projection> = {
    vocab: withText((core, text) => { const c = core as Omit<Vocabulary, 'text'>; return legacyVocab(c, asText(text)?.entities[c.id]); }),
    kanji: withText((core, text) => { const c = core as Omit<Kanji, 'text'>; return legacyKanji(c, asText(text)?.entities[c.character]); }),
    sentences: withText((core, text) => (core as Omit<Sentence, 'text'>[]).map(s => legacySentence(s, asText(text)?.entities[s.id]))),
    'grammar/points': {
        text: true,
        shared: SLOT_INPUTS,
        project: (core, text, shared) => legacyGrammarPoint(core as GrammarPointCore, asText(text), slotLabels(shared)),
    },
    'grammar/mined': {
        text: true,
        shared: [],
        project: (core, text, _shared, relative) =>
            legacyGrammarExamples(relative.slice(relative.lastIndexOf('/') + 1, -'.json'.length), core as GrammarExampleCore[], asText(text)),
    },
    media: withText((core, text) => legacyMediaTitle(core as Parameters<typeof legacyMediaTitle>[0], asText(text))),
};

function projectionOf(relative: string): Projection | undefined {
    return BY_PATH[relative] ?? BY_DIR[relative.slice(0, Math.max(0, relative.lastIndexOf('/')))];
}

/** What to read to build `relative` (a JSON file, relative to compiled/) in its English shape. */
export function englishInputs(relative: string): EnglishInputs {
    const projection = projectionOf(relative);
    if (!projection) return { core: relative, shared: [] };
    return { core: relative, ...(projection.text ? { text: englishTextPath(relative) } : {}), shared: projection.shared };
}

/** `relative` in its English shape, from the inputs `englishInputs(relative)` named. */
export function englishFile(relative: string, inputs: EnglishInputValues): unknown {
    const projection = projectionOf(relative);
    return projection ? projection.project(inputs.core, inputs.text, inputs.shared ?? new Map(), relative) : inputs.core;
}
