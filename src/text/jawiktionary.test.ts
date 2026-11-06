import { describe, expect, it } from 'vitest';
import { glossSpellings, reverseRecords, senseLanguage, translationRecords } from './jawiktionary';
import { parseKaikkiEntry, type KaikkiEntry } from './kaikki';

function entry(raw: Record<string, unknown>): KaikkiEntry {
    const parsed = parseKaikkiEntry(raw);
    if (!parsed) throw new Error('not an entry');
    return parsed;
}

describe('translation tables', () => {
    const kana = entry({
        word: 'てがみ', lang: '日本語', pos: 'noun',
        translations: [
            { lang_code: 'zh', lang: '中国語', word: '信' },
            { lang_code: 'cmn', lang: '北京官話', word: '飲/饮' },
            { lang_code: 'nan', lang: '閩南語', word: '批' },
            { lang_code: 'yue', lang: '広東語', word: '信' },
            { lang_code: 'en', lang: '英語', word: 'letter' },
        ],
    });
    const pointer = entry({ word: '手紙', lang: '日本語', pos: 'character', senses: [{ glosses: ['てがみの漢字表記。'] }] });

    it("keeps Mandarin and Southern Min, splits a cell giving both scripts, and lends a kana entry's table to the kanji page pointing to it", () => {
        const records = translationRecords([kana, pointer]);
        expect(records).toEqual([
            { ref: 'てがみ#日本語', spelling: 'てがみ', readings: ['てがみ'], equivalents: [{ value: '信', lang: 'zh' }, { value: '飲', lang: 'zh' }, { value: '饮', lang: 'zh' }, { value: '批', lang: 'nan' }] },
            { ref: 'てがみ#日本語', spelling: '手紙', readings: ['てがみ'], equivalents: [{ value: '信', lang: 'zh' }, { value: '飲', lang: 'zh' }, { value: '饮', lang: 'zh' }, { value: '批', lang: 'nan' }] },
        ]);
    });

    it("reads a kanji entry by its transliterations, a verbal noun's without its する", () => {
        const [record] = translationRecords([entry({
            word: '検索', lang: '日本語', pos: 'verb', forms: [{ form: 'けんさくする', tags: ['transliteration'] }], translations: [{ lang_code: 'zh', word: '检索' }],
        })]);
        expect(record?.readings).toEqual(['けんさく']);
    });
});

describe('Chinese entries read backwards', () => {
    it('attaches on a whole gloss or a whole 、-separated part, never on a word inside a phrase', () => {
        expect(glossSpellings('手紙。')).toEqual(['手紙']);
        // Neither 手紙 nor また: only a whole part is a candidate, and this one is no word.
        expect(glossSpellings('長期間会わないこと。また、手紙を送らないこと。')).toEqual(['手紙を送らないこと']);
        expect(glossSpellings('信じる、信用する、信頼する。')).toEqual(['信じる', '信用する', '信用', '信頼する', '信頼']);
        expect(glossSpellings('（日本語に同じ）冠詞。')).toEqual(['冠詞']);
    });

    it("gives the entry's headwords, both scripts, as equivalents of the word its gloss is", () => {
        const records = reverseRecords(entry({
            word: '开水', lang: '中国語', pos: 'noun',
            forms: [{ form: '開水', tags: ['canonical', 'Traditional-Chinese'] }],
            senses: [{ glosses: ['湯。熱湯。'] }, { glosses: ['熱湯。'] }],
        }));
        expect(records).toEqual([{ ref: '开水#中国語', spelling: '熱湯', equivalents: [{ value: '开水', lang: 'zh' }, { value: '開水', lang: 'zh' }] }]);
    });

    it('tags a Southern Min sense nan, and leaves out a sense in another Chinese language', () => {
        const records = reverseRecords(entry({
            word: '青', lang: '中国語', pos: 'adj',
            senses: [{ glosses: ['(閩南語) 新鮮。'] }, { glosses: ['(広東語) 緑。'] }, { glosses: ['青い。'] }],
        }));
        expect(records.map(r => [r.spelling, r.equivalents[0]?.lang])).toEqual([['新鮮', 'nan'], ['青い', 'zh']]);
        expect(senseLanguage(['台湾語'])).toBe('nan');
        expect(senseLanguage(['比喩'])).toBe('zh');
        expect(senseLanguage(['呉語'])).toBeUndefined();
    });
});
