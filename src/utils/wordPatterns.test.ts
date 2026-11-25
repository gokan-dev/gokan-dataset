import { beforeAll, describe, expect, it } from 'vitest';
import kuromoji from 'kuromoji';
import { patternCandidates, patternKind, patternText, selectPatterns, type Occurrence, type PatternKind, type PatternPart, type PatternUse } from './wordPatterns';

let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures>;

beforeAll(async () => {
    tokenizer = await new Promise((resolve, reject) => {
        kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => (err ? reject(err) : resolve(t)));
    });
});

const HEADWORDS: Record<string, string> = { fushigi: '不思議', omou: '思う', toshi: '年', toru: '取る', hito: '人', watashi: '私', miru: '見る', hayai: '早い', naru: 'なる', ki: '気', suru: 'する' };
const text = (parts: readonly PatternPart[]): string => patternText(parts, id => HEADWORDS[id]);

/** The candidates of a word in `sentence`, written out; each word is [id, its spelling there]. */
function candidates(sentence: string, [word, spelling]: [string, string], kind: PatternKind, others: [string, string][] = []): string[] {
    const span = (id: string, written: string): Occurrence => {
        const start = sentence.indexOf(written);
        if (start < 0) throw new Error(`${written} not in ${sentence}`);
        return { id, start, length: written.length };
    };
    const at = span(word, spelling);
    const spans = [at, ...others.map(([id, written]) => span(id, written))];
    return patternCandidates(tokenizer.tokenize(sentence), at, kind, spans).map(text);
}

describe('patternKind', () => {
    it('reads a verb by its class, a suru noun as a noun', () => {
        expect(patternKind(['v5r', 'vt'])).toBe('verb');
        expect(patternKind(['n', 'vs', 'vt'])).toBe('other');
        expect(patternKind(['adj-i'])).toBe('i-adjective');
        expect(patternKind(['adj-na', 'n', 'adv-to'])).toBe('na-adjective');
    });
});

describe('patternCandidates', () => {
    it('follows a na-adjective through a particle to its verb, shortest first', () => {
        expect(candidates('それを不思議に思った。', ['fushigi', '不思議'], 'na-adjective', [['omou', '思っ']])).toEqual(['不思議に', '不思議に思う']);
    });

    it('writes the attributive copula as な〜, and folds the past into the dictionary form', () => {
        expect(candidates('不思議な話だ。', ['fushigi', '不思議'], 'na-adjective')).toEqual(['不思議な〜']);
        expect(candidates('不思議だった。', ['fushigi', '不思議'], 'na-adjective')).toEqual(['不思議だ']);
    });

    it('keeps a negation whole (ではない), never ending on a bare は', () => {
        expect(candidates('不思議ではない。', ['fushigi', '不思議'], 'na-adjective')).toEqual(['不思議ではない']);
    });

    it('gives a plain noun no copula pattern (人だ says nothing)', () => {
        expect(candidates('あれは人だ。', ['hito', '人'], 'other')).toEqual([]);
    });

    it('reads a verb by the noun and particle before it', () => {
        expect(candidates('年を取った。', ['toru', '取った'], 'verb', [['toshi', '年']])).toEqual(['年を取る']);
    });

    it('takes no pronoun as what a verb takes (私を見る)', () => {
        expect(candidates('私を見た。', ['miru', '見た'], 'verb', [['watashi', '私']])).toEqual([]);
    });

    it('reads an i-adjective from its く form', () => {
        expect(candidates('早くなった。', ['hayai', '早く'], 'i-adjective', [['naru', 'なっ']])).toEqual(['早くなる']);
    });

    it('lets any verb follow a particle, a light verb only follow the word itself', () => {
        expect(candidates('気がする。', ['ki', '気'], 'other', [['suru', 'する']])).toEqual(['気がする']);
    });
});

describe('selectPatterns', () => {
    const fushigi: PatternPart = { id: 'fushigi' };
    const ni: PatternPart[] = [fushigi, 'に'];
    const niOmou: PatternPart[] = [fushigi, 'に', { id: 'omou' }];
    const na: PatternPart[] = [fushigi, 'な〜'];
    const uses = (n: number, from: number, candidates: PatternPart[][]): PatternUse[] =>
        Array.from({ length: n }, (_, i) => ({ sentence: `s${from + i}`, candidates }));

    it('keeps a pattern seen in enough sentences, and drops a shorter one its longer form holds', () => {
        const all = [...uses(10, 0, [ni, niOmou]), ...uses(1, 10, [ni]), ...uses(4, 11, [na])];
        const { patterns, indexOf } = selectPatterns(all, 100, text);
        expect(patterns).toEqual([{ text: '不思議に思う', sentences: 10 }, { text: '不思議な〜', sentences: 4 }]);
        expect(indexOf([ni, niOmou])).toBe(0);
        expect(indexOf([ni])).toBeUndefined();
        expect(indexOf([na])).toBe(1);
    });

    it('needs at least 3 sentences, and 2% of the word\'s', () => {
        expect(selectPatterns(uses(2, 0, [na]), 10, text).patterns).toEqual([]);
        expect(selectPatterns(uses(3, 0, [na]), 200, text).patterns).toEqual([]);
        expect(selectPatterns(uses(4, 0, [na]), 200, text).patterns).toEqual([{ text: '不思議な〜', sentences: 4 }]);
    });

    it('counts one pattern however its words were found (する as a word, or not)', () => {
        const all = [...uses(2, 0, [[{ id: 'ki' }, 'が', { id: 'suru' }]]), ...uses(2, 2, [[{ id: 'ki' }, 'が', 'する']])];
        expect(selectPatterns(all, 10, text).patterns).toEqual([{ text: '気がする', sentences: 4 }]);
    });

    it('keeps the 5 most used', () => {
        const all = ['が', 'を', 'に', 'で', 'と', 'へ'].flatMap((p, i) => uses(10 - i, i * 20, [[{ id: 'ki' }, p, { id: 'suru' }]]));
        expect(selectPatterns(all, 100, text).patterns.map(p => p.text)).toEqual(['気がする', '気をする', '気にする', '気でする', '気とする']);
    });
});

describe('patternText', () => {
    it('names each word by its headword, an i-adjective in its く form', () => {
        expect(patternText([{ id: 'hayai', ku: true }, { id: 'naru' }], id => HEADWORDS[id])).toBe('早くなる');
    });
});
