import { describe, it, expect } from 'vitest';
import {
    blankFitsRule,
    compileFormation,
    emptyMarkerLexicon,
    findMatch,
    fitsMarkerLexicon,
    isExampleSized,
    leaksAnswer,
    learnMarker,
    matchRule,
    toMorphToken,
    variantShape,
    type MarkerLexicon,
    type MiningRule,
    type MorphToken,
} from './formationMiner';

/** Terse token builder: surface, pos, posDetail1, base?, conj?. */
const T = (surface: string, pos: string, posDetail1: string, base = surface, conj = '*'): MorphToken =>
    ({ surface, pos, posDetail1, conj, base });
const PERIOD = T('。', '記号', '句点');
const COMMA = T('、', '記号', '読点');

// Hand-built token streams for the discriminating cases the probe confirmed.
const OITEARU = [T('本', '名詞', '一般'), T('が', '助詞', '格助詞'), T('置い', '動詞', '自立', '置く', '連用タ接続'), T('て', '助詞', '接続助詞'), T('ある', '動詞', '非自立', 'ある')];
const DEARU = [T('事実', '名詞', '一般'), T('で', '助動詞', '*', 'だ', '連用形'), T('ある', '助動詞', '*', 'ある')];
const GAARU = [T('時間', '名詞', '一般'), T('が', '助詞', '格助詞'), T('ある', '動詞', '自立', 'ある')];
const KAETTEKARA = [T('帰っ', '動詞', '自立', '帰る', '連用タ接続'), T('て', '助詞', '接続助詞'), T('から', '助詞', '接続助詞'), T('食べる', '動詞', '自立', '食べる')];
const EKIKARA = [T('駅', '名詞', '一般'), T('から', '助詞', '格助詞'), T('歩い', '動詞', '自立', '歩く', '連用タ接続'), T('た', '助動詞', '*', 'た')];

/** A literal rule with no slot requirements, for tests of the literal engine alone. */
const lit = (groups: string[], extra: Partial<MiningRule> = {}): MiningRule =>
    ({ elements: groups.map(g => ({ kind: 'lit' as const, forms: [g] })), anchor: groups[0], leading: null, trailing: false, interior: groups.slice(1).map(() => 'any' as const), ...extra });

describe('toMorphToken', () => {
    it('adapts kuromoji ipadic fields', () => {
        expect(toMorphToken({ surface_form: '置い', pos: '動詞', pos_detail_1: '自立', conjugated_form: '連用タ接続', basic_form: '置く' }))
            .toEqual({ surface: '置い', pos: '動詞', posDetail1: '自立', conj: '連用タ接続', base: '置く' });
    });
});

describe('matchRule: te-auxiliary (てある)', () => {
    const rule = compileFormation('Verb-て form + ある', 'Verb て ある')[0];
    it('compiles to a morphological teAux rule', () => {
        expect(rule.elements).toEqual([{ kind: 'teAux', bases: ['ある'] }]);
    });
    it('matches a genuine てある', () => expect(matchRule(OITEARU, rule)).toBe(true));
    it('rejects the copula である (助動詞, not 接続助詞 て)', () => expect(matchRule(DEARU, rule)).toBe(false));
    it('rejects existential がある (自立 ある after 格助詞 が)', () => expect(matchRule(GAARU, rule)).toBe(false));
});

describe('matchRule: te-form + particle (てから)', () => {
    const rule = compileFormation('Verb-て形 + から', 'Verb てから～')[0];
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
    it('the title ～ requires a following clause: sentence-final 帰ってから。 is rejected', () => {
        const toks = [T('帰っ', '動詞', '自立', '帰る', '連用タ接続'), T('て', '助詞', '接続助詞'), T('から', '助詞', '接続助詞'), PERIOD];
        expect(matchRule(toks, rule)).toBe(false);
    });
});

