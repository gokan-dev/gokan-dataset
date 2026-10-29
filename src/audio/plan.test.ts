import { describe, it, expect } from 'vitest';
import { inputFor, planInput, type Pronounce } from './plan';
import type { AudioItem } from './scope';

/** A fake engine: reads 人気 as ニンキ and 日本 as ニッポン, kana as written, and drops the rest. */
const engine: Pronounce = async text => text
    .replace(/今日/g, 'キョー').replace(/人気/g, 'ニンキ').replace(/日本/g, 'ニッポン').replace(/先生/g, 'センセー')
    .replace(/[^ぁ-ゖァ-ヶー]/g, '');

const sentence: AudioItem = {
    id: 's:1',
    text: '今日は人気がない。',
    readings: [{ start: 0, length: 2, reading: 'きょう' }, { start: 3, length: 2, reading: 'ひとけ' }],
};

describe('planInput', () => {
    it('sends in kana only the words the engine reads differently from us', async () => {
        const plan = await planInput(sentence, engine);
        expect(plan.misread).toEqual([{ start: 3, length: 2, reading: 'ひとけ' }]);
        expect(plan.forced).toBe('今日はひとけがない。');
        expect(plan.written).toBe('今日は人気がない。');
    });

    it('keeps the written text when the engine agrees, long vowels included', async () => {
        const plan = await planInput({ id: 'w:1', text: '先生', readings: [{ start: 0, length: 2, reading: 'せんせい' }] }, engine);
        expect(plan.misread).toEqual([]);
        expect(plan.forced).toBe('先生');
    });

    it('sends a misread word item in kana', async () => {
        const plan = await planInput({ id: 'w:2', text: '日本', readings: [{ start: 0, length: 2, reading: 'にほん' }] }, engine);
        expect(plan.forced).toBe('にほん');
    });

    it('leaves an item without readings as written', async () => {
        const plan = await planInput({ id: 'w:3', text: 'ここ', readings: [] }, engine);
        expect(plan).toEqual({ written: 'ここ', forced: 'ここ', misread: [] });
    });

    it('picks the input of the chosen variant', async () => {
        const plan = await planInput(sentence, engine);
        expect(inputFor(plan, 'written')).toBe(plan.written);
        expect(inputFor(plan, 'forced')).toBe(plan.forced);
    });
});
