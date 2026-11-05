import { describe, expect, it } from 'vitest';
import { parseLexemes, parseSitelinks, wikidataRecord } from './wikimedia';

describe('Wikidata lexemes', () => {
    it('narrows the snapshot, skipping what is not a lexeme', () => {
        const lexemes = parseLexemes([
            { id: 'L626240', lemmas: { 'ja-hira': 'てがみ', ja: '手紙' }, items: ['Q133492'], zh: ['書信', '书信'] },
            { id: 'L1', lemmas: 'broken', zh: [] },
            'not a lexeme',
        ]);
        expect(lexemes).toEqual([{ id: 'L626240', lemmas: { 'ja-hira': 'てがみ', ja: '手紙' }, zh: ['書信', '书信'] }]);
        expect(() => parseLexemes({})).toThrow(/expected a list/);
    });

    it('reads a lexeme by its kana lemmas, or its own lemma when it is kana', () => {
        const [letter] = parseLexemes([{ id: 'L626240', lemmas: { 'ja-hira': 'てがみ', ja: '手紙' }, zh: ['書信', '书信'] }]);
        expect(letter && wikidataRecord(letter)).toEqual({ ref: 'L626240', spelling: '手紙', readings: ['てがみ'], equivalents: ['書信', '书信'] });
        const [cup] = parseLexemes([{ id: 'L640712', lemmas: { ja: 'カップ' }, zh: ['杯'] }]);
        expect(cup && wikidataRecord(cup)?.readings).toEqual(['かっぷ']);
        const [none] = parseLexemes([{ id: 'L2', lemmas: { ja: '何' }, zh: [] }]);
        expect(none && wikidataRecord(none)).toBeUndefined();
    });
});

describe('Wikipedia sitelinks', () => {
    it('keeps linked articles, without disambiguation pages or a trailing qualifier', () => {
        const links = parseSitelinks({ 距離: { zh: '距离' }, 証拠: { zh: '證據 (法律)' }, 部: { zh: '部 (消歧義)', disambiguation: true }, 直ぐ: { missing: true }, 奴: {} });
        expect([...links]).toEqual([['距離', '距离'], ['証拠', '證據']]);
    });
});