describe('matchRule: literal-contiguous engine', () => {
    it('matches a contiguous multi-token literal', () => {
        const toks = [T('彼', '名詞', '代名詞'), T('が', '助詞', '格助詞'), T('いちばん', '副詞', '一般'), T('速い', '形容詞', '自立')];
        expect(matchRule(toks, lit(['がいちばん']))).toBe(true);
    });
    it('matches a >=2-char glued suffix, including a second group glued right after the first', () => {
        const toks = [T('早かれ', '形容詞', '自立', '早い', '命令ｅ'), T('遅かれ', '形容詞', '自立', '遅い', '命令ｅ')];
        expect(matchRule(toks, lit(['かれ', 'かれ'], { leading: 'adjective' }))).toBe(true);
    });
    it('does not match かれ against the pronoun 彼 (kanji surface)', () => {
        expect(matchRule([T('彼', '名詞', '代名詞', '彼')], lit(['かれ']))).toBe(false);
    });
});

describe('variantShape: slots are read from the raw formation text', () => {
    it('reads a verb slot, and a scaffolded adjective slot the old stripper erased', () => {
        expect(variantShape('Verb-casual + から')).toEqual({ groups: [['から']], leading: 'verb', trailing: false, interior: [] });
        expect(variantShape('い-Adjective + から')).toEqual({ groups: [['から']], leading: 'iAdjective', trailing: false, interior: [] });
        expect(variantShape('な-Adjective + だから')).toEqual({ groups: [['だから']], leading: 'naAdjective', trailing: false, interior: [] });
    });
    it('reads a content slot on both sides of a connective', () => {
        expect(variantShape('Sentence A + しかし + Sentence B.')).toEqual({ groups: [['しかし']], leading: 'any', trailing: true, interior: [] });
    });
    it('keeps a 1-char particle as its own group when a slot separates it', () => {
        expect(variantShape('Noun1 + を + Noun2 + として').groups).toEqual([['を'], ['として']]);
    });
    it('reads no leading slot when the formation starts with the marker', () => {
        expect(variantShape('なんで + [phrase or sentence]').leading).toBeNull();
    });
    it('does not read "etc." as a trailing slot', () => {
        expect(variantShape('Verb-ます stem + られる, etc.').trailing).toBe(false);
    });
});

describe('compileFormation: every variant is mined, not just the longest literal', () => {
    const rules = compileFormation('Verb-casual + から / い-Adjective + から / な-Adjective + だから / Noun + だから', '～から、～');
    it('compiles plain から and だから as separate rules', () => {
        const anchors = rules.map(r => r.anchor);
        expect(anchors).toContain('から');
        expect(anchors).toContain('だから');
    });
    it('marks every variant as needing a following clause, from the title', () => {
        expect(rules.every(r => r.trailing)).toBe(true);
    });
    it('returns [] for a particle-only formation', () => {
        expect(compileFormation('Noun + を', 'Noun を')).toEqual([]);
    });
    it('maps います to base いる', () => {
        expect(compileFormation('Verb て-form + います', 'Verb て います')[0].elements).toEqual([{ kind: 'teAux', bases: ['いる'] }]);
    });
    it('maps causative + ください to base くださる', () => {
        expect(compileFormation('Verb-causative form + ください', '～させてください')[0].elements).toEqual([{ kind: 'teAux', bases: ['くださる'] }]);
    });
    it('puts a morphological rule first', () => {
        expect(compileFormation('Verb-て form + おく', 'Verb ておく')[0].elements.some(e => e.kind !== 'lit')).toBe(true);
    });
});

