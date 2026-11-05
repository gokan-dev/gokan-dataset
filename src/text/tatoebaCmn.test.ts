import { describe, expect, it } from 'vitest';
import { directionOf, linkKind, sentenceBase, tsvRows } from './tatoebaCmn';

describe("Tatoeba's direction rule", () => {
    // 1 (Japanese) and 2 (Mandarin) were translated one from the other; 3 (Mandarin) from 4 (English).
    const base = new Map([['2', '1'], ['1', '0'], ['3', '4'], ['5', '0'], ['6', '7'], ['8', '\\N']]);
    const japanese = new Set(['1', '5', '7', '9']);

    it('keeps a link only when one sentence was translated from the other', () => {
        expect(linkKind('1', '2', base, japanese)).toBe('zhFromJa');
        expect(directionOf('zhFromJa')).toBe('fromJapanese');
        expect(linkKind('6', '7', new Map([['6', '7'], ['7', '0']]), japanese)).toBe('jaFromZh');
        expect(directionOf('jaFromZh')).toBe('toJapanese');
    });

    it('drops Mandarin translated from a third sentence, or of unknown origin', () => {
        expect(linkKind('1', '3', base, japanese)).toBe('zhFromOtherLang');
        expect(linkKind('5', '6', base, japanese)).toBe('zhFromOtherJa');
        expect(linkKind('1', '8', base, japanese)).toBe('unknown');
        expect(linkKind('1', '5', base, japanese)).toBe('bothOriginal');
        expect(linkKind('2', '5', base, japanese)).toBe('zhOriginalJaFromOther');
        for (const kind of ['zhFromOtherLang', 'zhFromOtherJa', 'unknown', 'bothOriginal', 'zhOriginalJaFromOther'] as const) expect(directionOf(kind)).toBeUndefined();
    });

    it('reads the exports line by line', () => {
        expect(tsvRows('1\tjpn\t今日は。\r\n\n2\tcmn\t你好。\n')).toEqual([['1', 'jpn', '今日は。'], ['2', 'cmn', '你好。']]);
        expect(sentenceBase('2\t1\r')).toEqual(['2', '1']);
        expect(sentenceBase('')).toBeUndefined();
    });
});
