import { describe, expect, it } from 'vitest';
import type { GrammarContrastIndex, GrammarExample, GrammarPoint } from '../models/grammar.model';
import { contrastCaseId, grammarExampleId, grammarLabel, grammarProse, grammarTranslation } from '../text/grammarText';
import { GRAMMAR_HOLDERS, joinText, splitText, type HolderSpec } from './textHolders';

const specOf = (path: string): HolderSpec => {
    const spec = GRAMMAR_HOLDERS.find(s => s.path === path);
    if (!spec) throw new Error(`no spec for ${path}`);
    return spec;
};
const hanabira = { source: 'hanabira', ref: 'n5-001' };

const example = (jp: string, en?: string): GrammarExample => ({
    jp, romaji: '', words: [{ surface: jp, vocabId: null }], patternWordIndices: [0],
    text: en ? { en: { renderings: [grammarTranslation('grammar', grammarExampleId('n5-001', jp), 'en', en, hanabira)] } } : {},
});

const point = (): GrammarPoint => ({
    id: 'n5-001', title: '{a} が いちばん～', jlptLevel: 5, kind: 'construction',
    examples: [example('一。', 'One.'), example('二。')],
    text: {
        en: { renderings: [grammarProse('grammar', 'n5-001', 'en', 'formation', 'Noun + が', hanabira)] },
        fr: { renderings: [grammarProse('grammar', 'n5-001', 'fr', 'formation', 'Nom + が', hanabira)] },
    },
});

describe('splitText and joinText', () => {
    it("takes a point's and its examples' text out, keyed by id, and puts it back exactly", () => {
        const assembled = point();
        const core = point();
        const byLang = splitText(core, specOf('grammar/points'), 'n5-001');

        expect(core).not.toHaveProperty('text');
        expect(core.examples[0]).not.toHaveProperty('text');
        expect(Object.keys(byLang).sort()).toEqual(['en', 'fr']);
        // An example without text in a language is left out of that language's file.
        expect(Object.keys(byLang.en ?? {})).toEqual(['n5-001', grammarExampleId('n5-001', '一。')]);
        expect(Object.keys(byLang.fr ?? {})).toEqual(['n5-001']);

        joinText(core, specOf('grammar/points'), 'n5-001', byLang);
        expect(core).toStrictEqual(assembled);
    });

    it("keys a mined example by the point its file is named after", () => {
        const examples = [example('一。', 'One.')];
        const byLang = splitText(examples, specOf('grammar/mined'), 'n5-001');
        expect(Object.keys(byLang.en ?? {})).toEqual([grammarExampleId('n5-001', '一。')]);
    });

    it("keys a family's cases under the family, by what each contrasts", () => {
        const gokan = { source: 'gokan', ref: 'causality' };
        const contrasts: GrammarContrastIndex = {
            causality: {
                lessons: [{ id: 'core', title: 'から / ので', points: ['a', 'b'], cases: [{ focus: 'b', vs: ['a'], text: { en: { renderings: [grammarProse('family', 'x', 'en', 'situation', 'S.', gokan)] } } }] }],
                text: { en: { renderings: [grammarLabel('family', 'causality', 'en', 'family', 'Causality', gokan)] } },
            },
        };
        const expected = structuredClone(contrasts);
        const byLang = splitText(contrasts, specOf('grammar/index/contrasts.json'), 'contrasts');
        expect(Object.keys(byLang.en ?? {})).toEqual(['causality', contrastCaseId('causality', 'core', 'b', ['a'])]);
        joinText(contrasts, specOf('grammar/index/contrasts.json'), 'contrasts', byLang);
        expect(contrasts).toStrictEqual(expected);
    });

    it('refuses two entities with one id, whose text could not be told apart', () => {
        const twice = { ...point(), examples: [example('一。', 'One.'), example('一。', 'Uno.')] };
        expect(() => splitText(twice, specOf('grammar/points'), 'n5-001')).toThrow(/share the id/);
    });
});
