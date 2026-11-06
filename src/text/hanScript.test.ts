import { describe, expect, it } from 'vitest';
import { hanScriptOf, isSimplifiedOnly, isTraditionalOnly, parseUnihanVariants, serveChinese, simplifiedForComparison, toSimplified } from './hanScript';

// A few of Unihan 18.0.0's own lines: 電/电 and 飲/饮 are one-to-one, 鍾 has two Simplified forms,
// 机 and 后 are written in both scripts (each lists itself among its variants).
const variants = parseUnihanVariants([
    '# Unihan_Variants.txt',
    'U+96FB\tkSimplifiedVariant\tU+7535',
    'U+7535\tkTraditionalVariant\tU+96FB',
    'U+98F2\tkSimplifiedVariant\tU+996E',
    'U+996E\tkTraditionalVariant\tU+98F2',
    'U+937E\tkSimplifiedVariant\tU+949F U+953A',
    'U+673A\tkSimplifiedVariant\tU+673A',
    'U+673A\tkTraditionalVariant\tU+673A U+6A5F',
    'U+6A5F\tkSimplifiedVariant\tU+673A',
    'U+540E\tkTraditionalVariant\tU+540E U+5F8C',
    'U+5F8C\tkSimplifiedVariant\tU+540E',
    'U+3405\tkSemanticVariant\tU+4E94<kMatthews',
]);

describe('script detection', () => {
    it('tells Traditional-only and Simplified-only characters from those both scripts write', () => {
        expect(isTraditionalOnly('電', variants)).toBe(true);
        expect(isSimplifiedOnly('电', variants)).toBe(true);
        expect(isTraditionalOnly('机', variants) || isSimplifiedOnly('机', variants)).toBe(false);
        expect(isSimplifiedOnly('后', variants)).toBe(false);
        expect(isTraditionalOnly('機', variants)).toBe(true);
    });

    it('classes a text by the characters it uses', () => {
        expect(hanScriptOf('電話', variants)).toBe('hant');
        expect(hanScriptOf('电话', variants)).toBe('hans');
        expect(hanScriptOf('信', variants)).toBe('neutral');
        expect(hanScriptOf('飲/饮', variants)).toBe('mixed');
    });
});

describe('the transform script:hant-to-hans', () => {
    it('replaces each Traditional-only character by its single Simplified variant and keeps the rest', () => {
        expect(toSimplified('電機后', variants)).toBe('电机后');
    });

    it('refuses a character with no single Simplified variant, rather than choose', () => {
        expect(toSimplified('鍾', variants)).toBeUndefined();
        expect(simplifiedForComparison('鍾電', variants)).toBe('鍾电');
    });
});

describe('serveChinese', () => {
    it('serves a text written the same in both scripts in both files, tagged zh', () => {
        const served = serveChinese(['信', '函件'], variants);
        expect(served['zh-hans']).toEqual({ lang: 'zh', values: ['信', '函件'] });
        expect(served['zh-hant']).toEqual({ lang: 'zh', values: ['信', '函件'] });
    });

    it('serves Traditional as written in zh-hant and converted, naming its original, in zh-hans', () => {
        const served = serveChinese(['電', '信'], variants);
        expect(served['zh-hant']).toEqual({ values: ['電', '信'] });
        expect(served['zh-hans']).toEqual({ values: [{ value: '电', derivedFrom: { value: '電', lang: 'zh-hant', transform: 'script:hant-to-hans' } }, '信'] });
        expect(served.converted).toBe(1);
    });

    it('never converts Simplified to Traditional: a Simplified text is in zh-hans only', () => {
        const served = serveChinese(['电'], variants);
        expect(served['zh-hans']).toEqual({ values: ['电'] });
        expect(served['zh-hant']).toBeUndefined();
    });

    it('leaves a text it cannot convert out of zh-hans, and says so', () => {
        const served = serveChinese(['鍾'], variants);
        expect(served['zh-hans']).toBeUndefined();
        expect(served['zh-hant']).toEqual({ values: ['鍾'] });
        expect(served.unconvertible).toBe(true);
    });

    it('converts a mixed text for zh-hans, its original tagged zh, and keeps it out of zh-hant', () => {
        const served = serveChinese(['飲饮'], variants);
        expect(served['zh-hans']?.values).toEqual([{ value: '饮饮', derivedFrom: { value: '飲饮', lang: 'zh', transform: 'script:hant-to-hans' } }]);
        expect(served['zh-hant']).toBeUndefined();
    });
});
