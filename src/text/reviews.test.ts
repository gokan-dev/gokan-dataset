import { describe, expect, it } from 'vitest';
import type { Equivalent, Note, TextByLanguage } from '../models/text.model';
import { rendering, renderingId } from './renderings';
import {
    applyVerdicts, compiledVerdictProblems, emptyReviews, isReviewNote, noteRenderings, parseReviewFile, reviewFileKind, staleVerdicts, unknownWords, verdictIndex,
} from './reviews';
import { renderingProblems, type SourceInfo } from './validate';

const equivalent = (value: string, lang = 'zh-hans') => rendering<Equivalent>('vocab', '1352320', lang, {
    role: 'equivalent', source: { source: 'jawiktionary', ref: 'あげる#日本語' }, match: 'spelling+reading', status: 'imported', value,
});
const raise = equivalent('举');
const fry = equivalent('炸');
const by = { by: 'claude-opus-5-5', basis: 'ai-provisional', date: '2026-11-06', confidence: 'high' };
const verdictLine = (id: string, decision: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ rendering: id, entity: { kind: 'vocab', id: '1352320' }, decision, seen: 'imported', source: 'jawiktionary', value: '?', ...by, ...extra });

describe('review files', () => {
    it('tells verdicts, gold words and notes apart by name, and refuses any other file', () => {
        expect(reviewFileKind('zh-hans.jsonl')).toEqual({ kind: 'verdicts', lang: 'zh-hans' });
        expect(reviewFileKind('gold-zh-hans.jsonl')).toEqual({ kind: 'gold', lang: 'zh-hans' });
        expect(reviewFileKind('notes-zh-hant.jsonl')).toEqual({ kind: 'notes', lang: 'zh-hant' });
        expect(reviewFileKind('zh-Hans.jsonl')).toBeUndefined();
        expect(parseReviewFile('README.md', '', emptyReviews())).toEqual(['data/reviews/README.md: not a review file (<lang>.jsonl, gold-<lang>.jsonl or notes-<lang>.jsonl)']);
    });

    it('parses each line into a typed record, and names the file and line of every bad one', () => {
        const reviews = emptyReviews();
        const problems = parseReviewFile('zh-hans.jsonl', [
            verdictLine(raise.id, 'reviewed', { reason: 'the main sense' }),
            '',
            verdictLine(fry.id, 'maybe'),
            '{not json',
            verdictLine(fry.id, 'rejected', { entity: { kind: 'kanji', id: '揚' } }),
            verdictLine(fry.id, 'rejected', { date: '6 Nov' }),
        ].join('\n'), reviews);
        expect(reviews.verdicts).toEqual([{ lang: 'zh-hans', rendering: raise.id, entity: { kind: 'vocab', id: '1352320' }, decision: 'reviewed', reason: 'the main sense', seen: 'imported', source: 'jawiktionary', value: '?', ...by }]);
        expect(problems).toEqual([
            'data/reviews/zh-hans.jsonl:3: "decision" must be "reviewed" or "rejected"',
            'data/reviews/zh-hans.jsonl:4: not JSON',
            'data/reviews/zh-hans.jsonl:5: entity kind "kanji" is not reviewed yet: only "vocab" verdicts are applied',
            'data/reviews/zh-hans.jsonl:6: needs a YYYY-MM-DD "date"',
        ]);
    });

    it('parses gold words and notes, refusing an empty accept list and a note in another language', () => {
        const reviews = emptyReviews();
        const gold = { word: '1352320', headword: '上げる', reading: 'あげる', level: 'N5', senses: [{ sense: 'to raise', accept: ['举', '抬'] }], ...by };
        expect(parseReviewFile('gold-zh-hans.jsonl', [JSON.stringify(gold), JSON.stringify({ ...gold, senses: [{ sense: 'x', accept: [] }] }), JSON.stringify({ ...gold, level: 'N6' })].join('\n'), reviews)).toEqual([
            'data/reviews/gold-zh-hans.jsonl:2: sense "x": "accept" must be a non-empty list of words',
            'data/reviews/gold-zh-hans.jsonl:3: "level" must be one of N5, N4, N3, N2, N1',
        ]);
        expect(reviews.gold).toEqual([{ lang: 'zh-hans', ...gold }]);
        const note = { word: '1352320', headword: '上げる', lang: 'zh-hans', value: '注意', ...by };
        expect(parseReviewFile('notes-zh-hans.jsonl', [JSON.stringify(note), JSON.stringify({ ...note, lang: 'zh-hant' })].join('\n'), reviews)).toEqual(['data/reviews/notes-zh-hans.jsonl:2: "lang" must be the file\'s, zh-hans']);
        expect(reviews.notes).toHaveLength(1);
    });
});

