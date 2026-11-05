import { describe, expect, it } from 'vitest';
import { parseKaikkiEntry, type KaikkiEntry } from './kaikki';
import { isBotEntry, readSense, spellingPrefix, zhWiktionaryRecords } from './zhwiktionary';

function entry(raw: Record<string, unknown>): KaikkiEntry {
    const parsed = parseKaikkiEntry({ lang: '日語', ...raw });
    if (!parsed) throw new Error('not an entry');
    return parsed;
}

describe('Chinese Wiktionary records', () => {
    it("reads a page's own word by its canonical form's ruby, keeping each sense's tags", () => {
        const [record, ...rest] = zhWiktionaryRecords(entry({
            word: '手紙', pos: 'noun',
            forms: [{ form: '手紙', tags: ['canonical'], ruby: [['手', 'て'], ['紙', 'がみ']] }],
            senses: [{ glosses: ['信，信件'] }, { glosses: ['箋'], tags: ['archaic'] }],
        }));
        expect(rest).toEqual([]);
        expect(record).toEqual({
            ref: '手紙#日語', pos: 'noun', spelling: '手紙', reading: 'てがみ',
            senses: [{ glosses: ['信，信件'], tags: [] }, { glosses: ['箋'], tags: ['archaic'] }],
        });
    });

    it("follows the kana-page convention: each kanji spelling gets the senses that name it, or name none", () => {
        const records = zhWiktionaryRecords(entry({
            word: 'のむ', pos: 'verb',
            forms: [{ form: '飲む', tags: ['alternative', 'kanji'] }, { form: '呑む', tags: ['alternative', 'kanji'] }],
            senses: [{ glosses: ['飲む，呑む： 喝，饮'] }, { glosses: ['飲む，喫む： 吸煙'] }, { glosses: ['呑む： 小看，藐视'] }, { glosses: ['围攻，一齐袭击'] }],
        }));
        const bySpelling = new Map(records.map(r => [r.spelling, r]));
        expect([...bySpelling.keys()]).toEqual(['のむ', '飲む', '呑む', '喫む']);
        expect(bySpelling.get('飲む')?.senses.map(s => s.glosses[0])).toEqual(['喝，饮', '吸煙', '围攻，一齐袭击']);
        expect(bySpelling.get('呑む')?.senses.map(s => s.glosses[0])).toEqual(['喝，饮', '小看，藐视', '围攻，一齐袭击']);
        expect(bySpelling.get('飲む')?.reading).toBe('のむ');
        expect(bySpelling.get('飲む')?.senses[0]?.spellings).toEqual(['飲む', '呑む']);
    });

    it('reads a verbal noun page, read as its verb, by the noun', () => {
        const [record] = zhWiktionaryRecords(entry({
            word: '解決', pos: 'verb', forms: [{ form: '解決する', tags: ['canonical'], ruby: [['解', 'かい'], ['決', 'けつ']] }], senses: [{ glosses: ['解决'] }],
        }));
        expect(record?.reading).toBe('かいけつ');
    });

    it('recognises and leaves out the bot entries (decision D5), and entries that define nothing', () => {
        const bot = entry({ word: '汚泥処理', pos: 'unknown', senses: [{ glosses: ['汚泥処理【おでいしょり】\n污泥处理'] }] });
        expect(isBotEntry(bot)).toBe(true);
        expect(zhWiktionaryRecords(bot)).toEqual([]);
        expect(zhWiktionaryRecords(entry({ word: '飲む', pos: 'soft-redirect', senses: [{ tags: ['no-gloss'] }] }))).toEqual([]);
        expect(zhWiktionaryRecords(entry({ word: 'のみ', pos: 'verb', senses: [{ glosses: ['のむ 的連用形'], form_of: [{ word: 'のむ' }] }] }))).toEqual([]);
    });

    it('takes a nested sense whose first gloss is only a prefix', () => {
        expect(readSense({ glosses: ['騒ぐ：', '发出喧闹的声音'], tags: [], rawTags: ['鹿兒島'], pointer: false }))
            .toEqual({ glosses: ['发出喧闹的声音'], tags: ['鹿兒島'], spellings: ['騒ぐ'] });
    });

    it('reads a prefix only when every name in it is a spelling', () => {
        expect(spellingPrefix('飲む，呑む： 喝')).toEqual({ spellings: ['飲む', '呑む'], rest: '喝' });
        expect(spellingPrefix('（書面語）：正式')).toBeUndefined();
    });
});
