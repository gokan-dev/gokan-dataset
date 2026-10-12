import { describe, it, expect } from 'vitest';
import type { Kanjidic2CharacterDTO } from '../models/data.model';
import type { Kanji } from '../models/kanji.model';
import { componentForms, isCompatibilityIdeograph, kangxiRadical, kanjidicFields, orderList, orderPositions } from './kanjiSources';

/** 学 as KANJIDIC2 has it, trimmed to the fields the build reads. */
function gaku(overrides: Partial<Kanjidic2CharacterDTO> = {}): Kanjidic2CharacterDTO {
    return {
        literal: '学',
        radicals: [{ type: 'classical', value: 39 }],
        misc: { grade: 1, strokeCounts: [8], frequency: 63, jlptLevel: 4 },
        dictionaryReferences: [
            { type: 'nelson_c', value: '1271' },
            { type: 'heisig', value: '324' },
            { type: 'heisig6', value: '346' },
            { type: 'kanji_in_context', value: '50' },
            { type: 'busy_people', value: '2.9' },
        ],
        readingMeaning: {
            groups: [{
                readings: [
                    { type: 'pinyin', value: 'xue2' },
                    { type: 'ja_on', value: 'ガク' },
                    { type: 'ja_kun', value: 'まな.ぶ' },
                ],
                meanings: [
                    { lang: 'en', value: 'study' },
                    { lang: 'fr', value: 'étudier' },
                    { lang: 'en', value: 'learning' },
                ],
            }],
            nanori: ['さと', 'たか'],
        },
        ...overrides,
    };
}

describe('kanjidicFields', () => {
    it('keeps the English meanings and the Japanese readings, in KANJIDIC2 order', () => {
        const fields = kanjidicFields(gaku());
        expect(fields.meanings).toEqual(['study', 'learning']);
        expect(fields.readings).toEqual({ on: ['ガク'], kun: ['まな.ぶ'], nanori: ['さと', 'たか'] });
        expect(fields).toMatchObject({ strokeCount: 8, grade: 1, newspaperFrequency: 63, radical: { number: 39, character: '子' } });
    });

    it('leaves out what KANJIDIC2 does not give, rather than writing null', () => {
        const fields = kanjidicFields(gaku({ misc: { grade: null, strokeCounts: [8, 7], frequency: null, jlptLevel: null }, readingMeaning: null }));
        expect(fields).not.toHaveProperty('grade');
        expect(fields).not.toHaveProperty('newspaperFrequency');
        expect(fields.strokeCount).toBe(8);
        expect(fields.meanings).toEqual([]);
    });

    it('fails on a kanji with no stroke count', () => {
        expect(() => kanjidicFields(gaku({ misc: { grade: 1, strokeCounts: [], frequency: null, jlptLevel: null } }))).toThrow(/stroke count/);
    });
});

describe('orderPositions', () => {
    it('reads each learning order, and skips lookup dictionaries and orders that do not teach the kanji', () => {
        expect(orderPositions(gaku())).toEqual({ rtk: 346, rtkLegacy: 324, kanjiInContext: 50 });
    });

    it('fails on a reference that is not a position', () => {
        expect(() => orderPositions(gaku({ dictionaryReferences: [{ type: 'heisig6', value: '2.9' }] }))).toThrow(/not a position/);
    });
});

describe('kangxiRadical', () => {
    it('names a radical by its ideograph', () => {
        expect(kangxiRadical(1)).toEqual({ number: 1, character: '一' });
        expect(kangxiRadical(85)).toEqual({ number: 85, character: '水' });
        expect(kangxiRadical(214)).toEqual({ number: 214, character: '龠' });
    });

    it('fails outside 1-214', () => {
        expect(() => kangxiRadical(215)).toThrow();
    });
});

describe('orderList', () => {
    const kanji = (character: string, steps: Kanji['steps'], newspaperFrequency?: number): Kanji => ({
        character, steps, newspaperFrequency, meanings: [], readings: { on: [], kun: [], nanori: [] }, strokeCount: 1, components: [],
    });
    const KANJI = [
        kanji('海', { kklc: 106, rtk: 500, jlpt: 4 }, 200),
        kanji('学', { kklc: 99, rtk: 346, jlpt: 5 }, 63),
        kanji('日', { kklc: 1, rtk: 12, jlpt: 5 }, 1),
        kanji('鬱', { kklc: 2141, rtk: 2120 }),
    ];

    it('lists a book order by its positions, leaving out the kanji it does not teach', () => {
        expect(orderList(KANJI, 'rtk')).toEqual(['日', '学', '海', '鬱']);
        expect(orderList(KANJI, 'kanjiInContext')).toEqual([]);
    });

    it('lists JLPT N5 first, the most frequent first within a level', () => {
        expect(orderList(KANJI, 'jlpt')).toEqual(['日', '学', '海']);
    });

    it('lists frequency by newspaper rank, only the ranked kanji', () => {
        expect(orderList(KANJI, 'frequency')).toEqual(['日', '学', '海']);
    });
});

describe('isCompatibilityIdeograph', () => {
    it('tells a compatibility ideograph from the kanji it normalises into', () => {
        expect(isCompatibilityIdeograph('海')).toBe(true);
        expect('海'.normalize('NFC')).toBe('海');
        expect(isCompatibilityIdeograph('海')).toBe(false);
        expect(isCompatibilityIdeograph('𠮟')).toBe(false);
    });
});

describe('componentForms', () => {
    it("replaces RADKFILE's stand-ins with the components they stand for", () => {
        expect(componentForms(['汁', '母', '毋', '乞'])).toEqual(['氵', '母', '毋', '𠂉']);
        expect(componentForms(['邦', '阡'])).toEqual(['⻏', '⻖']);
    });
});
