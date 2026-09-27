import { describe, it, expect } from 'vitest';
import { compileFormation, matchRule, toMorphToken, type MorphToken } from './formationMiner';

/** Terse token builder: surface, pos, posDetail1, conj?, base?. */
const T = (surface: string, pos: string, posDetail1: string, base = surface, conj = '*'): MorphToken =>
    ({ surface, pos, posDetail1, conj, base });

// Hand-built token streams for the discriminating cases the probe confirmed.
const OITEARU = [T('本', '名詞', '一般'), T('が', '助詞', '格助詞'), T('置い', '動詞', '自立', '置く', '連用タ接続'), T('て', '助詞', '接続助詞'), T('ある', '動詞', '非自立', 'ある')];
const DEARU = [T('事実', '名詞', '一般'), T('で', '助動詞', '*', 'だ', '連用形'), T('ある', '助動詞', '*', 'ある')];
const GAARU = [T('時間', '名詞', '一般'), T('が', '助詞', '格助詞'), T('ある', '動詞', '自立', 'ある')];
const KAETTEKARA = [T('帰っ', '動詞', '自立', '帰る', '連用タ接続'), T('て', '助詞', '接続助詞'), T('から', '助詞', '接続助詞'), T('食べる', '動詞', '自立', '食べる')];
const EKIKARA = [T('駅', '名詞', '一般'), T('から', '助詞', '格助詞'), T('歩い', '動詞', '自立', '歩く', '連用タ接続'), T('た', '助動詞', '*', 'た')];

describe('toMorphToken', () => {
    it('adapts kuromoji ipadic fields', () => {
        expect(toMorphToken({ surface_form: '置い', pos: '動詞', pos_detail_1: '自立', conjugated_form: '連用タ接続', basic_form: '置く' }))
            .toEqual({ surface: '置い', pos: '動詞', posDetail1: '自立', conj: '連用タ接続', base: '置く' });
    });
});

describe('matchRule: te-auxiliary (てある)', () => {
    const rule = compileFormation('Verb-て form + ある', 'Verb て ある')!;
    it('compiles to a morphological teAux rule', () => {
        expect(rule.elements).toEqual([{ kind: 'teAux', bases: ['ある'] }]);
    });
    it('matches a genuine てある', () => expect(matchRule(OITEARU, rule)).toBe(true));
    it('rejects the copula である (助動詞, not 接続助詞 て)', () => expect(matchRule(DEARU, rule)).toBe(false));
    it('rejects existential がある (自立 ある after 格助詞 が)', () => expect(matchRule(GAARU, rule)).toBe(false));
});

describe('matchRule: te-form + particle (てから)', () => {
    const rule = compileFormation('Verb-て形 + から', 'Verb てから～')!;
    it('compiles to a contiguous teParticle rule', () => {
        expect(rule.elements).toEqual([{ kind: 'teParticle', forms: ['から'] }]);
    });
    it('matches 帰ってから', () => expect(matchRule(KAETTEKARA, rule)).toBe(true));
    it('rejects 駅から (から with no preceding て-form)', () => expect(matchRule(EKIKARA, rule)).toBe(false));
    it('rejects a te-form with から elsewhere in the sentence (彼から)', () => {
        // 戻って ... 彼から : te-form present, から present, but NOT adjacent to て.
        const toks = [T('戻っ', '動詞', '自立', '戻る', '連用タ接続'), T('て', '助詞', '接続助詞'), T('彼', '名詞', '代名詞', '彼'), T('から', '助詞', '格助詞')];
        expect(matchRule(toks, rule)).toBe(false);
    });
});

describe('matchRule: literal-contiguous fallback', () => {
    it('matches a contiguous multi-token literal', () => {
        const rule = { elements: [{ kind: 'lit' as const, forms: ['がいちばん'] }], anchor: 'がいちばん' };
        const toks = [T('彼', '名詞', '代名詞'), T('が', '助詞', '格助詞'), T('いちばん', '副詞', '一般'), T('速い', '形容詞', '自立')];
        expect(matchRule(toks, rule)).toBe(true);
    });
    it('matches a >=2-char glued suffix of one token', () => {
        const rule = { elements: [{ kind: 'lit' as const, forms: ['かれ'] }, { kind: 'lit' as const, forms: ['かれ'] }], anchor: 'かれ' };
        const toks = [T('早かれ', '形容詞', '自立', '早い', '命令ｅ'), T('遅かれ', '形容詞', '自立', '遅い', '命令ｅ')];
        expect(matchRule(toks, rule)).toBe(true);
    });
    it('does not match かれ against the pronoun 彼 (kanji surface)', () => {
        const rule = { elements: [{ kind: 'lit' as const, forms: ['かれ'] }], anchor: 'かれ' };
        expect(matchRule([T('彼', '名詞', '代名詞', '彼')], rule)).toBe(false);
    });
});

describe('compileFormation', () => {
    it('returns null for a particle-only formation', () => {
        expect(compileFormation('Noun + を', 'Noun を')).toBeNull();
    });
    it('maps います to base いる', () => {
        expect(compileFormation('Verb て-form + います', 'Verb て います')!.elements).toEqual([{ kind: 'teAux', bases: ['いる'] }]);
    });
    it('maps causative + ください to base くださる', () => {
        expect(compileFormation('Verb-causative form + ください', '～させてください')!.elements).toEqual([{ kind: 'teAux', bases: ['くださる'] }]);
    });
    it('prefers a morphological rule over a literal one', () => {
        const rule = compileFormation('Verb-て form + おく', 'Verb ておく')!;
        expect(rule.elements.some(e => e.kind !== 'lit')).toBe(true);
    });
});
