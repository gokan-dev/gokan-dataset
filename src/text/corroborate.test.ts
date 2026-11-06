import { describe, expect, it } from 'vitest';
import { agree, agreeingTokens, agreementTokens, corroborations, type Claim } from './corroborate';
import { parseUnihanVariants } from './hanScript';

const variants = parseUnihanVariants([
    'U+96DC\tkSimplifiedVariant\tU+6742',
    'U+8A8C\tkSimplifiedVariant\tU+5FD7',
    'U+66F8\tkSimplifiedVariant\tU+4E66',
]);

describe('agreement, the benchmark rule', () => {
    it('compares in Simplified characters, item by item', () => {
        expect(agreementTokens(['雜誌，期刊（定期）'], variants)).toEqual(['杂志', '期刊']);
        expect(agree(['雜誌'], ['杂志'], variants)).toBe(true);
    });

    it('lets a one-character equivalent agree with an item it starts, and a longer one with an item holding it', () => {
        expect(agreeingTokens(['浅的'], ['浅'])).toEqual(['浅的', '浅']);
        expect(agreeingTokens(['运送'], ['送'])).toBeUndefined();
        expect(agreeingTokens(['忧心忡忡'], ['忧心'])).toEqual(['忧心忡忡', '忧心']);
    });
});

describe('corroborations', () => {
    const claim = (community: string, source: string, ref: string, texts: string[], language = 'zh'): Claim => ({ community, language, ref: { source, ref }, texts });

    it('takes evidence only from other communities, each source and ref once, sorted', () => {
        const evidence = corroborations([
            claim('zh.wiktionary', 'zhwiktionary', '手紙#日語', ['信，信件', '箋']),
            claim('ja.wiktionary', 'jawiktionary', 'てがみ#日本語', ['信']),
            claim('ja.wiktionary', 'jawiktionary', '信#中国語', ['信']),
            claim('wikimedia', 'wikidata', 'L626240', ['書信']),
            claim('wikimedia', 'wikipedia', '手紙', ['书信']),
        ], variants);
        expect(evidence[0]).toEqual([{ source: 'jawiktionary', ref: 'てがみ#日本語' }, { source: 'jawiktionary', ref: '信#中国語' }]);
        expect(evidence[1]).toEqual([{ source: 'zhwiktionary', ref: '手紙#日語' }]);
        // Wikidata and Wikipedia agree, but they are one community: neither corroborates the other.
        expect(evidence[3]).toEqual([]);
    });

    it('compares a language only with itself: Southern Min with Southern Min', () => {
        const evidence = corroborations([claim('ja.wiktionary', 'jawiktionary', '批#中国語', ['批'], 'nan'), claim('zh.wiktionary', 'zhwiktionary', 'x#日語', ['批'])], variants);
        expect(evidence).toEqual([[], []]);
    });
});
