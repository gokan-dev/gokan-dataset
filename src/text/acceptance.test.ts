import { describe, expect, it } from 'vitest';
import { isShown } from './acceptance';

const r = (status: 'imported' | 'corroborated' | 'reviewed' | 'rejected', source: string) => ({ status, source: { source } });

describe('isShown (the acceptance rule)', () => {
    it('shows reviewed and corroborated texts from any source, never a rejected one', () => {
        expect(isShown(r('reviewed', 'jawiktionary'))).toBe(true);
        expect(isShown(r('corroborated', 'wikidata'))).toBe(true);
        expect(isShown(r('rejected', 'zhwiktionary'))).toBe(false);
    });

    it("shows an imported text only from a source reliable on its own", () => {
        expect(isShown(r('imported', 'zhwiktionary'))).toBe(true);
        expect(isShown(r('imported', 'tatoeba-cmn'))).toBe(true);
        expect(isShown(r('imported', 'unihan'))).toBe(true);
        expect(isShown(r('imported', 'jawiktionary'))).toBe(false);
        expect(isShown(r('imported', 'wikidata'))).toBe(false);
        expect(isShown(r('imported', 'gokan'))).toBe(false);
    });
});
