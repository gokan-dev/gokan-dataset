import { describe, it, expect } from 'vitest';
import { coarsePos, normalizeGloss, sharedGlosses, glossOverlap } from './build-synonyms';

describe('coarsePos', () => {
    it('maps JMdict POS codes to a major class', () => {
        expect(coarsePos(['v5u', 'vt'])).toBe('verb');
        expect(coarsePos(['v1'])).toBe('verb');
        expect(coarsePos(['adj-i'])).toBe('i-adj');
        expect(coarsePos(['adj-na'])).toBe('na-adj');
        expect(coarsePos(['adv'])).toBe('adv');
        expect(coarsePos(['adv-to'])).toBe('adv');
        expect(coarsePos(['n'])).toBe('noun');
        expect(coarsePos(['n-adv'])).toBe('noun');
    });

    it('returns null for classes not drilled as production (particles, interjections)', () => {
        expect(coarsePos(['int'])).toBeNull();
        expect(coarsePos(['prt'])).toBeNull();
        expect(coarsePos([])).toBeNull();
    });
});

describe('normalizeGloss', () => {
    it('strips a leading to/a/an/the, parentheticals, punctuation and case', () => {
        expect(normalizeGloss('to think')).toBe('think');
        expect(normalizeGloss('To Consider.')).toBe('consider');
        expect(normalizeGloss('the state')).toBe('state');
        expect(normalizeGloss('an appearance')).toBe('appearance');
        expect(normalizeGloss('State (of affairs)')).toBe('state');
        expect(normalizeGloss('look(s)')).toBe('look');
        expect(normalizeGloss('  power,  ')).toBe('power');
    });

    it('lets genuinely different senses stay different', () => {
        expect(normalizeGloss('always')).not.toBe(normalizeGloss('certainly'));
    });
});

describe('sharedGlosses', () => {
    it('counts the intersection', () => {
        expect(sharedGlosses(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBe(2);
        expect(sharedGlosses(new Set(['a']), new Set(['b']))).toBe(0);
    });
});

describe('glossOverlap (>=2 shared senses AND >=34% of the smaller set)', () => {
    it('clusters near-synonyms that share two or more senses', () => {
        // 思う vs 考える shape: heavy overlap.
        expect(glossOverlap(new Set(['think', 'consider', 'believe', 'reckon']), new Set(['think', 'consider']))).toBe(true);
        // the 状態/状況 nouns: share situation + circumstances.
        expect(glossOverlap(new Set(['state', 'condition', 'situation', 'circumstances']), new Set(['situation', 'circumstances', 'conditions']))).toBe(true);
    });

    it('rejects a single shared common sense (the noise case)', () => {
        // A big-gloss verb sharing only "leave" with a small word must NOT cluster.
        expect(glossOverlap(new Set(['leave', 'depart', 'go out', 'exit', 'quit', 'resign']), new Set(['leave', 'permission']))).toBe(false);
    });

    it('rejects two big words that share only two of many senses (ratio floor)', () => {
        const a = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
        const b = new Set(['a', 'b', 'x', 'y', 'z', 'w', 'v', 'u']);
        expect(sharedGlosses(a, b)).toBe(2);
        expect(glossOverlap(a, b)).toBe(false); // 2 / 8 = 0.25 < 0.34
    });

    it('rejects disjoint sense sets', () => {
        expect(glossOverlap(new Set(['always', 'constantly']), new Set(['certainly', 'surely']))).toBe(false);
    });
});
