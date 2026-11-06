import { describe, expect, it } from 'vitest';
import { hiraganaReading, isAllKana, kaikkiRef, parseKaikkiEntry, rubyReading, spellingReading } from './kaikki';

describe('kaikki entries', () => {
    it('narrows a JSONL line to the fields the readers use, and refuses what is not an entry', () => {
        const entry = parseKaikkiEntry({
            word: '手紙', lang: '日語', pos: 'noun', categories: [{ name: '日語名詞' }],
            forms: [{ form: '手紙', tags: ['canonical'], ruby: [['手', 'て'], ['紙', 'がみ'], ['broken']] }, { tags: ['no form'] }],
            senses: [{ glosses: ['信，信件', 3], raw_tags: ['鹿兒島'] }, { form_of: [{ word: 'てがみ' }] }],
            translations: [{ lang_code: 'zh', lang: '中国語', word: '信' }, { lang_code: 'zh' }],
        });
        expect(entry).toEqual({
            word: '手紙', lang: '日語', pos: 'noun',
            forms: [{ form: '手紙', tags: ['canonical'], ruby: [['手', 'て'], ['紙', 'がみ']] }],
            senses: [{ glosses: ['信，信件'], tags: [], rawTags: ['鹿兒島'], pointer: false }, { glosses: [], tags: [], rawTags: [], pointer: true }],
            translations: [{ langCode: 'zh', lang: '中国語', word: '信' }],
        });
        expect(entry && kaikkiRef(entry)).toBe('手紙#日語');
        expect(parseKaikkiEntry({ pos: 'noun' })).toBeUndefined();
        expect(parseKaikkiEntry('手紙')).toBeUndefined();
    });

    it('reads a ruby, and normalises readings as the matcher compares them', () => {
        expect(rubyReading('お手紙', [['手', 'て'], ['紙', 'がみ']])).toBe('おてがみ');
        expect(rubyReading('手紙', [['手', 'て']])).toBeUndefined();
        expect(hiraganaReading('テ・ガミ')).toBe('てがみ');
        expect(isAllKana('てがみ')).toBe(true);
        expect(isAllKana('手紙')).toBe(false);
        expect(spellingReading('検索', 'けんさくする')).toBe('けんさく');
        expect(spellingReading('する', 'する')).toBe('する');
    });
});
