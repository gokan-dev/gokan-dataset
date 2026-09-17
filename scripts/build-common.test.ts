import { describe, it, expect } from 'vitest';
import { resolveJlptLevel } from './build-common';

type Dataset = Record<string, Array<{ reading: string; level: number }>>;

describe('resolveJlptLevel', () => {
    it('matches on the primary written form', () => {
        const data: Dataset = { 本: [{ reading: 'ほん', level: 5 }] };
        expect(resolveJlptLevel(data, ['本'], ['ほん'])).toBe(5);
    });

    it('prefers the entry whose reading is this word\'s primary reading', () => {
        const data: Dataset = {
            上手: [{ reading: 'じょうず', level: 5 }, { reading: 'うわて', level: 1 }],
        };
        expect(resolveJlptLevel(data, ['上手'], ['うわて', 'じょうず'])).toBe(1);
    });

    it('falls back to a listed alternative reading, then to the first entry', () => {
        const data: Dataset = {
            上手: [{ reading: 'じょうず', level: 5 }, { reading: 'うわて', level: 1 }],
        };
        // Primary reading absent from the dataset, an alternative present.
        expect(resolveJlptLevel(data, ['上手'], ['かみて', 'うわて'])).toBe(1);
        // No reading in common at all: the dataset's own first entry stands.
        expect(resolveJlptLevel(data, ['上手'], ['かみて'])).toBe(5);
    });

    it('matches on an alternative written form when the headword is absent', () => {
        // JMDict heads this 近づく; the JLPT list writes it 近付く.
        const data: Dataset = { 近付く: [{ reading: 'ちかづく', level: 1 }] };
        expect(resolveJlptLevel(data, ['近づく', '近付く'], ['ちかづく'])).toBe(1);
    });

    it('matches on the reading for a usually-kana word with no kanji key', () => {
        // 鞄 is listed only as かばん.
        const data: Dataset = { かばん: [{ reading: 'かばん', level: 5 }] };
        expect(resolveJlptLevel(data, ['鞄', '革包'], ['かばん', 'カバン'])).toBe(5);
    });

    it('prefers a written-form hit over a reading hit', () => {
        const data: Dataset = {
            熱い: [{ reading: 'あつい', level: 4 }],
            あつい: [{ reading: 'あつい', level: 5 }],
        };
        expect(resolveJlptLevel(data, ['熱い'], ['あつい'])).toBe(4);
    });

    it('rejects a reading hit whose reading is not this word\'s primary reading', () => {
        // かみ is the JLPT list's 紙; a homophone read かみ must not inherit its level.
        const data: Dataset = { かみ: [{ reading: 'かみ', level: 5 }] };
        expect(resolveJlptLevel(data, ['神'], ['しん', 'かみ'])).toBeUndefined();
    });

    it('returns undefined when nothing matches', () => {
        expect(resolveJlptLevel({}, ['鞄'], ['かばん'])).toBeUndefined();
    });
});
