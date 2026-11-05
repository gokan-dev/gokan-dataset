import { describe, expect, it } from 'vitest';
import type { TextByLanguage } from '../models/text.model';
import { grammarLabel } from './grammarText';
import { GRAMMAR_SLOTS, grammarSlots, neutralTitle, parseSlots, renderSlots, romajiIn, slotCodesOf, slotLabelsIn, splitTitleName, titleIn } from './grammarSlots';
import { labelsOf } from './renderings';

const en = slotLabelsIn(grammarSlots(), 'en');

describe('parseSlots', () => {
    it('writes each slot word as its code, a numbered noun before the bare one', () => {
        expect(parseSlots('Noun1 が Noun1 なら、 Noun2 も Noun2 だ', 'en', 'title')).toBe('{noun1} が {noun1} なら、 {noun2} も {noun2} だ');
        expect(parseSlots('A うが B うが', 'en', 'title')).toBe('{a} うが {b} うが');
        expect(parseSlots('Verb て います', 'en', 'title')).toBe('{verb} て います');
    });

    it('finds a slot word glued to Japanese, but not inside a longer Latin word', () => {
        expect(parseSlots('Verbる / Noun(である) + 限り(は)', 'en', 'title')).toBe('{verb}る / {noun}(である) + 限り(は)');
        expect(parseSlots('文A。そのうえ 文B。', 'en', 'title')).toBe('文{a}。そのうえ 文{b}。');
        expect(parseSlots('Bun A. Sorede Bun B', 'en', 'romaji')).toBe('Bun {a}. Sorede Bun {b}');
    });

    it('spells a label with kana in romaji inside a romanisation', () => {
        expect(parseSlots('い-Adjective く する/なる', 'en', 'title')).toBe('{i-adjective} く する/なる');
        expect(parseSlots('i-Adjective kusuru/naru', 'en', 'romaji')).toBe('{i-adjective} kusuru/naru');
        expect(parseSlots('Verb-te imasu', 'en', 'romaji')).toBe('{verb}-te imasu');
    });

    it('keeps romanisation and romaji inside a title, which are not slots', () => {
        expect(parseSlots('そんな (sonna) + Noun', 'en', 'title')).toBe('そんな (sonna) + {noun}');
        expect(parseSlots('Verb TE sashiageru', 'en', 'romaji')).toBe('{verb} TE sashiageru');
    });

    it('takes an upstream casing slip as the slot, and only a capital single letter', () => {
        expect(parseSlots('な-adjective に する/なる', 'en', 'title')).toBe('{na-adjective} に する/なる');
        expect(parseSlots('verb-ru ga hayai ka', 'en', 'romaji')).toBe('{verb}-ru ga hayai ka');
        expect(parseSlots('a b', 'en', 'romaji')).toBe('a b');
    });

    it('fails on a slot word it does not know, rather than leaving English in the core', () => {
        expect(() => parseSlots('Noun3 の', 'en', 'title')).toThrow(/does not know/);
        expect(() => parseSlots('Adjective + さ', 'en', 'title')).toThrow(/"Adjective"/);
    });
});

describe('renderSlots and slotCodesOf', () => {
    it("names each code in a language, and gives nothing when one has no name there", () => {
        expect(slotCodesOf('{a} うが {b} うが')).toEqual(['a', 'b']);
        expect(renderSlots('{verb}る が早いか', en.title)).toBe('Verbる が早いか');
        expect(renderSlots('{i-adjective} kusuru', en.romaji)).toBe('i-Adjective kusuru');
        expect(renderSlots('{verb} ます', () => undefined)).toBeUndefined();
    });

    it('round-trips every slot through its English label', () => {
        for (const slot of GRAMMAR_SLOTS) {
            const label = slot.labels.en;
            if (!label) continue;
            expect(renderSlots(parseSlots(`${label.label} の`, 'en', 'title'), en.title)).toBe(`${label.label} の`);
            const romaji = label.romaji ?? label.label;
            expect(renderSlots(parseSlots(`${romaji} no`, 'en', 'romaji'), en.romaji)).toBe(`${romaji} no`);
        }
    });
});