describe('matchRule: reason から (issue: every mined sentence was だから)', () => {
    const [verbKara] = compileFormation('Verb-casual + から', '～から、～');
    const [nounDakara] = compileFormation('Noun + だから', '～から、～');
    const IKUKARA = [T('明日', '名詞', '副詞可能'), T('行く', '動詞', '自立', '行く'), T('から', '助詞', '接続助詞'), COMMA, T('待っ', '動詞', '自立', '待つ'), T('て', '助詞', '接続助詞'), PERIOD];

    it('matches plain から after a verb', () => expect(matchRule(IKUKARA, verbKara)).toBe(true));
    it('rejects source から after a noun (駅から)', () => expect(matchRule(EKIKARA, verbKara)).toBe(false));
    it('matches だから after a noun, mid-sentence', () => {
        const toks = [T('雨', '名詞', '一般'), T('だ', '助動詞', '*', 'だ'), T('から', '助詞', '接続助詞'), T('休む', '動詞', '自立', '休む'), PERIOD];
        expect(matchRule(toks, nounDakara)).toBe(true);
    });
    it('rejects sentence-final …んだから。 (no B clause)', () => {
        const toks = [T('子供', '名詞', '一般'), T('な', '助動詞', '*', 'だ'), T('ん', '名詞', '非自立'), T('だ', '助動詞', '*', 'だ'), T('から', '助詞', '接続助詞'), PERIOD];
        expect(matchRule(toks, nounDakara)).toBe(false);
    });
    it('rejects …だからな。 (a sentence-final particle is not a clause)', () => {
        const toks = [T('地獄耳', '名詞', '一般'), T('だ', '助動詞', '*', 'だ'), T('から', '助詞', '接続助詞'), T('な', '助詞', '終助詞'), PERIOD];
        expect(matchRule(toks, nounDakara)).toBe(false);
    });
    it('rejects the sentence-initial connective だから (nothing fills the Noun slot)', () => {
        const toks = [T('だから', '接続詞', '*'), T('何', '名詞', '代名詞'), T('？', '記号', '一般')];
        expect(matchRule(toks, nounDakara)).toBe(false);
    });
});

describe('matchRule: leading content slot (しかし)', () => {
    const [rule] = compileFormation('Sentence A + しかし + Sentence B.', 'A。しかし、～B。');
    const SHIKASHI = [T('しかし', '接続詞', '*'), T('彼', '名詞', '代名詞'), T('は', '助詞', '係助詞'), T('来', '動詞', '自立', '来る'), T('た', '助動詞', '*', 'た'), PERIOD];
    it('rejects a sentence that opens with しかし (its A clause is not in the example)', () => {
        expect(matchRule(SHIKASHI, rule)).toBe(false);
    });
    it('accepts A。しかし B。', () => {
        const toks = [T('疲れ', '動詞', '自立', '疲れる'), T('た', '助動詞', '*', 'た'), PERIOD, ...SHIKASHI];
        expect(matchRule(toks, rule)).toBe(true);
    });
});

describe('matchRule: leading verb slot (Verb-た + あとで)', () => {
    const [rule] = compileFormation('Verb-た form + あとで', 'Verb たあとで～');
    it('rejects the sentence-initial adverb 後で ("later")', () => {
        const toks = [T('あとで', '副詞', '一般'), T('電話', '名詞', 'サ変接続'), T('し', '動詞', '自立', 'する'), T('ます', '助動詞', '*', 'ます'), PERIOD];
        expect(matchRule(toks, rule)).toBe(false);
    });
    it('accepts 食べたあとで', () => {
        const toks = [T('食べ', '動詞', '自立', '食べる'), T('た', '助動詞', '*', 'た'), T('あと', '名詞', '一般'), T('で', '助詞', '格助詞'), T('寝る', '動詞', '自立', '寝る'), PERIOD];
        expect(matchRule(toks, rule)).toBe(true);
    });
});

describe('matchRule: interior slot, 1-char particles kept (Noun1 を Noun2 として)', () => {
    const [rule] = compileFormation('Noun1 + を + Noun2 + として', 'Noun を Noun として');
    it('rejects として inside しようとしている (no を, not the construction)', () => {
        const toks = [T('発車', '名詞', 'サ変接続'), T('しよ', '動詞', '自立', 'する'), T('う', '助動詞', '*', 'う'), T('と', '助詞', '格助詞'), T('し', '動詞', '自立', 'する'), T('て', '助詞', '接続助詞'), T('いる', '動詞', '非自立', 'いる')];
        expect(matchRule(toks, rule)).toBe(false);
    });
    it('accepts 彼を先生として', () => {
        const toks = [T('彼', '名詞', '代名詞'), T('を', '助詞', '格助詞'), T('先生', '名詞', '一般'), T('として', '助詞', '格助詞'), T('尊敬', '名詞', 'サ変接続')];
        expect(matchRule(toks, rule)).toBe(true);
    });
});

