import { describe, expect, it } from 'vitest';
import type { Equivalent, Rendering } from '../models/text.model';
import { benchmarkWord, columnOf, floorProblems, floorsFrom, measure, reportMarkdown, type BenchmarkTotals } from './benchmark';
import { rendering } from './renderings';

const community = (source: string): string => ({ zhwiktionary: 'zh.wiktionary', jawiktionary: 'ja.wiktionary', wikidata: 'wikimedia', wikipedia: 'wikimedia' })[source] ?? source;
const equivalent = (source: string, ref: string, corroboratedBy?: { source: string; ref: string }): Rendering => rendering<Equivalent>('vocab', '1', 'zh-hans', {
    role: 'equivalent', source: { source, ref }, match: 'spelling', value: '信',
    ...(corroboratedBy ? { status: 'corroborated' as const, evidence: [corroboratedBy] } : { status: 'imported' as const }),
});
const totals: BenchmarkTotals = { poolSentences: 10, poolWithChinese: 2, translationScripts: { hans: 1, hant: 1, neutral: 0 }, kanji: 4, kanjiLabelled: 3, derivedValues: 5 };

describe('the benchmark', () => {
    it("tells Japanese Wiktionary's translation tables from its Chinese entries", () => {
        expect(columnOf({ source: 'jawiktionary', ref: '信#中国語' })).toBe('jawiktionary-reverse');
        expect(columnOf({ source: 'jawiktionary', ref: 'てがみ#日本語' })).toBe('jawiktionary-translations');
        expect(columnOf({ source: 'jmdict', ref: '1' })).toBeUndefined();
    });

    it('counts Wikipedia where it corroborates, as a community but not as a displayed source', () => {
        const word = benchmarkWord('N5', [equivalent('jawiktionary', '信#中国語', { source: 'wikipedia', ref: '手紙' })], community, 3, 1);
        expect([...word.covered].sort()).toEqual(['jawiktionary-reverse', 'wikipedia']);
        expect([...word.communities].sort()).toEqual(['ja.wiktionary', 'wikimedia']);
        const metrics = measure([word, benchmarkWord('N5', [], community, 0, 0)], totals);
        expect(metrics['coverage.N5.any']).toBe(50);
        expect(metrics['coverage.N5.communities2']).toBe(50);
        expect(metrics['coverage.N5.wikipedia']).toBe(50);
        expect(metrics['sentences.N5.chinese1']).toBe(50);
        expect(metrics['kanji.labelled']).toBe(75);
    });

    it('splits Chinese Wiktionary words into corroborated, contradicted and unchecked', () => {
        const words = [
            benchmarkWord('N4', [equivalent('zhwiktionary', 'a#日語', { source: 'wikidata', ref: 'L1' }), equivalent('wikidata', 'L1')], community, 0, 0),
            benchmarkWord('N4', [equivalent('zhwiktionary', 'b#日語'), equivalent('wikidata', 'L2')], community, 0, 0),
            benchmarkWord('N3', [equivalent('zhwiktionary', 'c#日語')], community, 0, 0),
            benchmarkWord('N1', [equivalent('zhwiktionary', 'd#日語')], community, 0, 0),
        ];
        const metrics = measure(words, totals);
        expect(metrics['zhwiktionary.N5-N3.words']).toBe(3);
        expect(metrics['zhwiktionary.N5-N3.corroborated']).toBe(33.3);
        expect(metrics['zhwiktionary.N5-N3.contradicted']).toBe(33.3);
        expect(metrics['zhwiktionary.N5-N3.unchecked']).toBe(33.3);
        expect(metrics['corroboration.zhwiktionary']).toBe(25);
    });

    it('still counts a corroborated text once a review has set its status', () => {
        const reviewed = { ...equivalent('zhwiktionary', 'a#日語', { source: 'wikidata', ref: 'L1' }), status: 'rejected' as const };
        expect([...benchmarkWord('N5', [reviewed], community, 0, 0).corroborated]).toEqual(['zhwiktionary']);
    });

    it('fails a number below its floor, and a floor nothing measures; sets floors a little below a run', () => {
        expect(floorProblems({ a: 70.2, b: 5 }, { a: 70, b: 6, c: 1 })).toEqual(['b: 5 is below its floor 6', 'c: has a floor (1) but the benchmark no longer measures it']);
        const floors = floorsFrom({ 'coverage.N5.any': 90.4, 'words.N5': 664, 'zhwiktionary.N5-N3.unchecked': 14, 'tatoeba.script.hans': 3 });
        expect(floors).toEqual({ 'coverage.N5.any': 89, 'words.N5': 650 });
    });

    it('writes a report with no date, the same for the same numbers', () => {
        const metrics = measure([benchmarkWord('N5', [], community, 0, 0)], totals);
        expect(reportMarkdown(metrics)).toBe(reportMarkdown({ ...metrics }));
        expect(reportMarkdown(metrics)).not.toMatch(/20\d\d-\d\d-\d\d/);
        expect(reportMarkdown({ ...metrics, 'tatoeba.poolSentences': 228767 })).toContain('228,767');
    });
});
