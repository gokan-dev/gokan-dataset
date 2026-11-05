import { describe, expect, it } from 'vitest';
import type { Label, Translation } from '../models/text.model';
import type { Vocabulary } from '../models/vocabulary.model';
import { jmdictText, type JmdictSense } from '../text/jmdict';
import { rendering } from '../text/renderings';
import { episodeText, mediaTitleText } from '../text/media';
import type { EntityText, TextFile } from '../models/text.model';
import { grammarSlots, slotLabelsIn } from '../text/grammarSlots';
import { contrastCaseId, grammarExampleId, grammarLabel, grammarProse, grammarTranslation } from '../text/grammarText';
import {
    legacyGrammarBrowse, legacyGrammarConjugations, legacyGrammarContrasts, legacyGrammarExamples, legacyGrammarFamilies, legacyGrammarPoint,
    legacyGrammarTeachingOrder, legacyGrammarVariantGroups, legacyKanji, legacyMediaEntry, legacyMediaTitle, legacySentence, legacyVocab, type GrammarPointCore,
} from './legacy';

const misc = { isAbbreviation: false, isSuffix: false, isPrefix: false, isArchaic: false, isRare: false, rawTags: [] };
const sense = (entryId: string, glosses: string[], extra: Partial<JmdictSense> = {}): JmdictSense =>
    ({ pos: ['n'], misc, glosses, related: { compounds: [] }, entryId, lang: 'en', ...extra });

describe('legacyVocab', () => {
    const senses = [
        sense('1', ['bridge', 'span', 'arch', 'deck']),
        sense('2', ['chopsticks'], { appliesToReadings: ['はし'] }),
    ];
    const core: Omit<Vocabulary, 'text'> = {
        id: '1',
        writtenForm: { kanji: '橋', alternatives: [], containedKanji: ['橋'] },
        reading: { primary: 'はし', alternatives: [] },
        frequency: { kanjiRank: 1 },
        progression: { kklcStep: 1 },
        pos: ['n'],
        isCommon: true,
        mergedVocabs: [
            { id: '1', isBase: true, originalPrimaryReading: 'はし' },
            { id: '2', isBase: false, originalPrimaryReading: 'はし' },
        ],
    };
    const text = jmdictText('1', senses);

    it("gives every JMdict entry its own definition, the merged one matched by spelling", () => {
        expect(text.en?.renderings.map(r => [r.source.ref, r.match])).toEqual([['1', 'id'], ['2', 'spelling']]);
    });

    it('rebuilds the senses, in order, and each merged entry summary from its own first sense', () => {
        const legacy = legacyVocab(core, text.en);
        expect(legacy.senses.map(s => s.glosses)).toEqual([['bridge', 'span', 'arch', 'deck'], ['chopsticks']]);
        expect(legacy.senses[1]?.appliesToReadings).toEqual(['はし']);
        expect(legacy.mergedVocabs?.map(m => m.originalGlosses)).toEqual([['bridge', 'span', 'arch'], ['chopsticks']]);
        expect(legacy).not.toHaveProperty('pos');
    });

    it('keeps one language out of another', () => {
        const mixed = jmdictText('1', [...senses, sense('1', ['Brücke'], { lang: 'de' })]);
        expect(Object.keys(mixed)).toEqual(['en', 'de']);
        expect(legacyVocab(core, mixed.en).senses).toHaveLength(2);
    });
});

describe('legacySentence and legacyKanji', () => {
    it('rebuilds a sentence\'s English translations with their Tatoeba ids', () => {
        const translation = rendering<Translation>('sentence', '9', 'en', { role: 'translation', source: { source: 'tatoeba', ref: '10' }, match: 'id', status: 'imported', value: 'A bridge.' });
        expect(legacySentence({ id: '9', original: '橋。', vocabIds: ['1'] }, { renderings: [translation] }).en).toEqual([{ id: '10', text: 'A bridge.' }]);
    });

    it("rebuilds a kanji's meanings from its labels, whichever source wrote them", () => {
        const label = (value: string, source: string) => rendering<Label>('kanji', '〇', 'en', { role: 'label', source: { source, ref: '〇' }, match: 'id', status: 'reviewed', value });
        const core = { character: '〇', steps: {}, readings: { on: [], kun: [], nanori: [] }, strokeCount: 1, components: [] };
        expect(legacyKanji(core, { renderings: [label('zero', 'gokan')] }).meanings).toEqual(['zero']);
        expect(legacyKanji(core, undefined).meanings).toEqual([]);
    });
});