describe('matchRule: interior slot needs content (Noun こそ … が …)', () => {
    const [rule] = compileFormation('Noun + こそ + (statement) + が + (contrasting statement)', 'Noun こそ～が');
    it('rejects 彼こそが (subject が right after こそ, no statement between)', () => {
        const toks = [T('彼', '名詞', '代名詞'), T('こそ', '助詞', '係助詞'), T('が', '助詞', '格助詞'), T('必要', '名詞', '形容動詞語幹'), PERIOD];
        expect(matchRule(toks, rule)).toBe(false);
    });
});

describe('slot verb forms: the slot names a specific form', () => {
    it('Verb-て form + まで rejects 帰るまで ("until", a dictionary form)', () => {
        const [rule] = compileFormation('Verb-て form + まで', '～てまで');
        expect(rule.leading).toBe('teForm');
        const toks = [T('帰る', '動詞', '自立', '帰る', '基本形'), T('まで', '助詞', '副助詞'), T('待つ', '動詞', '自立', '待つ', '基本形')];
        expect(matchRule(toks, rule)).toBe(false);
        const te = [T('借金', '名詞', 'サ変接続'), T('し', '動詞', '自立', 'する', '連用形'), T('て', '助詞', '接続助詞'), T('まで', '助詞', '副助詞'), T('買う', '動詞', '自立', '買う', '基本形')];
        expect(matchRule(te, rule)).toBe(true);
    });
    it('distinguishes only て-form and volitional; every other form is a plain verb slot', () => {
        expect(variantShape('Verb-う stem + とした').leading).toBe('volitional');
        expect(variantShape('Verb-た form + あとで').leading).toBe('verb');
        expect(variantShape('Verb-ます stem + がち').leading).toBe('verb');
        expect(variantShape('Verb-dictionary form + なり').leading).toBe('verb');
        // "(drop ない)" means the 未然形: a specific ない-form slot would reject 暮らさざる.
        expect(variantShape('Verb-ない form (drop ない) + ざるを得ない').leading).toBe('verb');
    });
    it('a kana form label (ず form) is slot scaffolding, not a literal', () => {
        expect(variantShape('Verb-ず form + に + すんだ').groups).toEqual([['にすんだ']]);
    });
    it('a glued match on a non-conjugating word is rejected (かなり is not Verb + なり)', () => {
        const [rule] = compileFormation('Verb-dictionary form + なり', 'Verbる なり');
        expect(matchRule([T('事態', '名詞', '一般'), T('は', '助詞', '係助詞'), T('かなり', '副詞', '一般'), T('切迫', '名詞', 'サ変接続')], rule)).toBe(false);
    });
});

describe('glued markers and the plain verb slot', () => {
    it('rejects a dictionary-form word that merely ends in the marker (うまい is not Verb + まい)', () => {
        const [rule] = compileFormation('Verb-dictionary form + まい', 'Verbる まい');
        expect(matchRule([T('うまい', '形容詞', '自立', 'うまい', '基本形'), T('冗談', '名詞', '一般')], rule)).toBe(false);
    });
    it('a plain verb slot does not accept て (貸して上げる is not Verb-ます stem + 上げる)', () => {
        const [rule] = compileFormation('Verb-ますstem + 上げる', '～上げる');
        const toks = [T('貸し', '動詞', '自立', '貸す', '連用形'), T('て', '助詞', '接続助詞'), T('上げる', '動詞', '非自立', '上げる', '基本形')];
        expect(matchRule(toks, rule)).toBe(false);
    });
});

