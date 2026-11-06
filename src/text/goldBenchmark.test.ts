import { describe, expect, it } from 'vitest';
import type { Definition, Equivalent, Rendering, TextStatus } from '../models/text.model';
import { floorsFrom, reportMarkdown } from './benchmark';
import { goldReportLines, measureGold, ruleShows, type TextTally } from './goldBenchmark';
import { parseUnihanVariants } from './hanScript';
import { rendering } from './renderings';
import type { GoldWord, Verdict } from './reviews';

const variants = parseUnihanVariants(['U+8CE3\tkSimplifiedVariant\tU+5356']);
const provenance = { by: 'claude-opus-5-5', basis: 'ai-provisional', date: '2026-11-06', confidence: 'high' as const };
const equivalent = (word: string, source: string, value: string, status: TextStatus): Equivalent =>
    rendering<Equivalent>('vocab', word, 'zh-hans', { role: 'equivalent', source: { source, ref: value }, match: 'spelling', status, value });

// 売る (A, N5): 卖 from Japanese Wiktionary, 出卖 from Wikidata, both accepted. 上げる (B, N4): 炸 rejected, a corroborated definition accepted.
const sell = equivalent('A', 'jawiktionary', '賣', 'reviewed');
const betray = equivalent('A', 'wikidata', '出卖', 'reviewed');
const fry = equivalent('B', 'jawiktionary', '炸', 'rejected');
const raise = rendering<Definition>('vocab', 'B', 'zh-hans', {
    role: 'definition', source: { source: 'zhwiktionary', ref: 'あげる#日語' }, match: 'spelling+reading', status: 'reviewed', evidence: [{ source: 'wikidata', ref: 'L1' }], senses: [{ glosses: ['举起'] }],
});
const verdict = (word: string, r: Rendering, seen: TextStatus): Verdict => ({
    lang: 'zh-hans', rendering: r.id, entity: { kind: 'vocab', id: word }, decision: r.status === 'rejected' ? 'rejected' : 'reviewed', seen, source: r.source.source, value: '', ...provenance,
});
const gold: GoldWord[] = [
    { lang: 'zh-hans', word: 'A', headword: '売る', reading: 'うる', level: 'N5', senses: [{ sense: 'to sell', accept: ['卖'] }, { sense: 'to betray', accept: ['出卖'] }], ...provenance },
    { lang: 'zh-hans', word: 'B', headword: '上げる', reading: 'あげる', level: 'N4', senses: [{ sense: 'to raise', accept: ['举'] }], ...provenance },
];
const tally = (source: string, status: TextStatus): TextTally => ({ source, status });
const metrics = measureGold({
    gold,
    verdicts: [verdict('A', sell, 'imported'), verdict('A', betray, 'imported'), verdict('B', fry, 'imported'), verdict('B', raise, 'corroborated')],
    renderingsOf: new Map([['A', [sell, betray].map(rendering => ({ lang: 'zh-hans', rendering }))], ['B', [fry, raise].map(rendering => ({ lang: 'zh-hans', rendering }))]]),
    allWords: new Map([['zh-hans', [
        [tally('jawiktionary', 'reviewed'), tally('wikidata', 'reviewed')],
        [tally('jawiktionary', 'rejected'), tally('zhwiktionary', 'reviewed')],
        [tally('wikidata', 'imported')],
        [tally('gokan', 'imported')],
        [tally('jawiktionary', 'imported')],
    ]]]),
    variants,
});

describe("the gold set's measures", () => {
    it('scores the texts by the status they had before review, per level and per source', () => {
        expect(metrics['gold.zh-hans.N5.precision.imported']).toBe(100);
        expect(metrics['gold.zh-hans.N4.precision.imported']).toBe(0);
        expect(metrics['gold.zh-hans.N4.precision.corroborated']).toBe(100);
        expect(metrics['gold.zh-hans.all.precision.imported']).toBe(66.7);
        expect(metrics['gold.zh-hans.all.verdicts.imported']).toBe(3);
        expect(metrics['gold.zh-hans.all.precision.jawiktionary.imported']).toBe(50);
        expect(metrics['gold.zh-hans.all.precision.wikidata.imported']).toBe(100);
        expect(metrics['gold.zh-hans.all.verdicts.zhwiktionary.corroborated']).toBe(1);
        expect(metrics['gold.zh-hant.all.verdicts.imported']).toBe(0);
    });

    it('covers a gold sense when a text not rejected agrees with an accepted word, in Simplified', () => {
        // 賣 is 卖 once Simplified; 举起 starts with 举.
        expect(metrics['gold.zh-hans.all.senses']).toBe(3);
        expect(metrics['gold.zh-hans.all.coverage']).toBe(100);
        expect(metrics['gold.zh-hans.N5.coverage']).toBe(100);
        expect(metrics['gold.zh-hans.all.rejectedWords']).toBe(50);
        expect(metrics['gold.zh-hans.N5.rejectedWords']).toBe(0);
        expect(metrics['gold.zh-hans.N4.rejectedWords']).toBe(100);
    });

    it('measures each acceptance rule: texts shown now, precision and coverage before review', () => {
        expect(metrics['rules.zh-hans.texts']).toBe(7);
        expect(metrics['rules.zh-hans.B.admits.wikidata']).toBe(1);
        expect(metrics['rules.zh-hans.B.admits.jawiktionary']).toBeUndefined();
        expect([metrics['rules.zh-hans.A.texts'], metrics['rules.zh-hans.B.texts'], metrics['rules.zh-hans.C.texts']]).toEqual([3, 4, 6]);
        expect([metrics['rules.zh-hans.A.words'], metrics['rules.zh-hans.B.words'], metrics['rules.zh-hans.C.words']]).toEqual([2, 3, 5]);
        expect([metrics['rules.zh-hans.A.precision'], metrics['rules.zh-hans.B.precision'], metrics['rules.zh-hans.C.precision']]).toEqual([100, 100, 75]);
        expect([metrics['rules.zh-hans.A.goldCoverage'], metrics['rules.zh-hans.B.goldCoverage'], metrics['rules.zh-hans.C.goldCoverage']]).toEqual([33.3, 66.7, 100]);
        expect(ruleShows('C', 'rejected', 'x', new Set())).toBe(false);
        expect(ruleShows('B', 'imported', 'x', new Set(['x']))).toBe(true);
        expect(ruleShows('A', 'imported', 'x', new Set(['x']))).toBe(false);
    });

    it('guards precision, coverage and rejections with floors, never the counts or the rule candidates', () => {
        const floors = floorsFrom(metrics);
        expect(floors['gold.zh-hans.all.precision.imported']).toBe(65);
        expect(floors['gold.zh-hans.all.coverage']).toBe(99);
        expect(floors['gold.zh-hans.N4.rejectedWords']).toBe(99);
        expect(Object.keys(floors).filter(k => k.startsWith('rules.') || /\.(verdicts|senses|words)(\.|$)/.test(k))).toEqual([]);
    });

    it('reports the gold set and the rule candidates, and nothing without a gold set', () => {
        const report = goldReportLines(metrics).join('\n');
        expect(report).toContain('## Acceptance rule candidates');
        expect(report).toContain('Rule B admits `wikidata`');
        expect(report).toContain('| N4 | 100.0% of 1 | 0.0% of 1 | none | none |');
        expect(goldReportLines({})).toEqual([]);
        expect(reportMarkdown(metrics)).toContain('## Gold set');
    });
});
