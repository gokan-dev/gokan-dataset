import { describe, it, expect, beforeAll } from 'vitest';
import kuromoji from 'kuromoji';
import { classify, conjugate } from './conjugator';
import type { ConjugationForm, WordClass } from './conjugator';

/**
 * Uses a real kuromoji tokenizer to classify, so the tests exercise the actual
 * `conjugated_type` strings rather than hand-written fixtures that could drift
 * from what IPADIC really emits. Every euphony row is covered, because the
 * て/た forms are where a naive conjugator silently produces wrong Japanese.
 */
describe('conjugator', () => {
    let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures>;

    beforeAll(async () => {
        tokenizer = await new Promise((resolve, reject) => {
            kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => {
                if (err) reject(err); else resolve(t);
            });
        });
    }, 30000);

    /** Classifies via kuromoji exactly as build-conjugations.ts does. */
    function classifyWord(lemma: string): WordClass | null {
        const t = tokenizer.tokenize(lemma)[0];
        return classify(lemma, t.pos, t.pos_detail_1, t.conjugated_type);
    }

    function form(lemma: string, reading: string, f: ConjugationForm) {
        const cls = classifyWord(lemma);
        expect(cls, `${lemma} should classify`).not.toBeNull();
        return conjugate(lemma, reading, cls!, f);
    }

    describe('classification', () => {
        it('types godan verbs that look ichidan', () => {
            // The classic trap: both end in る but are godan.
            expect(classifyWord('帰る')).toEqual(expect.objectContaining({ kind: 'godan', row: 'ra' }));
            expect(classifyWord('走る')).toEqual(expect.objectContaining({ kind: 'godan', row: 'ra' }));
        });

        it('types ichidan verbs', () => {
            expect(classifyWord('食べる')).toEqual({ kind: 'ichidan' });
            expect(classifyWord('見る')).toEqual({ kind: 'ichidan' });
        });

        it('overrides kuromoji for する, which it mis-types as 五段・ラ行', () => {
            // Bare する collides with 擦る, a genuine godan ラ行 verb also read する.
            const t = tokenizer.tokenize('する')[0];
            expect(t.conjugated_type).toBe('五段・ラ行'); // documents the wrong answer
            expect(classifyWord('する')).toEqual({ kind: 'irregular', lemma: 'する' });
        });

        it('types 来る as irregular', () => {
            expect(classifyWord('来る')).toEqual({ kind: 'irregular', lemma: '来る' });
        });

        it('distinguishes 行く (促音便) from 書く (イ音便) in the same row', () => {
            expect(classifyWord('行く')).toEqual(expect.objectContaining({ kind: 'godan', row: 'ka', teKana: 'って' }));
            expect(classifyWord('書く')).toEqual(expect.objectContaining({ kind: 'godan', row: 'ka', teKana: 'いて' }));
        });

        it('types i-adjectives and na-adjectives', () => {
            expect(classifyWord('面白い')).toEqual({ kind: 'i-adjective' });
            expect(classifyWord('静か')).toEqual({ kind: 'na-adjective' });
        });

        it('returns null for what it will not conjugate, rather than guessing', () => {
            expect(classifyWord('本')).toBeNull();      // plain noun
            expect(classifyWord('とても')).toBeNull();   // adverb
        });
    });

    describe('て-form across every euphony row', () => {
        const cases: [string, string, string][] = [
            ['書く', 'かく', '書いて'],       // カ行 イ音便
            ['行く', 'いく', '行って'],       // カ行 促音便 - the exception
            ['急ぐ', 'いそぐ', '急いで'],     // ガ行
            ['話す', 'はなす', '話して'],     // サ行
            ['待つ', 'まつ', '待って'],       // タ行
            ['死ぬ', 'しぬ', '死んで'],       // ナ行
            ['遊ぶ', 'あそぶ', '遊んで'],     // バ行
            ['飲む', 'のむ', '飲んで'],       // マ行
            ['帰る', 'かえる', '帰って'],     // ラ行
            ['買う', 'かう', '買って'],       // ワ行 促音便
            ['食べる', 'たべる', '食べて'],   // ichidan
        ];

        it.each(cases)('%s -> %s', (lemma, reading, expected) => {
            expect(form(lemma, reading, 'te')?.written).toBe(expected);
        });

        it('conjugates the reading too, so kana answers are accepted', () => {
            expect(form('飲む', 'のむ', 'te')).toEqual({ written: '飲んで', reading: 'のんで' });
            expect(form('書く', 'かく', 'te')).toEqual({ written: '書いて', reading: 'かいて' });
        });

        it('handles the irregulars', () => {
            expect(form('する', 'する', 'te')?.written).toBe('して');
            expect(form('来る', 'くる', 'te')).toEqual({ written: '来て', reading: 'きて' });
        });
    });

    describe('ちゃった and とく follow the て/で voicing', () => {
        it('voices after a ん-row て-form', () => {
            // The dead angle: 飲んで -> 飲んじゃった, never 飲んちゃった.
            expect(form('飲む', 'のむ', 'chatta')?.written).toBe('飲んじゃった');
            expect(form('遊ぶ', 'あそぶ', 'chatta')?.written).toBe('遊んじゃった');
            expect(form('急ぐ', 'いそぐ', 'chatta')?.written).toBe('急いじゃった');
            expect(form('飲む', 'のむ', 'toku')?.written).toBe('飲んどく');
        });

        it('stays unvoiced otherwise', () => {
            expect(form('書く', 'かく', 'chatta')?.written).toBe('書いちゃった');
            expect(form('買う', 'かう', 'chatta')?.written).toBe('買っちゃった');
            expect(form('食べる', 'たべる', 'chatta')?.written).toBe('食べちゃった');
            expect(form('書く', 'かく', 'toku')?.written).toBe('書いとく');
        });
    });

    describe('a-stem forms use わ for the ワ row', () => {
        it('買う -> 買わない-stem, not 買あ-', () => {
            expect(form('買う', 'かう', 'zu')?.written).toBe('買わず');
            expect(form('買う', 'かう', 'causative')?.written).toBe('買わせる');
            expect(form('買う', 'かう', 'passive')?.written).toBe('買われる');
        });

        it('other rows', () => {
            expect(form('書く', 'かく', 'zu')?.written).toBe('書かず');
            expect(form('飲む', 'のむ', 'causative')?.written).toBe('飲ませる');
            expect(form('話す', 'はなす', 'passive')?.written).toBe('話される');
        });

        it('する and 来る are irregular here', () => {
            expect(form('する', 'する', 'zu')?.written).toBe('せず');
            expect(form('来る', 'くる', 'zu')).toEqual({ written: '来ず', reading: 'こず' });
            expect(form('来る', 'くる', 'causative')).toEqual({ written: '来させる', reading: 'こさせる' });
        });
    });

    describe('potential', () => {
        it('godan uses the e-stem', () => {
            expect(form('書く', 'かく', 'potential')?.written).toBe('書ける');
            expect(form('飲む', 'のむ', 'potential')?.written).toBe('飲める');
            expect(form('買う', 'かう', 'potential')?.written).toBe('買える');
        });

        it('ichidan offers the colloquial short form as an alternative', () => {
            const p = form('食べる', 'たべる', 'potential');
            expect(p?.written).toBe('食べられる');
            expect(p?.alternatives?.[0].written).toBe('食べれる');
        });

        it('ichidan potential and passive are homophonous - the reason the drill excludes ichidan', () => {
            // Documents the ambiguity rather than pretending it does not exist.
            expect(form('食べる', 'たべる', 'potential')?.written)
                .toBe(form('食べる', 'たべる', 'passive')?.written);
            // Godan keeps them distinct, which is why the drill prefers godan.
            expect(form('書く', 'かく', 'potential')?.written).not
                .toBe(form('書く', 'かく', 'passive')?.written);
        });

        it('する has no potential entry - できる is a different verb, not a conjugation', () => {
            expect(form('する', 'する', 'potential')).toBeNull();
        });
    });

    describe('causative-passive accepts both standard forms', () => {
        it('godan: full and contracted', () => {
            const c = form('書く', 'かく', 'causative-passive');
            expect(c?.written).toBe('書かせられる');
            expect(c?.alternatives?.[0].written).toBe('書かされる');
        });

        it('ichidan', () => {
            expect(form('食べる', 'たべる', 'causative-passive')?.written).toBe('食べさせられる');
        });
    });

    describe('たい uses the i-stem', () => {
        it.each([
            ['飲む', 'のむ', '飲みたい'],
            ['書く', 'かく', '書きたい'],
            ['買う', 'かう', '買いたい'],
            ['食べる', 'たべる', '食べたい'],
        ])('%s -> %s', (lemma, reading, expected) => {
            expect(form(lemma, reading, 'tai')?.written).toBe(expected);
        });
    });

    describe('adjectives', () => {
        it('i-adjective forms', () => {
            expect(form('面白い', 'おもしろい', 'i-adj-adverbial')?.written).toBe('面白く');
            expect(form('面白い', 'おもしろい', 'i-adj-te')?.written).toBe('面白くて');
            expect(form('面白い', 'おもしろい', 'i-adj-negative-polite')?.written).toBe('面白くないです');
        });

        it('いい is irregular: よく, not いく', () => {
            const cls: WordClass = { kind: 'i-adjective' };
            expect(conjugate('いい', 'いい', cls, 'i-adj-adverbial')?.written).toBe('よく');
            expect(conjugate('いい', 'いい', cls, 'i-adj-te')?.written).toBe('よくて');
            expect(conjugate('良い', 'よい', cls, 'i-adj-adverbial')).toEqual({ written: '良く', reading: 'よく' });
        });

        it('na-adjective adverbial keeps the whole stem', () => {
            expect(form('静か', 'しずか', 'na-adj-adverbial')).toEqual({ written: '静かに', reading: 'しずかに' });
        });
    });

    describe('refuses mismatched pairings instead of producing nonsense', () => {
        it('adjective form asked of a verb', () => {
            expect(form('飲む', 'のむ', 'i-adj-adverbial')).toBeNull();
            expect(form('飲む', 'のむ', 'na-adj-adverbial')).toBeNull();
        });

        it('verb form asked of an adjective', () => {
            expect(form('面白い', 'おもしろい', 'te')).toBeNull();
            expect(form('静か', 'しずか', 'causative')).toBeNull();
        });

        it('i-adjective form asked of a na-adjective', () => {
            expect(form('静か', 'しずか', 'i-adj-adverbial')).toBeNull();
        });
    });
});
