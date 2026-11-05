import { describe, expect, it } from 'vitest';
import type { Definition, Equivalent, TextByLanguage } from '../models/text.model';
import { definitionsOf, equivalentsOf, rendering, withoutSources } from './renderings';

const definition = rendering<Definition>('vocab', '1', 'zh-hans', { role: 'definition', source: { source: 'zhwiktionary', ref: 'a#日語' }, match: 'spelling+reading', status: 'imported', senses: [{ glosses: ['信'] }] });
const equivalent = rendering<Equivalent>('vocab', '1', 'zh-hans', { role: 'equivalent', source: { source: 'wikidata', ref: 'L1' }, match: 'spelling+reading', status: 'imported', value: '书信' });
const english = rendering<Definition>('vocab', '1', 'en', { role: 'definition', source: { source: 'jmdict', ref: '1' }, match: 'id', status: 'imported', senses: [{ glosses: ['letter'] }] });

describe('accessors and a stage rebuilding its own text', () => {
    const text: TextByLanguage = { en: { renderings: [english], synonyms: [] }, 'zh-hans': { renderings: [definition, equivalent] } };

    it('reads definitions and equivalents by role', () => {
        expect(definitionsOf(text, 'zh-hans')).toEqual([definition]);
        expect(definitionsOf(text, 'zh-hans', 'jmdict')).toEqual([]);
        expect(equivalentsOf(text, 'zh-hans')).toEqual([equivalent]);
    });

    it("drops only the given sources' renderings, and a language left with nothing", () => {
        expect(withoutSources(text, new Set(['wikidata']))['zh-hans']?.renderings).toEqual([definition]);
        expect(withoutSources(text, new Set(['wikidata', 'zhwiktionary']))).toEqual({ en: { renderings: [english], synonyms: [] } });
        // A language holding derived data keeps it even with no rendering left.
        expect(withoutSources(text, new Set(['jmdict'])).en).toEqual({ renderings: [], synonyms: [] });
    });
});