describe('ば～のに: a conditional form label is a literal, ～ is a content gap', () => {
    const [rule] = compileFormation('Verb-ば form + ～のに', '～ば～のに');
    it('compiles to ば … のに with content between', () => {
        expect(rule.elements).toEqual([{ kind: 'lit', forms: ['ば'] }, { kind: 'lit', forms: ['のに'] }]);
        expect(rule.leading).toBe('verb');
    });
    it('rejects a bare のに with no ば (隣に住んでるのに)', () => {
        const toks = [T('住ん', '動詞', '自立', '住む'), T('でる', '動詞', '非自立', 'でる'), T('のに', '助詞', '接続助詞'), COMMA, T('彼', '名詞', '代名詞')];
        expect(matchRule(toks, rule)).toBe(false);
    });
    it('accepts すればよかったのに', () => {
        const toks = [T('すれ', '動詞', '自立', 'する', '仮定形'), T('ば', '助詞', '接続助詞'), T('よかっ', '形容詞', '自立', 'よい'), T('た', '助動詞', '*', 'た'), T('のに', '助詞', '終助詞')];
        expect(matchRule(toks, rule)).toBe(true);
    });
});

describe('residuals: interior part of speech, glued markers, risky followers (real kuromoji tokens)', () => {
    it('Noun1 を Noun2 として rejects 誘惑しようとして (the word before として is volitional う, not a noun)', () => {
        const [rule] = compileFormation('Noun1 + を + Noun2 + として', 'Noun を Noun として');
        expect(rule.interior).toEqual(['noun']);
        const trying = [T('彼女', '名詞', '代名詞'), T('を', '助詞', '格助詞'), T('誘惑', '名詞', 'サ変接続'), T('しよ', '動詞', '自立', 'する'), T('う', '助動詞', '*', 'う'), T('として', '助詞', '格助詞'), COMMA];
        expect(matchRule(trying, rule)).toBe(false);
        const as = [T('彼', '名詞', '代名詞'), T('を', '助詞', '格助詞'), T('先生', '名詞', '一般'), T('として', '助詞', '格助詞'), T('尊敬', '名詞', 'サ変接続')];
        expect(matchRule(as, rule)).toBe(true);
    });

    const [karaRule] = compileFormation('Verb-casual + から', '～から、～');
    const karaLexicon = emptyMarkerLexicon();
    const karaCurated = [T('試験', '名詞', 'サ変接続'), T('が', '助詞', '格助詞'), T('ある', '動詞', '自立', 'ある'), T('から', '助詞', '接続助詞'), COMMA, T('勉強', '名詞', 'サ変接続')];
    learnMarker(karaLexicon, karaCurated, findMatch(karaCurated, karaRule)!);
    const accepts = (lexicon: MarkerLexicon, rule: MiningRule, toks: MorphToken[]) =>
        findMatch(toks, rule, m => fitsMarkerLexicon(lexicon, toks, m)) !== null;

    it('rejects から glued inside べから(ず) when curated から is never glued', () => {
        const bekarazu = [T('捨てる', '動詞', '自立', '捨てる', '基本形'), T('べから', '助動詞', '*', 'べし', '未然形'), T('ず', '助動詞', '*', 'ぬ'), T('。', '記号', '句点')];
        expect(accepts(karaLexicon, { ...karaRule, trailing: false }, bekarazu)).toBe(false);
    });
    it('rejects 無から, which kuromoji mis-reads as one adjective', () => {
        const mukara = [T('は', '助詞', '係助詞'), COMMA, T('無から', '形容詞', '自立', '無い', '連用ゴザイ接続'), T('有', '名詞', 'サ変接続'), T('を', '助詞', '格助詞'), T('作る', '動詞', '自立')];
        expect(accepts(karaLexicon, { ...karaRule, trailing: false }, mukara)).toBe(false);
    });
    it('rejects quotative であろうとは (a topic は right after と) when curated never shows it', () => {
        const [rule] = compileFormation('Noun + であろうと', '～であろうと');
        const lexicon = emptyMarkerLexicon();
        const curated = [T('雨', '名詞', '一般'), T('で', '助動詞', '*', 'だ'), T('あろ', '助動詞', '*', 'ある'), T('う', '助動詞', '*', 'う'), T('と', '助詞', '格助詞'), COMMA, T('試合', '名詞', 'サ変接続')];
        learnMarker(lexicon, curated, findMatch(curated, rule)!);
        const quotative = [T('病気', '名詞', 'サ変接続'), T('で', '助動詞', '*', 'だ'), T('あろ', '助動詞', '*', 'ある'), T('う', '助動詞', '*', 'う'), T('と', '助詞', '格助詞'), T('は', '助詞', '係助詞'), T('思い', '名詞', '一般')];
        expect(accepts(lexicon, rule, quotative)).toBe(false);
    });
    it('rejects the genitive ものの２倍 that kuromoji mis-tags as the concessive', () => {
        const [rule] = compileFormation('Verb-casual + ものの', '～ものの、～');
        const lexicon = emptyMarkerLexicon();
        const curated = [T('行っ', '動詞', '自立', '行く'), T('た', '助動詞', '*', 'た'), T('ものの', '助詞', '接続助詞'), COMMA, T('会え', '動詞', '自立', '会える')];
        learnMarker(lexicon, curated, findMatch(curated, rule)!);
        const genitive = [T('い', '動詞', '非自立', 'いる'), T('る', '動詞', '非自立', 'いる'), T('ものの', '助詞', '接続助詞'), T('２', '名詞', '数'), T('倍', '名詞', '接尾'), T('ある', '動詞', '自立')];
        expect(accepts(lexicon, { ...rule, trailing: false }, genitive)).toBe(false);
        const concessive = [T('高い', '形容詞', '自立'), T('ものの', '助詞', '接続助詞'), COMMA, T('品質', '名詞', '一般'), T('は', '助詞', '係助詞'), T('いい', '形容詞', '自立')];
        expect(accepts(lexicon, { ...rule, leading: 'adjective', trailing: false }, concessive)).toBe(true);
    });
});

