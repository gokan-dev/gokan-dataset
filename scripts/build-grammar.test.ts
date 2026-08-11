import { describe, it, expect } from 'vitest';
import { splitTitle } from './build-grammar';

describe('splitTitle', () => {
    it('splits the common case: trailing single-level parenthetical', () => {
        expect(splitTitle('～けど、～ (〜kedo、～)')).toEqual({ title: '～けど、～', romaji: '〜kedo、～' });
    });

    it('splits a title with placeholders and punctuation in the romaji', () => {
        expect(splitTitle('A。けれども、～B。(A. Keredomo,~ B.)')).toEqual({
            title: 'A。けれども、～B。',
            romaji: 'A. Keredomo,~ B.',
        });
    });

    it('finds the OUTERMOST trailing paren pair when the romaji itself contains nested parens (n1-113)', () => {
        expect(splitTitle('Verbる / Noun(である) + 限り(は) (kagiri (wa))')).toEqual({
            title: 'Verbる / Noun(である) + 限り(は)',
            romaji: 'kagiri (wa)',
        });
    });

    it('handles a full-width opening paren mismatched with a half-width closing one (n1-073)', () => {
        expect(splitTitle('Noun + ぬいて（~nuite)')).toEqual({ title: 'Noun + ぬいて', romaji: '~nuite' });
    });

    it('falls back to the full original string when there is no trailing parenthetical at all', () => {
        expect(splitTitle('～なら～なりに')).toEqual({ title: '～なら～なりに' });
    });

    it('falls back to the full original string when the parenthetical sits mid-string rather than at the end', () => {
        expect(splitTitle('そんな (sonna) + Noun')).toEqual({ title: 'そんな (sonna) + Noun' });
    });

    it('falls back when parens are unbalanced', () => {
        expect(splitTitle('foo (bar')).toEqual({ title: 'foo (bar' });
    });

    it('falls back when the trailing parenthetical is empty', () => {
        expect(splitTitle('foo ()')).toEqual({ title: 'foo ()' });
    });
});
