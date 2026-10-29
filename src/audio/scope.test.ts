import { describe, it, expect } from 'vitest';
import type { Sentence } from '../models/sentence.model';
import { generationOrder, grammarItem, selectScope, sentenceItem, sourceHash, wordItem, type WordForAudio } from './scope';

function sentence(id: string, original: string, vocabIds: string[], matches: Sentence['matches'] = {}): Sentence {
    return { id, original, en: [{ id: `e${id}`, text: '' }], vocabIds, matches };
}

const word = (id: string, kanji: string, reading: string, usuallyKana?: true): WordForAudio =>
    ({ id, writtenForm: { kanji, alternatives: [], containedKanji: [] }, reading: { primary: reading, alternatives: [] }, ...(usuallyKana ? { usuallyKana } : {}) });

describe('wordItem', () => {
    it('reads a word from its written form, checked against our reading', () => {
        expect(wordItem(word('1', '今日', 'きょう'))).toEqual({ id: 'w:1', text: '今日', readings: [{ start: 0, length: 2, reading: 'きょう' }] });
    });

    it('reads a word learned in kana from its kana', () => {
        expect(wordItem(word('2', '此処', 'ここ', true))).toEqual({ id: 'w:2', text: 'ここ', readings: [] });
    });
});

describe('sentenceItem', () => {
    it('keeps the longest of overlapping readings, in text order', () => {
        const s = sentence('9', '一週間後に', ['a', 'b'], {
            a: [{ start: 0, length: 3, reading: 'いっしゅうかん' }],
            b: [{ start: 1, length: 2, reading: 'しゅうかん' }, { start: 3, length: 1, reading: 'ご' }],
        });
        expect(sentenceItem(s).readings).toEqual([{ start: 0, length: 3, reading: 'いっしゅうかん' }, { start: 3, length: 1, reading: 'ご' }]);
    });
});

describe('grammarItem', () => {
    it('gives a reading only to uninflected words: an inflected one carries its dictionary form', () => {
        const item = grammarItem({
            jp: '都会に住んで',
            words: [
                { surface: '都会', vocabId: '1', reading: 'とかい' },
                { surface: 'に', vocabId: null },
                { surface: '住ん', vocabId: '2', reading: 'すん', baseForm: '住む' },
                { surface: 'で', vocabId: null },
            ],
        });
        expect(item.readings).toEqual([{ start: 0, length: 2, reading: 'とかい' }]);
        expect(item.id).toMatch(/^g:[0-9a-f]{16}$/);
    });
});

describe('sourceHash', () => {
    it('changes when the text or a reading changes, so a stale clip is not attached', () => {
        const item = wordItem(word('1', '今日', 'きょう'));
        expect(sourceHash(item)).toBe(sourceHash(wordItem(word('1', '今日', 'きょう'))));
        expect(sourceHash(wordItem(word('1', '今日', 'こんにち')))).not.toBe(sourceHash(item));
    });
});

describe('selectScope', () => {
    const sentences = new Map([
        ['1', [
            sentence('10', '今日は長い長い一日だった。', ['1', '5', '6']),
            sentence('11', '今日だ。', ['1']),
            sentence('12', '今日は雨。', ['1', '7']),
        ]],
    ]);

    it('takes each word, its first sentences for a new learner, and the grammar examples, sorted by id', () => {
        const scope = selectScope({
            vocab: [word('1', '今日', 'きょう')],
            sentencesByVocab: sentences,
            grammarExamples: [{ jp: '雨が降る。', words: [] }],
            topSentences: 2,
        });
        expect(scope.map(i => i.id)).toEqual([expect.stringMatching(/^g:/), 's:11', 's:12', 'w:1']);
    });

    it('makes the most frequent words and their sentences first, grammar examples last', () => {
        const input = {
            vocab: [word('1', '今日', 'きょう'), word('2', '雨', 'あめ')],
            sentencesByVocab: new Map([['2', [sentence('20', '雨。', ['2'])]], ...sentences]),
            grammarExamples: [{ jp: '雨が降る。', words: [] }],
            topSentences: 1,
        };
        const rank: Record<string, number> = { '1': 50, '2': 3 };
        const order = generationOrder(selectScope(input), input, id => rank[id] ?? Infinity);
        expect(order.map(i => i.id)).toEqual(['s:20', 'w:2', 's:11', 'w:1', expect.stringMatching(/^g:/)]);
    });

    it('serves a grammar example that is one of our sentences with that sentence', () => {
        const scope = selectScope({
            vocab: [],
            sentencesByVocab: sentences,
            grammarExamples: [{ jp: '今日は長い長い一日だった。', words: [] }],
            topSentences: 0,
        });
        expect(scope.map(i => i.id)).toEqual(['s:10']);
    });
});
