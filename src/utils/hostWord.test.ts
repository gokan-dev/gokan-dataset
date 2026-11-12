import { describe, expect, it } from 'vitest';
import type { MorphToken } from './formationMiner';
import { demandsHostForm, hostHead } from './hostWord';

const tok = (surface: string, pos: string, posDetail1 = '*', base = surface, conj = '*'): MorphToken => ({ surface, pos, posDetail1, conj, base });

describe('demandsHostForm', () => {
    it.each([
        'Verb-て form + から',
        'Verb-ない-form + で',
        'Verb-past + きり',
        'Verb-ます stem + 出す',
        'Verb-volitional form + が',
        'Verb-ば-form + いい',
        'Verb-causative form + ください',
    ])('is true for %s', formation => {
        expect(demandsHostForm(formation)).toBe(true);
    });

    it.each([
        'Noun + にわたって',
        'Verb-dictionary form + には及ばない',
        'Verb-casual + としても, い-Adjective + としても',
    ])('is false for %s', formation => {
        expect(demandsHostForm(formation)).toBe(false);
    });
});

describe('hostHead', () => {
    it('finds the verb before a connective て', () => {
        // 宿題 を し て から
        const tokens = [tok('宿題', '名詞'), tok('を', '助詞', '格助詞'), tok('し', '動詞', '自立', 'する'), tok('て', '助詞', '接続助詞'), tok('から', '助詞', '格助詞')];
        expect(hostHead(tokens, 4)).toBe(2);
    });

    it('walks back over auxiliaries and bound verbs', () => {
        // 食べ させ て ください
        const tokens = [tok('食べ', '動詞', '自立', '食べる'), tok('させ', '動詞', '接尾', 'させる'), tok('て', '助詞', '接続助詞'), tok('ください', '動詞', '非自立', 'くださる')];
        expect(hostHead(tokens, 3)).toBe(0);
        // 食べ ない で
        const negative = [tok('食べ', '動詞', '自立', '食べる'), tok('ない', '助動詞'), tok('で', '助詞', '格助詞')];
        expect(hostHead(negative, 2)).toBe(0);
    });

    it('finds an い-adjective', () => {
        const tokens = [tok('高く', '形容詞', '自立', '高い'), tok('て', '助詞', '接続助詞'), tok('も', '助詞', '係助詞')];
        expect(hostHead(tokens, 2)).toBe(0);
    });

    it('is null after a noun, a particle, or nothing', () => {
        const noun = [tok('学生', '名詞'), tok('だ', '助動詞'), tok('から', '助詞', '接続助詞')];
        expect(hostHead(noun, 2)).toBeNull();
        const particle = [tok('駅', '名詞'), tok('から', '助詞', '格助詞')];
        expect(hostHead(particle, 1)).toBeNull();
        expect(hostHead(particle, 0)).toBeNull();
    });
});
