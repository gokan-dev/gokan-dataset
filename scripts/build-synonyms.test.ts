import { describe, it, expect } from 'vitest';
import { coarsePosSet, sharesPos, normalizeGloss, sharedGlosses, glossOverlap, senseCovered } from './build-synonyms';

const S = (...xs: string[]) => new Set(xs);

describe('coarsePosSet', () => {
    it('maps JMdict POS codes to major classes', () => {
        expect([...coarsePosSet(['v5u', 'vt'])]).toEqual(['verb']);
        expect([...coarsePosSet(['adj-i'])]).toEqual(['i-adj']);
        expect([...coarsePosSet(['adj-na'])]).toEqual(['na-adj']);
        expect([...coarsePosSet(['adv-to'])]).toEqual(['adv']);
        expect([...coarsePosSet(['n-adv'])]).toEqual(['noun']);
    });

    it('keeps EVERY class a word carries, not just the first recognised one', () => {
        // The 一番 / 最高 defect: both are noun+adjectival, but JMdict lists their
        // codes in a different order, so returning the first match made one a
        // noun and the other a na-adj and they never reached the gloss check.
        expect(coarsePosSet(['n', 'adj-no', 'adv'])).toEqual(S('noun', 'adv'));
        expect(coarsePosSet(['adj-no', 'adj-na', 'n'])).toEqual(S('na-adj', 'noun'));
        expect(sharesPos(coarsePosSet(['n', 'adj-no', 'adv']), coarsePosSet(['adj-no', 'adj-na', 'n']))).toBe(true);
    });

    it('is empty for classes not drilled as production (particles, interjections)', () => {
        expect(coarsePosSet(['int']).size).toBe(0);
        expect(coarsePosSet(['prt']).size).toBe(0);
        expect(coarsePosSet([]).size).toBe(0);
    });

    it('sharesPos needs an actual intersection', () => {
        expect(sharesPos(S('noun'), S('verb'))).toBe(false);
        expect(sharesPos(S(), S('noun'))).toBe(false);
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

describe('glossOverlap (>=1 shared sense AND >=34% of the smaller set)', () => {
    it('clusters near-synonyms that share two or more senses', () => {
        // 思う vs 考える shape: heavy overlap.
        expect(glossOverlap(new Set(['think', 'consider', 'believe', 'reckon']), new Set(['think', 'consider']))).toBe(true);
        // the 状態/状況 nouns: share situation + circumstances.
        expect(glossOverlap(new Set(['state', 'condition', 'situation', 'circumstances']), new Set(['situation', 'circumstances', 'conditions']))).toBe(true);
    });

    it('now clusters a single shared sense when it clears the ratio floor (the leniency)', () => {
        // 強い/丈夫 shape: they share "strong"/"solid"/"durable"/"healthy" once POS
        // is ignored - a genuine near-synonym the gloss cue cannot exclude.
        expect(glossOverlap(new Set(['strong', 'potent']), new Set(['healthy', 'robust', 'strong', 'solid', 'durable']))).toBe(true);
        // 必ず/常に share just "always" - previously needed a hand-added entry.
        expect(glossOverlap(new Set(['certainly', 'surely', 'always']), new Set(['always', 'constantly']))).toBe(true);
    });

    it('still rejects a lone shared token that is a small fraction of the smaller set (ratio floor is the noise gate now)', () => {
        // A word whose senses are {leave, permission, allowance} shares only "leave"
        // with a big verb: 1 / 3 = 0.33 < 0.34, so it stays unclustered.
        expect(glossOverlap(new Set(['leave', 'depart', 'go out', 'exit', 'quit', 'resign']), new Set(['leave', 'permission', 'allowance']))).toBe(false);
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

describe('senseCovered (a whole sense expressible by the other word)', () => {
    // The real shape: 一番 has six senses and 18 glosses, one of which is
    // exactly {best, most}; 最高 carries both across its own two senses. The
    // flattened ratio scores 2/min(18,8) = 0.25 and rejects them.
    const ichiban = [S('number one', 'first', 'first place'), S('best', 'most'), S('game', 'round', 'bout')];
    const saikou = S('best', 'supreme', 'wonderful', 'finest', 'highest', 'maximum', 'most', 'uppermost');

    it('catches a sense wholly contained in the other word', () => {
        expect(senseCovered(ichiban, saikou)).toBe(true);
        expect(glossOverlap(new Set(ichiban.flatMap(s => [...s])), saikou)).toBe(false); // what it rescues
    });

    it('needs the WHOLE sense, not most of it', () => {
        expect(senseCovered([S('best', 'cheapest')], saikou)).toBe(false);
    });

    it('ignores single-gloss senses, which match by coincidence', () => {
        expect(senseCovered([S('best')], saikou)).toBe(false);
    });

    it('refuses a covering word polysemous enough to cover anything', () => {
        // 取る carries 54 glosses and would otherwise absorb most of the verb index.
        const huge = new Set(Array.from({ length: 20 }, (_, i) => `g${i}`).concat(['best', 'most']));
        expect(senseCovered(ichiban, huge)).toBe(false);
    });
});
