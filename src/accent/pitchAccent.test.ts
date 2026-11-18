import { describe, expect, it } from 'vitest';
import type { Vocabulary } from '../models/vocabulary.model';
import { accentIndex, assertPitchAccent, morae, pitchAccentOf, unidicDownsteps, wiktionaryDownsteps, type AccentSources } from './pitchAccent';
import type { AccentRow } from './snapshot';

type Word = Pick<Vocabulary, 'id' | 'writtenForm' | 'reading' | 'usuallyKana'>;
const word = (kanji: string, primary: string, alternatives: string[] = [], extra: Partial<Word> = {}): Word => ({
    id: '1', writtenForm: { kanji, alternatives: [], containedKanji: [] }, reading: { primary, alternatives }, ...extra,
});
const sources = (wiktionary: AccentRow[], unidic: AccentRow[] = []): AccentSources => ({ wiktionary: accentIndex(wiktionary), unidic: accentIndex(unidic) });

describe('morae', () => {
    it('joins a small kana to the one before it and counts っ, ん and ー', () => {
        expect(morae('きょう')).toEqual(['きょ', 'う']);
        expect(morae('がっこう')).toEqual(['が', 'っ', 'こ', 'う']);
        expect(morae('コーヒー')).toEqual(['コ', 'ー', 'ヒ', 'ー']);
        expect(morae('せんせい')).toHaveLength(4);
        expect(morae('ティッシュ')).toEqual(['ティ', 'ッ', 'シュ']);
    });
});

describe('wiktionaryDownsteps', () => {
    it('reads numbers and the h, a and o letters', () => {
        expect(wiktionaryDownsteps(['1'], 'はし')).toEqual([1]);
        expect(wiktionaryDownsteps(['h'], 'はし')).toEqual([0]);
        expect(wiktionaryDownsteps(['a'], 'はし')).toEqual([1]);
        expect(wiktionaryDownsteps(['o'], 'はし')).toEqual([2]);
        expect(wiktionaryDownsteps(['4', '3'], 'かんがえる')).toEqual([4, 3]);
    });

    it('leaves out per-part accents, unnumbered nakadaka and numbers beyond the morae', () => {
        expect(wiktionaryDownsteps(['3+0', '3+1', '5'], 'あおいきといき')).toEqual([5]);
        expect(wiktionaryDownsteps(['n'], 'あおい')).toEqual([]);
        expect(wiktionaryDownsteps(['3'], 'はし')).toEqual([]);
    });
});

describe('unidicDownsteps', () => {
    it('keeps numbers within the morae, once each', () => {
        expect(unidicDownsteps(['3', '4'], 'カンガエル')).toEqual([3, 4]);
        expect(unidicDownsteps(['3', '9', '3'], 'センセイ')).toEqual([3]);
    });
});

describe('pitchAccentOf', () => {
    const hashi: AccentRow[] = [
        { form: '箸', reading: 'はし', accents: ['1'] },
        { form: '橋', reading: 'はし', accents: ['o'] },
        { form: '端', reading: 'はし', accents: ['h'] },
        { form: 'はし', reading: 'はし', accents: ['2'] },
    ];

    it('tells homophones apart by their written form', () => {
        const s = sources(hashi);
        expect(pitchAccentOf(word('箸', 'はし'), s)).toEqual([{ reading: 'はし', downsteps: [1], source: 'wiktionary' }]);
        expect(pitchAccentOf(word('橋', 'はし'), s)).toEqual([{ reading: 'はし', downsteps: [2], source: 'wiktionary' }]);
        expect(pitchAccentOf(word('端', 'はし'), s)).toEqual([{ reading: 'はし', downsteps: [0], source: 'wiktionary' }]);
    });

    it('never gives a kanji word the accent of its reading alone', () => {
        expect(pitchAccentOf(word('嘴', 'はし'), sources(hashi))).toEqual([]);
    });

    it('looks a kana word up by its reading', () => {
        const s = sources([{ form: 'ここ', reading: 'ここ', accents: ['0'] }]);
        expect(pitchAccentOf(word('此処', 'ここ', [], { usuallyKana: true }), s)).toEqual([{ reading: 'ここ', downsteps: [0], source: 'wiktionary' }]);
        expect(pitchAccentOf(word('', 'ここ'), s)).toEqual([{ reading: 'ここ', downsteps: [0], source: 'wiktionary' }]);
    });

    it('prefers Wiktionary and falls back to UniDic, matching katakana to hiragana', () => {
        const wikt = [{ form: '先生', reading: 'せんせい', accents: ['3'] }];
        const unidic = [{ form: '先生', reading: 'センセイ', accents: ['1'] }, { form: '部屋', reading: 'ヘヤ', accents: ['2'] }];
        expect(pitchAccentOf(word('先生', 'せんせい'), sources(wikt, unidic))).toEqual([{ reading: 'せんせい', downsteps: [3], source: 'wiktionary' }]);
        expect(pitchAccentOf(word('部屋', 'へや'), sources(wikt, unidic))).toEqual([{ reading: 'へや', downsteps: [2], source: 'unidic' }]);
    });

    it('falls back to UniDic when Wiktionary gives nothing usable', () => {
        const wikt = [{ form: '青息吐息', reading: 'あおいきといき', accents: ['3+0'] }];
        const unidic = [{ form: '青息吐息', reading: 'アオイキトイキ', accents: ['5'] }];
        expect(pitchAccentOf(word('青息吐息', 'あおいきといき'), sources(wikt, unidic))[0]?.source).toBe('unidic');
    });

    it('gives each covered reading its own entry, in the word reading order', () => {
        const s = sources([{ form: '上手', reading: 'うわて', accents: ['0'] }, { form: '上手', reading: 'じょうず', accents: ['3'] }]);
        expect(pitchAccentOf(word('上手', 'じょうず', ['うわて', 'かみて']), s).map(a => a.reading)).toEqual(['じょうず', 'うわて']);
    });

    it('finds an accent under an alternative spelling', () => {
        const w: Word = { ...word('掴む', 'つかむ'), writtenForm: { kanji: '掴む', alternatives: ['摑む'], containedKanji: [] } };
        expect(pitchAccentOf(w, sources([{ form: '摑む', reading: 'つかむ', accents: ['2'] }]))).toHaveLength(1);
    });
});

describe('assertPitchAccent', () => {
    const w = word('橋', 'はし');
    it('accepts a drawable accent', () => {
        expect(() => assertPitchAccent(w, [{ reading: 'はし', downsteps: [2, 0], source: 'wiktionary' }])).not.toThrow();
    });
    it('fails on a downstep beyond the morae', () => {
        expect(() => assertPitchAccent(w, [{ reading: 'はし', downsteps: [3], source: 'wiktionary' }])).toThrow(/has 2 morae/);
    });
    it('fails on a reading the word does not have', () => {
        expect(() => assertPitchAccent(w, [{ reading: 'きょう', downsteps: [1], source: 'unidic' }])).toThrow(/does not have/);
    });
    it('fails on an entry without a downstep', () => {
        expect(() => assertPitchAccent(w, [{ reading: 'はし', downsteps: [], source: 'unidic' }])).toThrow(/without a downstep/);
    });
});
