import { describe, it, expect, beforeAll } from 'vitest';
import kuromoji from 'kuromoji';
import { SentenceTokenizer, type TokenSpan } from './tokenizer';
import { wordComponents, type ComponentWord } from './components';

describe('wordComponents', () => {
    let spans: (text: string) => TokenSpan[];

    beforeAll(async () => {
        const tokenizer = await new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>((resolve, reject) => {
            kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => {
                if (err) reject(err);
                else resolve(t);
            });
        });
        const sentenceTokenizer = new SentenceTokenizer(tokenizer);
        spans = text => sentenceTokenizer.tokenSpans(text);
    });

    const word = (id: string, written: string, kana?: string, pos: string[] = []): ComponentWord =>
        ({ id, written, hasKanji: /[一-鿿]/.test(written), kana: kana ? { spelling: kana, pos } : undefined });

    const suru = word('suru', '為る', 'する', ['vs-i']);
    const nai = word('nai', '無い', 'ない', ['adj-i']);
    const naru = word('naru', '成る', 'なる', ['v5r', 'vi']);

    it('builds 気がする and 気にする from する, learned in kana', () => {
        const components = wordComponents([suru, word('ki', '気'), word('kigasuru', '気がする'), word('kinisuru', '気にする')], spans);
        expect(components.get('kigasuru')).toEqual(['ki', 'suru']);
        expect(components.get('kinisuru')).toEqual(['ki', 'suru']);
    });

    it('does not find a kana spelling inside a token of another word', () => {
        const components = wordComponents([nai, naru, word('sukunai', '少ない'), word('kasanaru', '重なる')], spans);
        expect(components.get('sukunai')).toBeUndefined();
        expect(components.get('kasanaru')).toBeUndefined();
    });

    it('links a single token only to a word of its part of speech', () => {
        const ari = word('ari', '蟻', 'あり', ['n']);
        const aru = word('aru', '有る', 'ある', ['v5r-i', 'vi']);
        const aruPrenoun = word('aru-certain', '或', 'ある', ['adj-pn']);
        const components = wordComponents([ari, aru, aruPrenoun, word('kachiaru', '価値ある'), word('kachiari', '価値あり'), word('aruhi-kana', 'ある日')], spans);
        expect(components.get('kachiaru')).toEqual(['aru']);
        expect(components.get('aruhi-kana')).toEqual(['aru-certain']);
        expect(components.get('kachiari')).toBeUndefined();
    });

    it('links several tokens only when the first fits or the word is an expression', () => {
        const moshi = word('moshi', '若し', 'もし', ['adv']);
        const noyouni = word('noyouni', 'の様に', 'のように', ['exp']);
        const components = wordComponents([moshi, noyouni, word('mimuki', '見向きもしない'), word('tsugi', '次のように')], spans);
        expect(components.get('mimuki')).toBeUndefined();
        expect(components.get('tsugi')).toEqual(['noyouni']);
    });

    it('never links a lone particle by its kana', () => {
        const no = word('no', '乃', 'の', ['prt']);
        const noyouni = word('noyouni', 'の様に', 'のように', ['exp']);
        const components = wordComponents([no, noyouni, word('menomae', '目の前'), word('tsugi', '次のように')], spans);
        expect(components.get('menomae')).toBeUndefined();
        expect(components.get('tsugi')).toEqual(['noyouni']);
    });

    it('never starts a span on an inflection ending', () => {
        const mashite = word('mashite', '況して', 'まして', ['exp', 'adv']);
        const components = wordComponents([mashite, nai, word('douitashimashite', 'どう致しまして'), word('kawaranai', '変わらない'), word('hitsuyounai', '必要ない')], spans);
        expect(components.get('douitashimashite')).toBeUndefined();
        expect(components.get('kawaranai')).toBeUndefined();
        expect(components.get('hitsuyounai')).toEqual(['nai']);
    });

    it('links neither of two words the span fits alike', () => {
        const iru = word('iru', '居る', 'いる', ['v1', 'vi']);
        const iruNeed = word('iru-need', '要る', 'いる', ['v5r', 'vi']);
        const components = wordComponents([iru, iruNeed, word('shitteiru', '知っている')], spans);
        expect(components.get('shitteiru')).toBeUndefined();
        expect(wordComponents([iru, word('shitteiru', '知っている')], spans).get('shitteiru')).toEqual(['iru']);
    });

    it('never links a kana spelling to a whole word', () => {
        const components = wordComponents([suru, word('suru-kana', 'する')], spans);
        expect(components.get('suru-kana')).toBeUndefined();
    });

    it('keeps kanji-spelled matches as they were', () => {
        const components = wordComponents([word('nihon', '日本'), word('nihongo', '日本語'), word('go', '語'), suru], spans);
        expect(components.get('nihongo')).toEqual(['nihon', 'go']);
        expect(components.get('nihon')).toBeUndefined();
    });
});
