import { describe, expect, it } from 'vitest';
import type { Label } from '../models/text.model';
import { parseUnihanVariants } from './hanScript';
import { labelsOf } from './renderings';
import { parseMandarinReadings, PINYIN, unihanText } from './unihan';

const variants = parseUnihanVariants([
    'U+96FB\tkSimplifiedVariant\tU+7535',
    'U+7535\tkTraditionalVariant\tU+96FB',
    'U+53F0\tkTraditionalVariant\tU+53F0 U+6AAF U+81FA U+98B1',
]);
const mandarin = parseMandarinReadings(['# Unihan_Readings.txt', 'U+96FB\tkMandarin\tdiàn', 'U+4E7E\tkMandarin\tqián gān', 'U+96FB\tkCantonese\tdin6']);

describe('Unihan labels', () => {
    it('reads the Mandarin readings, the most frequent first', () => {
        expect(mandarin.get('乾')).toEqual(['qián', 'gān']);
        expect(mandarin.get('電')).toEqual(['diàn']);
    });

    it("labels a kanji with its Simplified form in zh-hans and its pinyin in both, matched by id", () => {
        const text = unihanText('電', variants, mandarin);
        expect(labelsOf(text, 'zh-hans', { field: 'simplifiedForm' })).toEqual(['电']);
        expect(labelsOf(text, 'zh-hant', { field: 'simplifiedForm' })).toEqual([]);
        const reading = text['zh-hant']?.renderings.find((r): r is Label => r.role === 'label' && r.field === 'mandarinReading');
        expect(reading).toMatchObject({ lang: PINYIN, value: 'diàn', match: 'id', source: { source: 'unihan', ref: '電' } });
    });

    it('gives no variant form to a kanji both scripts write (台 is its own Traditional form too)', () => {
        expect(unihanText('台', variants, mandarin)).toEqual({});
        expect(labelsOf(unihanText('电', variants, mandarin), 'zh-hant', { field: 'traditionalForm' })).toEqual(['電']);
    });
});
