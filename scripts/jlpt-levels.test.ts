import { describe, it, expect } from 'vitest';
import { parseCsv, resolveJlptLevels, ukRivalsOf, type JlptCorrections, type JmdictWordLike, type WallerDeckRow, type WallerIdRow } from './jlpt-levels';

function word(id: string, kanji: string[], kana: string[], opts: { uk?: boolean; uncommonKana?: boolean; kanjiTags?: string[] } = {}): JmdictWordLike {
    return {
        id,
        kanji: kanji.map(text => ({ text, tags: opts.kanjiTags ?? [] })),
        kana: kana.map(text => ({ text, common: !opts.uncommonKana, tags: [], appliesToKanji: ['*'] })),
        sense: [{ misc: opts.uk ? ['uk'] : [] }],
    };
}

const dict = (...words: JmdictWordLike[]) => new Map(words.map(w => [w.id, w]));
const none = (): JlptCorrections => ({ remap: {}, levels: {}, keep: {}, derivedExclude: {} });
const row = (id: string, kana: string, kanji: string, level: number): WallerIdRow => ({ id, kana, kanji, level });
const deck = (expression: string, reading: string, level: number, tags: string[] = []): WallerDeckRow => ({ expression, reading, level, tags });

describe('parseCsv', () => {
    it('skips the header and keeps commas inside quotes', () => {
        expect(parseCsv('a,b,c\r\n1,"x, y",z\n\n2,,w\n')).toEqual([['1', 'x, y', 'z'], ['2', '', 'w']]);
    });
});

