import { describe, expect, it } from 'vitest';
import type { MorphToken } from './formationMiner';
import { hostFormOf, rulesOut } from './attachment';
import type { AttachmentEvidence, HostForm } from './attachment';

const tok = (surface: string, pos: string, posDetail1 = '*', base = surface, conj = '*'): MorphToken => ({ surface, pos, posDetail1, conj, base });

describe('hostFormOf', () => {
    it('names the forms a marker can be tied to', () => {
        expect(hostFormOf(tok('て', '助詞', '接続助詞'))).toBe('te');
        expect(hostFormOf(tok('う', '助動詞'))).toBe('volitional');
        expect(hostFormOf(tok('読み', '動詞', '自立', '読む', '連用形'))).toBe('stem');
        // 立ってたまらない: the stem before a marker that opens with て.
        expect(hostFormOf(tok('立っ', '動詞', '自立', '立つ', '連用タ接続'))).toBe('stem');
        expect(hostFormOf(tok('なく', '助動詞', '*', 'ない', '連用テ接続'))).toBe('stem');
    });

    it('is "other" for a plain form, a noun or a particle', () => {
        expect(hostFormOf(tok('降る', '動詞', '自立', '降る', '基本形'))).toBe('other');
        expect(hostFormOf(tok('た', '助動詞', '*', 'た', '基本形'))).toBe('other');
        expect(hostFormOf(tok('雨', '名詞', '一般'))).toBe('other');
        expect(hostFormOf(tok('から', '助詞', '格助詞'))).toBe('other');
    });
});

describe('rulesOut', () => {
    const sibling = (formation: string, observed: HostForm[], markers: string[] = ['x']): AttachmentEvidence =>
        ({ formation, observed: new Set(observed), markers });

    it('rules out a sibling that never shows the marked form before the blank', () => {
        // 雨が降ろう＿: にしろ follows a plain form, never a volitional.
        expect(rulesOut('volitional', sibling('Verb-casual + にしろ', ['other'], ['にしろ']))).toBe(true);
        expect(rulesOut('te', sibling('Verb-dictionary form + べからず', ['other'], ['べからず']))).toBe(true);
    });

    it('keeps a sibling whose formation or examples show the form', () => {
        expect(rulesOut('volitional', sibling('Verb-volitional form + が', ['other'], ['が']))).toBe(false);
        expect(rulesOut('te', sibling('Verb + も', ['te'], ['も']))).toBe(false);
    });

    it('concludes nothing from an ordinary form before the blank, unless the sibling is limited to marked forms', () => {
        // 降る＿: "Noun + にせよ" also follows a plain verb, whatever its formation says.
        expect(rulesOut('other', sibling('Noun + にせよ', ['other'], ['にせよ']))).toBe(false);
        expect(rulesOut('other', sibling('Verb-て form + から', ['te'], ['から']))).toBe(true);
        // One example after a plain form is enough to keep it.
        expect(rulesOut('other', sibling('Verb-て form + から', ['te', 'other'], ['から']))).toBe(false);
        // A formation that also names an ordinary attachment is not limited.
        expect(rulesOut('other', sibling('Verb-ます stem + あまり, Noun + のあまり', ['stem'], ['あまり']))).toBe(false);
    });

    it('concludes nothing from a stem before the blank: a verb stem is also a noun', () => {
        // 買い物をし＿: に帰ります is only ever shown after a noun, and しに帰る is valid.
        expect(rulesOut('stem', sibling('Noun + に + 帰ります', ['other'], ['に帰ります']))).toBe(false);
    });

    it('never doubles a て: a marker opening with て is not offered after a て-form', () => {
        expect(rulesOut('te', sibling('Verb-ます stem + ても', ['stem'], ['ても']))).toBe(false);
        expect(rulesOut('te', sibling('Verb-casual + にしろ', ['other'], ['にしろ']))).toBe(true);
    });

    it('never rules out on missing evidence', () => {
        expect(rulesOut(null, sibling('Verb-casual + にしろ', ['other']))).toBe(false);
        expect(rulesOut('volitional', sibling('Verb-casual + にしろ', []))).toBe(false);
    });
});