describe('refinements that keep valid sentences', () => {
    it('a noun slot sees past case particles (アメリカはもちろん、ヨーロッパへも)', () => {
        const [rule] = compileFormation('Noun1 + はもちろん + Noun2 + も', '～はもちろん～も');
        const toks = [T('アメリカ', '名詞', '固有名詞'), T('は', '助詞', '係助詞'), T('もちろん', '副詞', '一般'), COMMA, T('ヨーロッパ', '名詞', '固有名詞'), T('へ', '助詞', '格助詞'), T('も', '助詞', '係助詞'), T('行っ', '動詞', '自立', '行く')];
        expect(matchRule(toks, rule)).toBe(true);
    });
    it('a volitional slot before まいか is just a verb (受けようか受けまいか)', () => {
        const [rule] = compileFormation('Verb-volitional + か + Verb-volitional + まいか', '～か～まいか');
        expect(rule.interior).toEqual(['verb']);
        const toks = [T('受けよ', '動詞', '自立', '受ける'), T('う', '助動詞', '*', 'う'), T('か', '助詞', '副助詞／並立助詞／終助詞'), T('受け', '動詞', '自立', '受ける'), T('まい', '助動詞', '*', 'まい'), T('か', '助詞', '副助詞／並立助詞／終助詞'), T('決め', '動詞', '自立', '決める')];
        expect(matchRule(toks, rule)).toBe(true);
    });
    it('keeps the concessive であろうとも (も after と is not the quotative とは)', () => {
        const [rule] = compileFormation('Noun + であろうと', '～であろうと');
        const lexicon = emptyMarkerLexicon();
        const curated = [T('雨', '名詞', '一般'), T('で', '助動詞', '*', 'だ'), T('あろ', '助動詞', '*', 'ある'), T('う', '助動詞', '*', 'う'), T('と', '助詞', '格助詞'), COMMA, T('試合', '名詞', 'サ変接続')];
        learnMarker(lexicon, curated, findMatch(curated, rule)!);
        const tomo = [T('粗末', '名詞', '形容動詞語幹'), T('で', '助動詞', '*', 'だ'), T('あろ', '助動詞', '*', 'ある'), T('う', '助動詞', '*', 'う'), T('と', '助詞', '格助詞'), T('も', '助詞', '係助詞'), T('我が家', '名詞', '一般')];
        expect(findMatch(tomo, rule, m => fitsMarkerLexicon(lexicon, tomo, m))).not.toBeNull();
    });
});