describe('resolveJlptLevels', () => {
    it('levels the id list by id and keeps the easiest of several listings', () => {
        const words = dict(word('1', ['終わる'], ['おわる']), word('2', ['終わる'], ['おわる']));
        const { levels } = resolveJlptLevels(words, [row('1', 'おわる', '終わる', 1), row('1', 'おわる', '終る', 5)], [], none());
        expect(levels.get('1')).toEqual({ level: 5, source: 'list' });
        // The other entry spelled the same gets nothing: the level is on an id, not a spelling.
        expect(levels.has('2')).toBe(false);
    });

    it('fills from the decks only on an exact spelling and reading, and never moves a listed level', () => {
        const words = dict(word('10', ['顔'], ['かお']), word('11', ['助かる'], ['たすかる']), word('12', ['顔'], ['がん']));
        const { levels, unmatchedDeckRows } = resolveJlptLevels(
            words,
            [row('11', 'たすかる', '助かる', 2)],
            [deck('顔', 'かお', 5), deck('助かる', 'たすかる', 3), deck('式', 'しき', 3)],
            none(),
        );
        expect(levels.get('10')).toEqual({ level: 5, source: 'deck' });
        expect(levels.has('12')).toBe(false);
        expect(levels.get('11')).toEqual({ level: 2, source: 'list' });
        expect(unmatchedDeckRows.map(r => r.expression)).toEqual(['式']);
    });

    it('gives a kana deck row to the one word usually written in kana whose common spelling it is', () => {
        const words = dict(
            word('20', ['無い'], ['ない'], { uk: true }),
            word('21', ['亡い'], ['ない'], { uk: true, uncommonKana: true }),
            word('22', ['野老'], ['ところ'], { uk: true, uncommonKana: true }),
        );
        const { levels } = resolveJlptLevels(words, [], [deck('ない', 'ない', 5), deck('ところ', 'ところ', 5)], none());
        expect(levels.get('20')).toEqual({ level: 5, source: 'deck-kana' });
        expect(levels.has('21')).toBe(false);
        expect(levels.has('22')).toBe(false);
    });

    it('lets an N5/N4 kana deck row make a listed word easier, never an N3 one', () => {
        const words = dict(word('50', ['丈'], ['だけ'], { uk: true }), word('51', ['纏める'], ['まとめる'], { uk: true }));
        const { levels } = resolveJlptLevels(
            words,
            [row('50', 'だけ', '丈', 1), row('51', 'まとめる', '纏める', 2)],
            [deck('～だけ', '～だけ', 5), deck('まとめる', 'まとめる', 3)],
            none(),
        );
        expect(levels.get('50')).toEqual({ level: 5, source: 'deck-kana' });
        expect(levels.get('51')).toEqual({ level: 2, source: 'list' });
    });

    it('applies remaps and hand-set levels', () => {
        const words = dict(word('30', [], ['これ']), word('31', ['此れ'], ['これ'], { uk: true, kanjiTags: ['rK'] }), word('32', ['乃'], ['の'], { uk: true }));
        const corrections: JlptCorrections = { ...none(), remap: { 30: { to: '31', key: 'これ', why: '' } }, levels: { 32: { level: 5, word: 'の', why: '' } } };
        const { levels } = resolveJlptLevels(words, [row('30', 'これ', '', 5), row('31', 'これ', '此れ', 1)], [], corrections);
        expect(levels.get('31')).toEqual({ level: 5, source: 'list' });
        expect(levels.has('30')).toBe(false);
        expect(levels.get('32')).toEqual({ level: 5, source: 'override' });
    });

    it('fails on a kana row sent past a likelier word, until a remap or keep settles it', () => {
        const words = dict(word('30', [], ['これ']), word('31', ['此れ'], ['これ'], { uk: true }));
        const rows = [row('30', 'これ', '', 5), row('31', 'これ', '此れ', 1)];
        expect(() => resolveJlptLevels(words, rows, [], none())).toThrow(/need a remap or keep/);
        expect(() => resolveJlptLevels(words, rows, [], { ...none(), keep: { 30: { key: 'これ', why: '' } } })).not.toThrow();
    });

    it('rejects corrections that no longer match the data', () => {
        const words = dict(word('30', [], ['これ']), word('31', ['此れ'], ['これ']));
        const rows = [row('30', 'これ', '', 5)];
        expect(() => resolveJlptLevels(words, rows, [], { ...none(), remap: { 99: { to: '31', key: 'これ', why: '' } } })).toThrow(/not a row/);
        expect(() => resolveJlptLevels(words, rows, [], { ...none(), remap: { 30: { to: '99', key: 'これ', why: '' } } })).toThrow(/not a JMdict entry/);
        expect(() => resolveJlptLevels(words, [row('77', 'x', '', 5)], [], none())).toThrow(/not in this JMdict/);
    });

    it('skips id-list rows without an id, and collects textbook lessons per entry', () => {
        const words = dict(word('40', ['顔'], ['かお']), word('41', ['此れ'], ['これ'], { uk: true }));
        const { textbooks, unidentifiedListRows } = resolveJlptLevels(
            words,
            [row('', 'い', '依', 1), row('41', 'これ', '', 5)],
            [deck('顔', 'かお', 5, ['Genki', 'Genki_Ln.10', 'Intermediate_Japanese_Ln.2']), deck('これ', 'これ', 5, ['Genki_Ln.2'])],
            { ...none(), keep: {} },
        );
        expect(unidentifiedListRows).toHaveLength(1);
        expect(textbooks.get('40')).toEqual([{ book: 'genki', lesson: 10 }, { book: 'intermediate-japanese', lesson: 2 }]);
        expect(textbooks.get('41')).toEqual([{ book: 'genki', lesson: 2 }]);
    });
});

describe('ukRivalsOf', () => {
    it('reports a kana row on an entry without kanji while a kana-usual word with kanji sits harder', () => {
        const words = dict(word('1', [], ['あれ']), word('2', ['彼'], ['あれ'], { uk: true }), word('3', [], ['いい']));
        const hits = ukRivalsOf([row('1', 'あれ', '', 5), row('3', 'いい', '', 5)], words, new Map(), { remap: {}, keep: {} });
        expect(hits).toEqual([{ row: row('1', 'あれ', '', 5), rivals: ['2'] }]);
    });
});