describe('applying verdicts', () => {
    const reviews = emptyReviews();
    parseReviewFile('zh-hans.jsonl', [verdictLine(raise.id, 'reviewed'), verdictLine(fry.id, 'rejected')].join('\n'), reviews);
    const text: TextByLanguage = { 'zh-hans': { renderings: [raise, fry] }, 'zh-hant': { renderings: [equivalent('炸', 'zh-hant')] } };

    it("sets each named rendering's status and records who decided, keeping its id and everything else", () => {
        const { index, problems } = verdictIndex(reviews.verdicts);
        expect(problems).toEqual([]);
        const reviewed = applyVerdicts(text, 'vocab', '1352320', index);
        const review = { by: 'claude-opus-5-5', basis: 'ai-provisional', date: '2026-11-06' };
        expect(reviewed['zh-hans']?.renderings).toEqual([{ ...raise, status: 'reviewed', review }, { ...fry, status: 'rejected', review }]);
        // The zh-hant twin is another rendering (its id names its file): a zh-hans verdict does not touch it.
        expect(reviewed['zh-hant']).toEqual(text['zh-hant']);
        expect(text['zh-hans']?.renderings[1]?.status).toBe('imported');
        const sources = new Map<string, SourceInfo>([['jawiktionary', { id: 'jawiktionary', license: 'CC-BY-SA-4.0', languages: ['zh-hans'], roles: ['equivalent'] }]]);
        for (const r of reviewed['zh-hans']?.renderings ?? []) {
            expect(renderingProblems(r, 'vocab', '1352320', 'zh-hans', sources)).toEqual([]);
            const { id, ...rest } = r;
            expect(renderingId('vocab', '1352320', 'zh-hans', rest)).toBe(id);
        }
        expect(staleVerdicts(index)).toEqual([]);
        expect(index.statusChanged).toBe(0);
    });

    it('fails a verdict no rendering took, and a rendering judged twice', () => {
        const { index } = verdictIndex(reviews.verdicts);
        applyVerdicts({ 'zh-hans': { renderings: [raise] } }, 'vocab', '1352320', index);
        expect(staleVerdicts(index)).toEqual([`data/reviews/zh-hans.jsonl: no rendering ${fry.id} of vocab 1352320 in zh-hans ("?", jawiktionary); the source may have changed the text: review it again or remove the line`]);
        // A verdict naming another word's entity is not applied to this one.
        const other = verdictIndex(reviews.verdicts).index;
        applyVerdicts(text, 'vocab', '9999999', other);
        expect(staleVerdicts(other)).toHaveLength(2);
        const [first] = reviews.verdicts;
        expect(verdictIndex(first ? [first, first] : []).problems).toEqual([`data/reviews/zh-hans.jsonl: rendering ${raise.id} has two verdicts; keep one line`]);
    });

    it('counts a verdict on a text whose status has changed since it was reviewed', () => {
        const { index } = verdictIndex(reviews.verdicts);
        applyVerdicts({ 'zh-hans': { renderings: [{ ...raise, status: 'corroborated', evidence: [{ source: 'wikidata', ref: 'L1' }] }, fry] } }, 'vocab', '1352320', index);
        expect(index.statusChanged).toBe(1);
    });

    it('checks the compiled renderings against the verdicts', () => {
        const { index } = verdictIndex(reviews.verdicts);
        const compiled = applyVerdicts(text, 'vocab', '1352320', index)['zh-hans']?.renderings ?? [];
        const find = (id: string) => compiled.find(r => r.id === id);
        expect(compiledVerdictProblems(reviews.verdicts, v => find(v.rendering))).toEqual([]);
        expect(compiledVerdictProblems(reviews.verdicts, v => (v.rendering === fry.id ? fry : find(v.rendering)))).toEqual([
            `data/reviews/zh-hans.jsonl: rendering ${fry.id} of vocab 1352320 is imported, not rejected`,
            `data/reviews/zh-hans.jsonl: rendering ${fry.id} of vocab 1352320 does not record its review (claude-opus-5-5, ai-provisional, 2026-11-06)`,
        ]);
        expect(compiledVerdictProblems(reviews.verdicts, () => undefined)).toHaveLength(2);
    });
});

describe('gold words and notes', () => {
    const reviews = emptyReviews();
    parseReviewFile('gold-zh-hans.jsonl', JSON.stringify({ word: '1352320', headword: '上げる', reading: 'あげる', level: 'N5', senses: [{ sense: 'to raise', accept: ['举'] }], ...by }), reviews);
    parseReviewFile('notes-zh-hans.jsonl', [
        JSON.stringify({ word: '1352320', headword: '上げる', lang: 'zh-hans', value: '注意', ...by }),
        JSON.stringify({ word: '404', headword: '無い', lang: 'zh-hans', value: '注意', ...by }),
    ].join('\n'), reviews);

    it('fails a record naming a word that does not exist, or by a spelling it does not have', () => {
        expect(unknownWords(reviews, new Map([['1352320', { forms: ['上げる', 'あげる'] }]]))).toEqual(['data/reviews/notes-zh-hans.jsonl: word 404 (無い) does not exist']);
        expect(unknownWords(reviews, new Map([['1352320', { forms: ['挙げる'] }], ['404', { forms: ['無い'] }]]))).toEqual([
            'data/reviews/gold-zh-hans.jsonl: word 1352320 is not written 上げる (挙げる)',
            'data/reviews/notes-zh-hans.jsonl: word 1352320 is not written 上げる (挙げる)',
        ]);
    });

    it("makes each note an imported Gokan note of its word, recognised on the next run", () => {
        const notes = noteRenderings(reviews.notes);
        const [entry] = notes.get('1352320') ?? [];
        expect(entry?.lang).toBe('zh-hans');
        const [note] = entry?.renderings ?? [];
        const expected: Omit<Note, 'id'> = { role: 'note', source: { source: 'gokan' }, match: 'id', status: 'imported', value: '注意' };
        expect(note).toEqual(rendering<Note>('vocab', '1352320', 'zh-hans', expected));
        if (!note) throw new Error('no note');
        expect(isReviewNote(note, new Set(['zh-hans']), 'zh-hans')).toBe(true);
        expect(isReviewNote(note, new Set(['zh-hans']), 'en')).toBe(false);
        expect(isReviewNote(raise, new Set(['zh-hans']), 'zh-hans')).toBe(false);
    });
});
