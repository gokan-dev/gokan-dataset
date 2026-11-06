// The type of every compiled file, as it is written to compiled/ (decision D9): an entity's core
// is its assembled shape without its `text`, and its text is a TextFile per language. One JSON
// Schema is generated from each of these (scripts/build-schemas.ts), and every compiled file is
// validated against its own (scripts/check-schemas.ts). RESOURCES in src/layout/resources.ts maps
// each file's path to its type.
import type { AudioIndex } from './audio.model';
import type {
    GrammarBrowseIndex, GrammarBrowseTexts, GrammarChapter, GrammarConjugation, GrammarContrastCase, GrammarContrastIndex, GrammarContrastLesson,
    GrammarExample, GrammarFamilyIndex, GrammarJlptIndex, GrammarPoint, GrammarSlot, GrammarTeachingOrder, GrammarVariantGroups,
} from './grammar.model';
import type { FrequencyIndex, JlptIndex, KanjiVocabIndex, KKLCIndex, KKLCKanjiIndex, SearchGlosses, SearchIndex } from './index.model';
import type { Kanji } from './kanji.model';
import type { MediaEpisode, MediaIndexEntry, MediaLibraryWords, MediaTitle } from './media.model';
import type { Sentence } from './sentence.model';
import type { TextFile } from './text.model';
import type { Vocabulary } from './vocabulary.model';

type Core<T> = Omit<T, 'text'>;

export type CompiledVocab = Core<Vocabulary>;
export type CompiledKanji = Core<Kanji>;
export type CompiledKanjiList = Core<Kanji>[];
export type CompiledSentences = Core<Sentence>[];

export type CompiledGrammarExamples = Core<GrammarExample>[];
export type CompiledGrammarPoint = Omit<GrammarPoint, 'text' | 'examples'> & { examples: Core<GrammarExample>[] };
export type CompiledGrammarSlots = Core<GrammarSlot>[];
export type CompiledGrammarConjugations = Record<string, Core<GrammarConjugation>>;
export type CompiledGrammarFamilies = Record<string, Core<GrammarFamilyIndex[string]>>;
export type CompiledGrammarContrasts = Record<string, Omit<GrammarContrastIndex[string], 'text' | 'lessons'> & {
    lessons: (Omit<GrammarContrastLesson, 'cases'> & { cases: Core<GrammarContrastCase>[] })[];
}>;
export type CompiledGrammarTeachingOrder = Omit<GrammarTeachingOrder, 'chapters'> & { chapters: Core<GrammarChapter>[] };
export type CompiledGrammarJlpt = GrammarJlptIndex;
export type CompiledGrammarVariantGroups = GrammarVariantGroups;
export type CompiledGrammarBrowse = GrammarBrowseIndex;
/** grammar/index/aliases.json: a retired or merged point id, and the point it now is. */
export type CompiledGrammarAliases = Record<string, string>;
/** grammar/index/kinds.json: each point's kind. */
export type CompiledGrammarKinds = Record<string, GrammarPoint['kind']>;

export type CompiledMediaTitle = Omit<MediaTitle, 'text' | 'episodes'> & { episodes: Core<MediaEpisode>[] };
export type CompiledMediaIndex = Core<MediaIndexEntry>[];
export type CompiledMediaLibrary = MediaLibraryWords;

export type CompiledSearchIndex = SearchIndex;
export type CompiledFrequencyIndex = FrequencyIndex;
export type CompiledJlptIndex = JlptIndex;
export type CompiledKklcIndex = KKLCIndex;
export type CompiledKklcKanjiIndex = KKLCKanjiIndex;
export type CompiledKanjiVocabIndex = KanjiVocabIndex;
/** index/kanji-orders/{order}.json: a learning order's kanji, first taught first. */
export type CompiledKanjiOrder = string[];
/** index/kanji-components.json: each visual component, its stroke count and the kanji drawn with it. */
export type CompiledKanjiComponents = Record<string, { strokeCount: number; kanji: string[] }>;
/** index/merged-map.json: a JMdict id merged into a word, and that word's id. */
export type CompiledMergedMap = Record<string, string>;
export type CompiledAudioIndex = AudioIndex;

export type CompiledTextFile = TextFile;
export type CompiledSearchGlosses = SearchGlosses;
export type CompiledGrammarBrowseTexts = GrammarBrowseTexts;
/** text/{lang}/index/entities.json: the core files with text in that language, by group. */
export type CompiledEntitiesIndex = Record<string, string[]>;
