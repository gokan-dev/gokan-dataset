import { describe, it, expect } from 'vitest';
import { readingFitsVocab, disambiguateByReading, type ReadingVocab } from './readingDisambiguation';

function vocab(
    id: string,
    kanji: string,
    alternatives: string[],
    primary: string,
    pos: string[] = ['n'],
    readingAlternatives: string[] = [],
): ReadingVocab {
    return {
        id,
        writtenForm: { kanji, alternatives },
        reading: { primary, alternatives: readingAlternatives },
        senses: [{ pos }],
    };
}

// The two differently-read homographs that share the written form 遊ぶ / 進ぶ.
const asobu = vocab('1542160', '遊ぶ', [], 'あそぶ', ['v5b', 'vi']);
const susabu = vocab('2476100', '荒ぶ', ['進ぶ', '遊ぶ'], 'すさぶ', ['v5b', 'vi']);

describe('readingFitsVocab', () => {
    it('accepts an inflected reading that keeps the dictionary stem', () => {
        expect(readingFitsVocab('あそんでる', asobu)).toBe(true);   // 遊んでる
        expect(readingFitsVocab('すさんで', susabu)).toBe(true);    // 荒んで
    });

    it('rejects a reading that does not share the stem (the homograph bug)', () => {
        // 遊んでる (あそぶ) must NOT be read as the rare すさぶ entry.
        expect(readingFitsVocab('あそんでる', susabu)).toBe(false);
        // 進んでいた (すすむ) must NOT attach to a すさむ-type entry, and vice versa.
        expect(readingFitsVocab('すすんでいた', susabu)).toBe(false);
        expect(readingFitsVocab('すさんで', asobu)).toBe(false);
    });

    it('requires an exact reading for a non-inflecting word', () => {
        const kare = vocab('1245280', '彼', [], 'かれ');          // "he"
        const ano = vocab('1000420', '彼の', ['彼'], 'あの');      // "that"
        expect(readingFitsVocab('かれ', kare)).toBe(true);
        expect(readingFitsVocab('かれ', ano)).toBe(false);         // 彼 read かれ is not あの
    });

    it('normalizes katakana so a loanword hiragana reading matches its katakana reading', () => {
        const coffee = vocab('1049180', '珈琲', [], 'コーヒー');
        expect(readingFitsVocab('こーひー', coffee)).toBe(true);
        const achilles = vocab('1015090', 'アキレス腱', [], 'アキレスけん');
        expect(readingFitsVocab('あきれすけん', achilles)).toBe(true);
    });

    it('handles the する / 来る irregular stems so a legitimate form is never rejected', () => {
        const suru = vocab('1157170', '為る', [], 'する', ['vs-i']);
        expect(readingFitsVocab('して', suru)).toBe(true);
        const kuru = vocab('1547720', '来る', [], 'くる', ['vk']);
        expect(readingFitsVocab('きて', kuru)).toBe(true);
        expect(readingFitsVocab('きた', kuru)).toBe(true);     // past: shares the こ/き/く stem
        expect(readingFitsVocab('こない', kuru)).toBe(true);   // negative
        // A same-written-form godan 来る (きたる) also accepts 来た, so neither is dropped.
        const kitaru = vocab('1259420', '来る', [], 'きたる', ['v5r']);
        expect(readingFitsVocab('きた', kitaru)).toBe(true);
    });

    it('never excludes a match that carries no reading', () => {
        expect(readingFitsVocab('', susabu)).toBe(true);
    });
});

describe('disambiguateByReading', () => {
    const vocabById = new Map<string, ReadingVocab>([
        [asobu.id, asobu],
        [susabu.id, susabu],
    ]);

    it('sends an occurrence only to the entry actually read that way', () => {
        expect(disambiguateByReading([asobu.id, susabu.id], 'あそんでる', vocabById)).toEqual([asobu.id]);
    });

    it('leaves a single-owner term untouched', () => {
        expect(disambiguateByReading([susabu.id], 'あそんでる', vocabById)).toEqual([susabu.id]);
    });

    it('keeps the full list when no candidate fits (never drops a match outright)', () => {
        // A reading neither entry can claim: fall back rather than strand the match.
        expect(disambiguateByReading([asobu.id, susabu.id], 'ざぶとん', vocabById)).toEqual([asobu.id, susabu.id]);
    });

    it('keeps both true homophones (same reading)', () => {
        const suruA = vocab('a', '為る', [], 'する', ['vs-i']);
        const suruB = vocab('b', '擦る', ['磨る'], 'する', ['v5r']);  // also read する
        const map = new Map([[suruA.id, suruA], [suruB.id, suruB]]);
        expect(disambiguateByReading(['a', 'b'], 'して', map).sort()).toEqual(['a', 'b']);
    });

    it('does not disambiguate when there is no reading', () => {
        expect(disambiguateByReading([asobu.id, susabu.id], undefined, vocabById)).toEqual([asobu.id, susabu.id]);
    });
});