describe('grammarSlots', () => {
    it("gives every slot Gokan's reviewed English label, and its romaji spelling where it differs", () => {
        const [noun, , , , iAdjective] = grammarSlots();
        expect(noun?.code).toBe('noun');
        expect(labelsOf(noun?.text, 'en')).toEqual(['Noun']);
        expect(labelsOf(iAdjective?.text, 'en', { field: 'romaji' })).toEqual(['i-Adjective']);
        expect(noun?.text.en?.renderings[0]).toMatchObject({ source: { source: 'gokan', ref: 'noun' }, status: 'reviewed', match: 'id' });
    });
});

describe('splitTitleName', () => {
    it('takes the side naming no slot as the name, on either side of the colon', () => {
        expect(splitTitleName('Polite past: {verb} ました')).toEqual({ name: 'Polite past', pattern: '{verb} ました' });
        expect(splitTitleName('て-form: {na-adjective} で')).toEqual({ name: 'て-form', pattern: '{na-adjective} で' });
        expect(splitTitleName('{i-adjective}: Negative Polite Form')).toEqual({ name: 'Negative Polite Form', pattern: '{i-adjective}' });
    });

    it('leaves a title without a colon, or with slots on both sides, whole', () => {
        expect(splitTitleName('{noun} にもまして')).toEqual({ pattern: '{noun} にもまして' });
        expect(splitTitleName('{a}: {b}')).toEqual({ pattern: '{a}: {b}' });
    });
});

describe('neutralTitle', () => {
    it('makes the core from the source and keeps nothing more where English renders it back', () => {
        expect(neutralTitle('A うが B うが', 'A uga B uga', 'en')).toEqual({ title: '{a} うが {b} うが', romaji: '{a} uga {b} uga' });
        expect(neutralTitle('Polite past: Verb ました', undefined, 'en')).toEqual({ title: '{verb} ました', name: 'Polite past' });
    });

    it("keeps the source's spelling where English would render the core differently", () => {
        expect(neutralTitle('い-Adjective: Negative Polite Form', undefined, 'en'))
            .toEqual({ title: '{i-adjective}', name: 'Negative Polite Form', ownTitle: 'い-Adjective: Negative Polite Form' });
        expect(neutralTitle('な-adjective に する/なる', undefined, 'en')).toEqual({ title: '{na-adjective} に する/なる', ownTitle: 'な-adjective に する/なる' });
        expect(neutralTitle('Verbる が早いか', 'verb-ru ga hayai ka', 'en'))
            .toEqual({ title: '{verb}る が早いか', romaji: '{verb}-ru ga hayai ka', ownRomaji: 'verb-ru ga hayai ka' });
    });
});

describe('titleIn and romajiIn', () => {
    const label = (field: string, value: string) => grammarLabel('grammar', 'n5-902', 'en', field, value, { source: 'gokan', ref: 'n5-902' });
    const text = (...labels: [string, string][]): TextByLanguage => ({ en: { renderings: labels.map(([f, v]) => label(f, v)) } });

    it('renders the core, the name first, as English writes it', () => {
        expect(titleIn({ title: '{verb} ました', text: text(['name', 'Polite past']) }, 'en', en)).toBe('Polite past: Verb ました');
        expect(titleIn({ title: '{noun} にもまして', text: {} }, 'en', en)).toBe('Noun にもまして');
        expect(romajiIn({ romaji: '{noun} ni mo mashite', text: {} }, 'en', en)).toBe('Noun ni mo mashite');
        expect(romajiIn({ text: {} }, 'en', en)).toBeUndefined();
    });

    it("prefers the source's own spelling where the point keeps one", () => {
        const kept = text(['name', 'Negative Polite Form'], ['title', 'い-Adjective: Negative Polite Form'], ['romaji', 'verb-ru']);
        expect(titleIn({ title: '{i-adjective}', text: kept }, 'en', en)).toBe('い-Adjective: Negative Polite Form');
        expect(romajiIn({ romaji: '{verb}-ru', text: kept }, 'en', en)).toBe('verb-ru');
    });

    it('gives nothing in a language without slot labels', () => {
        expect(titleIn({ title: '{noun} にもまして', text: {} }, 'fr', slotLabelsIn(grammarSlots(), 'fr'))).toBeUndefined();
    });
});