describe('marker lexicon: a particle sub-tag is the distinction', () => {
    it('rejects quotative と when the curated concessive と is conjunctive (病気であろうとは)', () => {
        const [rule] = compileFormation('Noun + であろうと', '～であろうと');
        const curated = [T('雨', '名詞', '一般'), T('で', '助動詞', '*', 'だ'), T('あろ', '助動詞', '*', 'ある'), T('う', '助動詞', '*', 'う'), T('と', '助詞', '接続助詞'), COMMA, T('行く', '動詞', '自立')];
        const lexicon = emptyMarkerLexicon();
        learnMarker(lexicon, curated, findMatch(curated, rule)!);
        const quotative = [T('病気', '名詞', '一般'), T('で', '助動詞', '*', 'だ'), T('あろ', '助動詞', '*', 'ある'), T('う', '助動詞', '*', 'う'), T('と', '助詞', '格助詞'), T('は', '助詞', '係助詞'), T('思わ', '動詞', '自立', '思う')];
        expect(findMatch(quotative, rule, m => fitsMarkerLexicon(lexicon, quotative, m))).toBeNull();
    });
});

describe('formation parsing', () => {
    it('an unspaced slash is a slot alternative, not a variant split (no bare だの)', () => {
        const rules = compileFormation('Noun/Verb casual + だの + Noun/Verb casual + だの', 'A だの B だの');
        expect(rules).toHaveLength(1);
        expect(rules[0].elements).toEqual([{ kind: 'lit', forms: ['だの'] }, { kind: 'lit', forms: ['だの'] }]);
    });
    it('a spaced slash still splits variants', () => {
        expect(compileFormation('Verb-casual + から / Noun + だから', '').map(r => r.anchor).sort()).toEqual(['から', 'だから']);
    });
    it('a bare continuation after a spaced slash keeps the previous slot', () => {
        const rules = compileFormation('Noun + を皮切りに / を皮切りにして', '');
        expect(rules.every(r => r.leading === 'noun')).toBe(true);
    });
    it('an unspaced alternation expands into one rule per alternative (にする / になる)', () => {
        expect(variantShape('な-Adjective + に + する/なる').groups).toEqual([['にする', 'になる']]);
        expect(compileFormation('な-Adjective + に + する/なる', '').map(r => r.anchor).sort()).toEqual(['にする', 'になる']);
    });
    it('a 1-char alternative beside longer ones is dropped (な/である一方 is not a bare な)', () => {
        expect(variantShape('な-Adjective + な/である一方').groups).toEqual([['である一方']]);
    });
    it('a (～かろう) hint joins the next group instead of leaving a bare が', () => {
        const [rule] = compileFormation('どんなに + い-Adjective(～かろう) + が', '');
        expect(rule.elements).toEqual([{ kind: 'lit', forms: ['どんなに'] }, { kind: 'lit', forms: ['かろうが'] }]);
    });
    it('a connective after punctuation takes a clause slot (…のか、それとも)', () => {
        const [rule] = compileFormation('Verb-casual + ？それとも + Verb-casual + ？', '');
        expect(rule.leading).toBe('any');
    });
});

