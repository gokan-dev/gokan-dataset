import { describe, expect, it } from 'vitest';
import type { Definition, Equivalent, Translation } from '../models/text.model';
import { chineseSentenceText, chineseWordText, searchGloss, serveStats, type WordInputs } from './chineseText';
import { parseUnihanVariants } from './hanScript';
import { renderingId } from './renderings';
import { renderingProblems, type SourceInfo } from './validate';

const variants = parseUnihanVariants([
    'U+7B8B\tkSimplifiedVariant\tU+7B3A',
    'U+66F8\tkSimplifiedVariant\tU+4E66',
    'U+4E66\tkTraditionalVariant\tU+66F8',
    'U+9918\tkSimplifiedVariant\tU+4F59 U+9980',
]);
const communities = new Map([['zhwiktionary', 'zh.wiktionary'], ['jawiktionary', 'ja.wiktionary'], ['wikidata', 'wikimedia'], ['wikipedia', 'wikimedia'], ['tatoeba-cmn', 'tatoeba']]);
const sources = new Map<string, SourceInfo>([
    ['zhwiktionary', { id: 'zhwiktionary', license: 'CC-BY-SA-4.0', languages: ['zh', 'zh-hans', 'zh-hant'], roles: ['definition'] }],
    ['jawiktionary', { id: 'jawiktionary', license: 'CC-BY-SA-4.0', languages: ['zh', 'zh-hans', 'zh-hant', 'nan'], roles: ['equivalent'] }],
    ['wikidata', { id: 'wikidata', license: 'CC0-1.0', languages: ['zh', 'zh-hans', 'zh-hant'], roles: ['equivalent'] }],
    ['wikipedia', { id: 'wikipedia', license: 'CC-BY-SA-4.0', languages: ['zh', 'zh-hans', 'zh-hant'], roles: [] }],
    ['tatoeba-cmn', { id: 'tatoeba-cmn', license: 'LicenseRef-Tatoeba', languages: ['zh', 'zh-hans', 'zh-hant'], roles: ['translation'] }],
]);

const letter: WordInputs = {
    definitions: [{ source: 'zhwiktionary', ref: '手紙#日語', match: 'spelling+reading', senses: [{ glosses: ['信，信件'], tags: [], pos: 'noun' }, { glosses: ['箋'], tags: ['archaic'], pos: 'noun' }] }],
    equivalents: [
        { source: 'jawiktionary', ref: 'てがみ#日本語', match: 'spelling+reading', value: '信', lang: 'zh' },
        { source: 'jawiktionary', ref: '书信#中国語', match: 'spelling', value: '書信', lang: 'zh' },
        { source: 'jawiktionary', ref: '书信#中国語', match: 'spelling', value: '书信', lang: 'zh' },
        { source: 'jawiktionary', ref: '批#中国語', match: 'spelling', value: '批', lang: 'nan' },
    ],
    checks: [{ source: 'wikipedia', ref: '手紙', text: '书信' }],
};

describe("a word's Chinese text", () => {
    const stats = serveStats();
    const text = chineseWordText('1327720', letter, communities, variants, stats);

    it('keeps each source its own rendering, corroborated by the other communities only', () => {
        const [definition] = text['zh-hant']?.renderings.filter((r): r is Definition => r.role === 'definition') ?? [];
        expect(definition?.status).toBe('corroborated');
        expect(definition?.evidence).toEqual([{ source: 'jawiktionary', ref: 'てがみ#日本語' }]);
        expect(definition?.senses[1]).toEqual({ glosses: ['箋'], pos: ['noun'], tags: ['archaic'] });
    });

    it('converts Traditional for zh-hans and keeps one equivalent where both scripts give the same', () => {
        const hans = text['zh-hans']?.renderings ?? [];
        const definition = hans.find((r): r is Definition => r.role === 'definition');
        expect(definition?.senses[1]?.glosses).toEqual([{ value: '笺', derivedFrom: { value: '箋', lang: 'zh-hant', transform: 'script:hant-to-hans' } }]);
        const shuxin = hans.filter((r): r is Equivalent => r.role === 'equivalent' && r.source.ref === '书信#中国語');
        expect(shuxin.map(r => r.value)).toEqual(['书信']);
        // Wikipedia corroborates, but is never shown.
        expect(shuxin[0]?.evidence).toEqual([{ source: 'wikipedia', ref: '手紙' }]);
        expect(Object.values(text).flatMap(e => e.renderings).some(r => r.source.source === 'wikipedia')).toBe(false);
        expect(stats.converted).toBeGreaterThan(0);
    });

    it('files Southern Min under nan and a text the same in both scripts under both, tagged zh', () => {
        expect(text.nan?.renderings.map(r => r.role === 'equivalent' && r.value)).toEqual(['批']);
        const xin = (lang: string) => text[lang]?.renderings.find((r): r is Equivalent => r.role === 'equivalent' && r.value === '信');
        expect(xin('zh-hans')?.lang).toBe('zh');
        expect(xin('zh-hant')?.lang).toBe('zh');
    });

    it('makes renderings the text checks accept', () => {
        for (const [lang, entity] of Object.entries(text)) for (const r of entity.renderings) expect(renderingProblems(r, 'vocab', '1327720', lang, sources)).toEqual([]);
    });

    it("gives a search gloss per language from the corroborated equivalents first", () => {
        expect(searchGloss(text, 'zh-hans')).toBe('信，书信');
        expect(searchGloss(text, 'nan')).toBe('批');
        expect(searchGloss({}, 'zh-hans')).toBeUndefined();
    });
});

describe("a sentence's Chinese translations", () => {
    it('records the direction and serves each translation by its script', () => {
        const stats = serveStats();
        const text = chineseSentenceText('74', 'tatoeba-cmn', [{ ref: '9', text: '書', direction: 'fromJapanese' }, { ref: '10', text: '餘', direction: 'toJapanese' }], variants, stats);
        const hans = text['zh-hans']?.renderings.filter((r): r is Translation => r.role === 'translation') ?? [];
        expect(hans.map(r => [r.source.ref, r.direction])).toEqual([['9', 'fromJapanese']]);
        expect(text['zh-hant']?.renderings.map(r => r.source.ref)).toEqual(['9', '10']);
        expect(stats.unconvertible).toBe(1);
        const first = hans[0];
        if (!first) throw new Error('no translation');
        const { id, ...rest } = first;
        expect(id).toBe(renderingId('sentence', '74', 'zh-hans', rest));
    });
});