describe('legacy grammar', () => {
    const slots = slotLabelsIn(grammarSlots(), 'en');
    const hanabira = { source: 'hanabira', ref: 'n5-016' };
    const gokan = { source: 'gokan', ref: 'n5-016' };
    const exampleId = grammarExampleId('n5-016', '高くないです。');
    const file = (kind: TextFile['kind'], entities: Record<string, EntityText>): TextFile => ({ kind, lang: 'en', entities });

    const core: GrammarPointCore = {
        id: 'n5-016', title: '{i-adjective}', jlptLevel: 5, kind: 'inflection',
        examples: [{ jp: '高くないです。', romaji: 'Takaku nai desu.', words: [], patternWordIndices: [] }],
        family: { id: 'negation', relatedPoints: ['n5-017'] },
    };
    const en = file('grammar', {
        'n5-016': { renderings: [
            grammarLabel('grammar', 'n5-016', 'en', 'name', 'Negative Polite Form', hanabira),
            grammarLabel('grammar', 'n5-016', 'en', 'title', 'い-Adjective: Negative Polite Form', hanabira),
            grammarProse('grammar', 'n5-016', 'en', 'shortExplanation', 'Short.', hanabira),
            grammarProse('grammar', 'n5-016', 'en', 'longExplanation', 'Long.', hanabira),
            grammarProse('grammar', 'n5-016', 'en', 'formation', 'い-Adjective + ないです', hanabira),
            grammarLabel('grammar', 'n5-016', 'en', 'derives', 'negative polite', gokan),
            grammarLabel('family', 'negation', 'en', 'family', 'Negation', { source: 'gokan', ref: 'negation' }),
        ] },
        [exampleId]: { renderings: [grammarTranslation('grammar', exampleId, 'en', 'It is not tall.', hanabira)] },
    });

    it("rebuilds a point's English fields, its title as the source wrote it, and each example's translation", () => {
        expect(legacyGrammarPoint(core, en, slots)).toStrictEqual({
            id: 'n5-016', title: 'い-Adjective: Negative Polite Form', jlptLevel: 5, kind: 'inflection',
            shortExplanation: 'Short.', longExplanation: 'Long.', formation: 'い-Adjective + ないです', derives: 'negative polite',
            family: { id: 'negation', name: 'Negation', relatedPoints: ['n5-017'] },
            examples: [{ jp: '高くないです。', romaji: 'Takaku nai desu.', words: [], patternWordIndices: [], en: 'It is not tall.' }],
        });
    });

    it('renders a title and romaji from their slots where the source spelt them as English does', () => {
        const plain: GrammarPointCore = { id: 'n1-001', title: '{a} うが {b} うが', romaji: '{a} uga {b} uga', jlptLevel: 1, kind: 'construction', examples: [] };
        const legacy = legacyGrammarPoint(plain, undefined, slots);
        expect([legacy.title, legacy.romaji]).toEqual(['A うが B うが', 'A uga B uga']);
        // A field the point never had stays absent, as it was.
        expect(legacy).not.toHaveProperty('usageNote');
        expect(legacy).not.toHaveProperty('derives');
        expect(legacy).not.toHaveProperty('family');
    });

    it("rebuilds mined examples from their sentence's translation, keyed under the point", () => {
        const mined = file('grammar', { [exampleId]: { renderings: [grammarTranslation('sentence', '42', 'en', 'Not tall.', { source: 'tatoeba', ref: '43' })] } });
        expect(legacyGrammarExamples('n5-016', [{ jp: '高くないです。', romaji: '', words: [], patternWordIndices: [] }], mined)[0]?.en).toBe('Not tall.');
    });

    it("rebuilds the indexes' names, cases, chapters and form labels", () => {
        const familyName = grammarLabel('family', 'negation', 'en', 'family', 'Negation', { source: 'gokan', ref: 'negation' });
        expect(legacyGrammarFamilies({ negation: { memberIds: ['n5-016'] } }, file('family', { negation: { renderings: [familyName] } })))
            .toStrictEqual({ negation: { name: 'Negation', memberIds: ['n5-016'] } });

        const caseId = contrastCaseId('negation', 'core', 'n5-016', ['n5-017']);
        const caseFrom = { source: 'gokan', ref: caseId };
        const contrasts = legacyGrammarContrasts(
            { negation: { lessons: [{ id: 'core', title: 'ない / ません', points: ['n5-016', 'n5-017'], cases: [{ focus: 'n5-016', vs: ['n5-017'] }] }], interchangeable: ['x', 'y'] } },
            file('family', { negation: { renderings: [familyName] }, [caseId]: { renderings: [grammarProse('family', caseId, 'en', 'situation', 'S.', caseFrom), grammarProse('family', caseId, 'en', 'guidance', 'G.', caseFrom)] } }),
        );
        expect(contrasts).toStrictEqual({ negation: {
            name: 'Negation', interchangeable: ['x', 'y'],
            lessons: [{ id: 'core', title: 'ない / ません', points: ['n5-016', 'n5-017'], cases: [{ focus: 'n5-016', vs: ['n5-017'], situation: 'S.', guidance: 'G.' }] }],
        } });

        const chapterFrom = { source: 'gokan', ref: 'n5-c01' };
        expect(legacyGrammarTeachingOrder(
            { order: ['n5-016'], chapters: [{ id: 'n5-c01', jlptLevel: 5, points: ['n5-016'] }] },
            file('chapter', { 'n5-c01': { renderings: [grammarLabel('chapter', 'n5-c01', 'en', 'title', 'T', chapterFrom), grammarProse('chapter', 'n5-c01', 'en', 'summary', 'S', chapterFrom)] } }),
        ).chapters).toStrictEqual([{ id: 'n5-c01', title: 'T', summary: 'S', jlptLevel: 5, points: ['n5-016'] }]);

        const label = grammarLabel('conjugation', 'n5-016', 'en', 'formLabel', 'negative polite (くないです)', gokan);
        expect(legacyGrammarConjugations({ 'n5-016': { form: 'i-adj-negative-polite', marker: 'くないです', items: [] } }, file('conjugation', { 'n5-016': { renderings: [label] } })))
            .toStrictEqual({ 'n5-016': { form: 'i-adj-negative-polite', formLabel: 'negative polite (くないです)', items: [] } });
    });

    it("gives variant groups and browse rows their points' English titles and text", () => {
        expect(legacyGrammarVariantGroups({ 'n5-105': [{ id: 'n5-105', relation: 'canonical', title: 'どこにも + {verb} + ません' }] }, () => 'どこにも + Verb + ません'))
            .toStrictEqual({ 'n5-105': [{ id: 'n5-105', relation: 'canonical', title: 'どこにも + Verb + ません' }] });

        const stats = { points: 1, introduced: 1, variants: 0, variantGroups: 0, families: 0, unfamilied: 1, chapters: 1, byLevel: { 5: 1 }, byKind: { construction: 1 }, byAxis: {} };
        const row = { id: 'n5-001', title: '{a} が いちばん～', jlptLevel: 5, kind: 'construction', orderIndex: 0, exampleCount: 1, anchoredExampleCount: 1 };
        const browse = legacyGrammarBrowse({ points: [row], stats }, { 'n5-001': { title: 'A が いちばん～', formation: 'Noun + が', shortExplanation: 'Most.' } });
        expect(browse.points[0]).toStrictEqual({ ...row, title: 'A が いちばん～', formation: 'Noun + が', shortExplanation: 'Most.' });
    });
});

describe('legacy media', () => {
    it("rebuilds a title's English title, genre names, tags and episode titles", () => {
        const text = mediaTitleText('7', 'Hello', [3], ['School']);
        const core = {
            id: '7', kind: 'anime' as const, title: { original: '題', reading: 'だい' }, episodeCount: 1, speechSpeed: 0, difficulty: 1,
            links: {}, genreIds: [3], source: { name: 'Jiten' as const, url: 'u', license: 'CC BY-SA 4.0' as const },
            episodes: [{ number: 1, speechSpeed: 0, sourceUniqueWords: 0, words: [] }],
        };
        const en: TextFile = { kind: 'media', lang: 'en', entities: { '7': text.en ?? { renderings: [] }, '7#1': episodeText('7', 1, 'Episode 1').en ?? { renderings: [] } } };
        const legacy = legacyMediaTitle(core, en);
        expect([legacy.title.english, legacy.genres, legacy.tags, legacy.episodes[0]?.title]).toEqual(['Hello', ['Comedy'], ['School'], 'Episode 1']);
        expect(legacy).not.toHaveProperty('genreIds');
        expect(legacyMediaEntry(core, undefined).title).not.toHaveProperty('english');
    });
});
