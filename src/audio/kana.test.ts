import { describe, it, expect } from 'vitest';
import { pronunciationKey, toKatakana } from './kana';

describe('pronunciationKey', () => {
    it('reads a long vowel the same however it is spelled', () => {
        expect(pronunciationKey('センセー')).toBe(pronunciationKey('せんせい'));
        expect(pronunciationKey('センセエ')).toBe(pronunciationKey('せんせい'));
        expect(pronunciationKey('キョー')).toBe(pronunciationKey('きょう'));
        expect(pronunciationKey('トオリ')).toBe(pronunciationKey('とおり'));
    });

    it('keeps readings that sound different apart', () => {
        expect(pronunciationKey('ニッポン')).not.toBe(pronunciationKey('にほん'));
        expect(pronunciationKey('ニンキ')).not.toBe(pronunciationKey('ひとけ'));
    });

    it('drops punctuation and anything that is not kana', () => {
        expect(pronunciationKey('キョオワ、ニンキ。')).toBe('キョオワニンキ');
    });

    it('treats を, ぢ and づ as pronounced', () => {
        expect(pronunciationKey('を')).toBe('オ');
        expect(pronunciationKey('つづく')).toBe(pronunciationKey('ツズク'));
    });
});

describe('toKatakana', () => {
    it('converts hiragana and leaves the rest', () => {
        expect(toKatakana('きょうは今日')).toBe('キョウハ今日');
    });
});
