import { describe, it, expect } from 'vitest';
import { inheritJlptLevels, type DerivableWord } from './jlpt-derived';

const w = (id: string, kanji: string, reading: string, jlptLevel?: number, alternatives: string[] = []): DerivableWord => ({
    id,
    writtenForm: { kanji, alternatives },
    reading: { primary: reading, alternatives: [] },
    ...(jlptLevel ? { jlptLevel } : {}),
});

describe('inheritJlptLevels', () => {
    it('levels a word formed from a listed word by one affix, spelling and reading alike', () => {
        const words = [
            w('1', '一緒', 'いっしょ', 5), w('2', '一緒に', 'いっしょに'),
            w('3', '早い', 'はやい', 5), w('4', '早く', 'はやく'),
            w('5', '店', 'みせ', 5), w('6', 'お店', 'おみせ'),
            w('7', '私', 'わたし', 5), w('8', '私たち', 'わたしたち'),
            w('9', '誰', 'だれ', 5), w('10', '誰も', 'だれも'),
            w('11', '家族', 'かぞく', 5), w('12', '御家族', 'ごかぞく'),
        ];
        expect(inheritJlptLevels(words, new Set())).toEqual(['2', '4', '6', '8', '10', '12']);
        expect(words[1]).toMatchObject({ jlptLevel: 5, jlptLevelFrom: '1' });
    });

    it('needs the reading to follow the spelling', () => {
        // 上手に would only match if the base were read じょうず; here it is うわて.
        const words = [w('1', '上手', 'うわて', 1), w('2', '上手に', 'じょうずに')];
        expect(inheritJlptLevels(words, new Set())).toEqual([]);
    });

    it('matches the base on an alternative spelling, never chains, and skips exclusions', () => {
        const words = [
            w('1', '序で', 'ついで', 2, ['序']), w('2', '序でに', 'ついでに'),
            w('3', '為', 'ため', 4), w('4', '為に', 'ために'),
        ];
        expect(inheritJlptLevels(words, new Set(['4']))).toEqual(['2']);
        // お友達 is お + 友達, but 友達 here only got its level by derivation: no chain.
        const chain = [w('5', '友', 'とも', 3), w('6', '友たち', 'ともたち'), w('7', 'お友たち', 'おともたち')];
        expect(inheritJlptLevels(chain, new Set())).toEqual(['6']);
    });

    it('leaves a listed word as it is', () => {
        const words = [w('1', '本当', 'ほんとう', 5), w('2', '本当に', 'ほんとうに', 3)];
        expect(inheritJlptLevels(words, new Set())).toEqual([]);
        expect(words[1].jlptLevel).toBe(3);
    });
});
