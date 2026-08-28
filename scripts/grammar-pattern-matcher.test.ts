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

describe('false anchors from formations that alternate inside a slot', () => {
    /** Tokenizes with just the fields locatePattern reads. */
    function words(...specs: [string, string?, string?][]): GrammarExampleWord[] {
        return specs.map(([surface, reading, baseForm]) => ({
            surface, vocabId: null,
            ...(reading ? { reading } : {}),
            ...(baseForm ? { baseForm } : {}),
        }));
    }

    // "は/が" is an alternation INSIDE one slot, but variantsOf splits on "/",
    // producing the junk variant "Noun + は" whose only literal is a bare particle.
    const DOU_DESU_KA = 'Noun + は/が + どうですか / Verb-casual + の + どうですか / い-Adjective + どうですか / な-Adjective + な + どうですか';

    it('anchors どうですか, not the は from the split slot', () => {
        // Reported: 晩ご飯に寿司を食べるのはどうですか？ blanked ご飯.
        const sentence = words(
            ['晩', 'ばん'], ['ご飯', 'ごはん'], ['に'], ['寿司', 'すし'], ['を'],
            ['食べる', 'たべる'], ['の'], ['は'], ['どう'], ['です'], ['か'], ['？'],
        );
        const hit = locatePattern(DOU_DESU_KA, sentence)!;
        expect(hit.map(i => sentence[i].surface).join('')).toBe('どうですか');
    });

    it('never matches a particle inside a word by its READING', () => {
        // ご飯's reading is ごはん, which CONTAINS は - that is how the literal は
        // came to match 晩ご飯's second token.
        const sentence = words(['ご飯', 'ごはん'], ['どう'], ['です'], ['か']);
        const hit = locatePattern(DOU_DESU_KA, sentence)!;
        expect(hit).not.toContain(0);
    });

    it('prefers the real particle over a word that merely contains it', () => {
        // この contains の. Exact matches are considered before containment ones.
        const sentence = words(['この'], ['映画', 'えいが'], ['は'], ['どう'], ['です'], ['か']);
        const hit = locatePattern(DOU_DESU_KA, sentence)!;
        expect(hit.map(i => sentence[i].surface).join('')).toBe('どうですか');
        expect(hit).not.toContain(0);
    });

    it('prefers a partial match on the distinctive marker over a full match on a bare particle', () => {
        // n5-122: the sentences contain no が, so the variant carrying
        // なんと言いますか can only match partially, while the junk "Noun + は"
        // variant matches fully. The distinctive marker must still win.
        const formation = 'Noun + は/が + なんと言いますか';
        const sentence = words(['この'], ['花', 'はな'], ['は'], ['なんと'], ['言います', 'いいます', '言う'], ['か'], ['。']);
        const hit = locatePattern(formation, sentence)!;
        const anchored = hit.map(i => sentence[i].surface).join('');
        expect(anchored).toContain('なんと');
        // 花 was the originally reported false anchor for this point.
        expect(anchored).not.toContain('花');
    });

    it('still anchors a point whose pattern genuinely IS a bare particle', () => {
        // The guards must not gut the simple case: n5-043 is "Noun + を".
        const sentence = words(['本', 'ほん'], ['を'], ['読む', 'よむ']);
        const hit = locatePattern('Noun + を', sentence)!;
        expect(hit.map(i => sentence[i].surface).join('')).toBe('を');
    });

    it('prefers the tighter anchor when two variants recover the same marker', () => {
        // Both "の + どうですか" and bare "どうですか" recover どうですか; the one
        // that does not also drag in a bystander wins.
        const sentence = words(['この'], ['部屋', 'へや'], ['は'], ['どう'], ['です'], ['か']);
        expect(locatePattern(DOU_DESU_KA, sentence)!).toHaveLength(3);
    });
});
