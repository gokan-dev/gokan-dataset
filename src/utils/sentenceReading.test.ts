import { describe, it, expect } from 'vitest';
import { annotationContradicts, curatedReading, inflectReading, occurrenceReading, parseIndices } from './sentenceReading';

describe('inflectReading', () => {
    it('keeps the reading before the okurigana and takes the surface okurigana', () => {
        expect(inflectReading('食べる', 'たべる', '食べました')).toBe('たべました');
        expect(inflectReading('開く', 'ひらく', '開いて')).toBe('ひらいて');
        expect(inflectReading('一週間', 'いっしゅうかん', '一週間')).toBe('いっしゅうかん');
    });

    it('gives up when the reading does not end in the okurigana', () => {
        expect(inflectReading('食べる', 'たべろ', '食べた')).toBeUndefined();
        expect(inflectReading('する', 'する', 'した')).toBeUndefined();
    });
});

describe('parseIndices / curatedReading', () => {
    const words = parseIndices('私(わたし) は 眠る{眠ら} 日米間 間(かん)[01]{間}~ 家(いえ)');

    it('reads headword, reading and surface', () => {
        expect(words[0]).toEqual({ headword: '私', reading: 'わたし' });
        expect(words[2]).toEqual({ headword: '眠る', surface: '眠ら' });
        expect(words[4]).toEqual({ headword: '間', reading: 'かん', surface: '間' });
        // An entry number in the parentheses is not a reading.
        expect(parseIndices('妻(#1294330) が')[0]).toEqual({ headword: '妻', entryId: '1294330' });
    });

    it('returns a reading Tatoeba states for this word at this surface', () => {
        expect(curatedReading(words, ['間'], '間')).toEqual({ written: '間', reading: 'かん' });
        expect(curatedReading(words, ['家', '宅'], '家')).toEqual({ written: '家', reading: 'いえ' });
        // An unannotated word says nothing.
        expect(curatedReading(words, ['眠る'], '眠ら')).toBeUndefined();
    });
});

describe('occurrenceReading', () => {
    it('uses Tatoeba where it annotates the word (the sentence justifies it)', () => {
        expect(occurrenceReading({ term: '間', surface: '間', tokenizerReading: 'かん', primary: 'あいだ', inflecting: false, curated: { written: '間', reading: 'かん' } }))
            .toEqual({ reading: 'かん', source: 'tatoeba' });
        // Tatoeba over a tokenizer misreading: 他 is ほか.
        expect(occurrenceReading({ term: '他', surface: '他', tokenizerReading: 'た', primary: 'ほか', inflecting: false, curated: { written: '他', reading: 'ほか' } }))
            .toEqual({ reading: 'ほか', source: 'tatoeba' });
    });

    it('keeps the tokenizer when it agrees with the learned reading, conjugation included', () => {
        expect(occurrenceReading({ term: '来る', surface: '来た', tokenizerReading: 'きた', primary: 'くる', inflecting: true }))
            .toEqual({ reading: 'きた', source: 'tokenizer' });
    });

    it('falls back to the learned reading with the sentence okurigana', () => {
        expect(occurrenceReading({ term: '日本', surface: '日本', tokenizerReading: 'にっぽん', primary: 'にほん', inflecting: false }))
            .toEqual({ reading: 'にほん', source: 'learned' });
        expect(occurrenceReading({ term: '一週間', surface: '一週間', tokenizerReading: 'いちしゅうかん', primary: 'いっしゅうかん', inflecting: false }))
            .toEqual({ reading: 'いっしゅうかん', source: 'learned' });
        expect(occurrenceReading({ term: '開く', surface: '開いて', tokenizerReading: 'あいて', primary: 'ひらく', inflecting: true }))
            .toEqual({ reading: 'ひらいて', source: 'learned' });
    });
});

describe('annotationContradicts', () => {
    it('rules a word out when Tatoeba reads a part of the span in a way it cannot contain', () => {
        // 誰がこの問題を… is indexed 誰(だれ) が: not たが "whose".
        expect(annotationContradicts(parseIndices('誰(だれ) が 此の 問題'), '誰が', ['たが'])).toBe(true);
        // ６時に: 時(じ) is not part of ときに.
        expect(annotationContradicts(parseIndices('６ 時(じ) に 起きる{起きていた}'), '時に', ['ときに'])).toBe(true);
    });

    it('does not rule out a word whose reading contains the part, or without a stated reading', () => {
        expect(annotationContradicts(parseIndices('御 坊ちゃん(ぼっちゃん)'), 'お坊ちゃん', ['おぼっちゃん'])).toBe(false);
        expect(annotationContradicts(parseIndices('清水の舞台から飛び降りる{清水の舞台から飛び降りた}'), '清水の舞台', ['きよみずのぶたい'])).toBe(false);
        expect(annotationContradicts(parseIndices('数日 間'), '数日間', ['すうじつかん'])).toBe(false);
    });

    it('sees through compound sound changes', () => {
        // ８分 はっぷん: 分(ふん) voiced and doubled.
        expect(annotationContradicts(parseIndices('８ 分(ふん)'), '８分', ['はっぷん'])).toBe(false);
        // 一週 いっしゅう: 一(いち) doubled.
        expect(annotationContradicts(parseIndices('一(いち) 週'), '一週', ['いっしゅう'])).toBe(false);
    });
});