describe('marker lexicon: the marker must be tokenized and tagged as in the curated examples', () => {
    /** Learns a lexicon from one curated token stream. */
    const learnFrom = (rule: MiningRule, curated: MorphToken[]): MarkerLexicon => {
        const lexicon: MarkerLexicon = emptyMarkerLexicon();
        learnMarker(lexicon, curated, findMatch(curated, rule)!);
        return lexicon;
    };
    const accepts = (lexicon: MarkerLexicon, rule: MiningRule, toks: MorphToken[]) =>
        findMatch(toks, rule, m => fitsMarkerLexicon(lexicon, toks, m)) !== null;

    it('rejects the verb やら (やる) when the curated marker is the particle', () => {
        const rule = lit(['やら'], { leading: 'verb' });
        const lexicon = learnFrom(rule, [T('泣く', '動詞', '自立'), T('やら', '助詞', '副助詞'), T('笑う', '動詞', '自立'), T('やら', '助詞', '副助詞')]);
        const verb = [T('考え', '動詞', '自立', '考える', '連用形'), T('て', '助詞', '接続助詞'), T('やら', '動詞', '非自立', 'やる', '未然形'), T('なかっ', '助動詞', '*', 'ない')];
        expect(accepts(lexicon, rule, verb)).toBe(false);
    });
    it('rejects a marker split where curated keeps it whole (な+もの+の is not the concessive ものの)', () => {
        const verbRule = lit(['ものの'], { leading: 'verb' });
        const lexicon = learnFrom(verbRule, [T('行っ', '動詞', '自立', '行く'), T('た', '助動詞', '*', 'た'), T('ものの', '助詞', '接続助詞'), T('会え', '動詞', '自立', '会える')]);
        const naRule = lit(['なものの'], { leading: 'naAdjective' });
        const genitive = [T('率直', '名詞', '形容動詞語幹'), T('な', '助動詞', '*', 'だ'), T('もの', '名詞', '非自立'), T('の', '助詞', '連体化'), T('言い方', '名詞', '一般')];
        expect(accepts(lexicon, naRule, genitive)).toBe(false);
        const concessive = [T('静か', '名詞', '形容動詞語幹'), T('な', '助動詞', '*', 'だ'), T('ものの', '助詞', '接続助詞'), T('狭い', '形容詞', '自立')];
        expect(accepts(lexicon, naRule, concessive)).toBe(true);
    });
    it('an empty lexicon accepts everything (no curated reference)', () => {
        expect(fitsMarkerLexicon(emptyMarkerLexicon(), EKIKARA, { start: 1, end: 2, glued: false, spans: [[1, 2]] })).toBe(true);
    });
});

describe('post-location checks', () => {
    const words = (...s: string[]) => s.map(surface => ({ surface }));

    it('blankFitsRule rejects a blank on the sentence-initial occurrence even when the rule matched elsewhere', () => {
        const [rule] = compileFormation('Sentence A + しかし + Sentence B.', 'A。しかし、～B。');
        const ex = { jp: 'しかし彼は来た。', words: words('しかし', '彼', 'は', '来', 'た', '。'), patternWordIndices: [0] };
        expect(blankFitsRule(ex, rule)).toBe(false);
    });
    it('blankFitsRule accepts a merged word that carries its own slot (早かろうが)', () => {
        const rule = lit(['かろうが'], { leading: 'iAdjective' });
        const ex = { jp: '早かろうが遅かろうが行く。', words: words('早かろうが', '遅かろうが', '行く', '。'), patternWordIndices: [0, 1] };
        expect(blankFitsRule(ex, rule)).toBe(true);
    });
    it('blankFitsRule rejects a trailing-slot blank followed only by a sentence-final particle', () => {
        const rule = lit(['だから'], { leading: 'noun', trailing: true });
        const ex = { jp: '地獄耳だからな。', words: words('地獄耳', 'だ', 'から', 'な', '。'), patternWordIndices: [1, 2] };
        expect(blankFitsRule(ex, rule)).toBe(false);
    });
    it('leaksAnswer flags a marker that also appears unblanked', () => {
        const ex = { jp: '紅茶にしますかコーヒーにしますか', words: words('紅茶', 'に', 'します', 'か', 'コーヒー', 'に', 'します', 'か'), patternWordIndices: [1, 2] };
        expect(leaksAnswer(ex)).toBe(true);
    });
    it('leaksAnswer ignores a single shared character', () => {
        const ex = { jp: '彼に会いに行く', words: words('彼', 'に', '会い', 'に', '行く'), patternWordIndices: [3] };
        expect(leaksAnswer(ex)).toBe(false);
    });
    it('isExampleSized keeps A。しかし B。 and rejects a transcript', () => {
        expect(isExampleSized('彼は疲れていた。しかし、宿題を終わらせた。')).toBe(true);
        expect(isExampleSized('一。二。三。')).toBe(false);
        expect(isExampleSized('あ'.repeat(61))).toBe(false);
    });
});
