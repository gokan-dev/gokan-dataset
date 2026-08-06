import { describe, it, expect } from 'vitest';
import { locatePattern } from './grammar-pattern-matcher';
import type { GrammarExampleWord } from '../src/models/grammar.model';

function w(surface: string, baseForm?: string, reading?: string): GrammarExampleWord {
    return { surface, vocabId: null, baseForm, reading };
}

describe('locatePattern', () => {
    it('locates single-token literals (n5-001: Noun + が + いちばん + Adjective/Verb)', () => {
        // この中で、寿司が一番好きです。
        const words = [w('この'), w('中'), w('で'), w('、'), w('寿司'), w('が'), w('一番', undefined, 'いちばん'), w('好き'), w('です'), w('。')];
        const hit = locatePattern('Noun + が + いちばん + Adjective/Verb', words);
        expect(hit).toEqual([5, 6]); // が, 一番
    });

    it('matches a literal spanning multiple tokens (ともなると split into と|も|なる|と)', () => {
        const words = [w('クリスマス'), w('と'), w('も'), w('なる', 'なる'), w('と'), w('、')];
        const hit = locatePattern('Noun + ともなると', words);
        expect(hit).toEqual([1, 2, 3, 4]);
    });

    it('matches a dictionary-form literal against a conjugated token via baseForm', () => {
        // 彼がプレゼントを私にくれました。 - literal "くれる" vs conjugated token "くれ"
        const words = [w('彼'), w('が'), w('プレゼント'), w('を'), w('私'), w('に'), w('くれ', 'くれる'), w('まし', 'ます'), w('た')];
        const hit = locatePattern('Person + が + Thing + 私に + くれる', words);
        expect(hit).toContain(6); // くれ (baseForm くれる)
    });

    it('strips parenthetical asides so they are not required as extra occurrences', () => {
        // "にせよ" appears 3x in the formation text (2x in the main pattern, 1x in
        // a parenthetical aside) but the sentence only has 2 real occurrences.
        const words = [w('雨'), w('に'), w('せよ'), w('雪'), w('に'), w('せよ'), w('、')];
        const hit = locatePattern('Noun + にせよ + Noun + にせよ (also works with verbs in dictionary form + にせよ)', words);
        expect(hit).toEqual([1, 2, 4, 5]);
    });

    it('strips conjugation scaffolding ("Verb-ますstem") so it is not treated as a required literal', () => {
        // 彼はそんなに早く走れそうにない。 - "ます" from "Verb-ますstem" must not be
        // required as its own separate literal (there's no standalone ます token here).
        const words = [w('彼'), w('は'), w('そんなに'), w('早く', '早い'), w('走れ', '走れる'), w('そう'), w('に'), w('ない')];
        const hit = locatePattern('Verb-ますstem + そうにない', words);
        expect(hit).toEqual([5, 6, 7]);
    });

    it('tries alternative formation variants and uses the first one that fully matches', () => {
        // 彼は先生に褒められました。 - only the られる (ru-verb) variant should match.
        const words = [w('彼'), w('は'), w('先生'), w('に'), w('褒め', '褒める'), w('られ', 'られる'), w('まし', 'ます'), w('た')];
        const hit = locatePattern('Verb-passive stem + れる / Verb-passive stem + られる', words);
        expect(hit).toEqual([5]);
    });

    it('rejects a partial match that only found a bystander particle, not the distinctive literal', () => {
        // A formation requiring both a generic に and a specific-but-absent literal
        // should not "succeed" on the strength of the generic particle alone.
        const words = [w('彼'), w('に'), w('聞いた')];
        const hit = locatePattern('Noun + に + 尋常でない特殊な表現', words);
        expect(hit).toBeNull();
    });

    it('prefers the longest literal so a short particle cannot claim a fused token before a longer one does', () => {
        // をめぐって tokenizes as ONE fused token; longest-first ensures めぐって
        // (not the bare を) claims it.
        const words = [w('環境'), w('問題'), w('をめぐって'), w('、')];
        const hit = locatePattern('Noun + を + めぐって', words);
        expect(hit).toEqual([2]);
    });

    it('returns null when formation has no Japanese literal at all', () => {
        const words = [w('彼'), w('は'), w('学生'), w('だ')];
        const hit = locatePattern('A: Sentence, B: Sentence (any sentence type)', words);
        expect(hit).toBeNull();
    });

    it('returns null when no example word matches any literal', () => {
        const words = [w('全然'), w('関係'), w('ない')];
        const hit = locatePattern('Noun + が + いちばん', words);
        expect(hit).toBeNull();
    });
});
