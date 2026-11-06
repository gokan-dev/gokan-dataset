import { describe, expect, it } from 'vitest';
import { contrastCaseId, grammarExampleId, grammarLabel, grammarProse, grammarTranslation } from './grammarText';

describe('grammar renderings', () => {
    it("marks Gokan's own text reviewed and an imported source's text imported, both matched by id", () => {
        const gokan = grammarLabel('grammar', 'n5-901', 'en', 'name', 'Polite present', { source: 'gokan', ref: 'n5-901' });
        const hanabira = grammarProse('grammar', 'n5-001', 'en', 'formation', 'Noun + が', { source: 'hanabira', ref: 'n5-001' });
        expect(gokan).toMatchObject({ role: 'label', field: 'name', status: 'reviewed', match: 'id', source: { source: 'gokan', ref: 'n5-901' } });
        expect(hanabira).toMatchObject({ role: 'prose', field: 'formation', status: 'imported', value: 'Noun + が' });
    });

    it('leaves out a label field it was not given, so a main label stays the unfielded one', () => {
        expect(grammarLabel('grammarSlot', 'noun', 'en', undefined, 'Noun', { source: 'gokan', ref: 'noun' })).not.toHaveProperty('field');
    });

    it('identifies a translation by what it says and where it comes from', () => {
        const a = grammarTranslation('grammar', 'n5-001#x', 'en', 'A.', { source: 'hanabira', ref: 'n5-001' });
        const b = grammarTranslation('grammar', 'n5-001#x', 'en', 'A.', { source: 'gokan', ref: 'n5-001' });
        expect(a.id).not.toBe(b.id);
        expect(grammarTranslation('grammar', 'n5-001#x', 'en', 'A.', { source: 'hanabira', ref: 'n5-001' }).id).toBe(a.id);
    });
});

describe('grammarExampleId', () => {
    it('names an example by its point and its sentence, not its position', () => {
        const id = grammarExampleId('n5-001', '私が一番です。');
        expect(id).toMatch(/^n5-001#[0-9a-f]{12}$/);
        expect(grammarExampleId('n5-001', '私が一番です。')).toBe(id);
        expect(grammarExampleId('n5-002', '私が一番です。')).not.toBe(id);
        expect(grammarExampleId('n5-001', '彼が一番です。')).not.toBe(id);
    });
});

describe('contrastCaseId', () => {
    it('names a case by its family, lesson and what it contrasts', () => {
        expect(contrastCaseId('causality', 'reason-core', 'n4-110', ['n5-073', 'n3-004'])).toBe('causality#reason-core/n4-110>n5-073,n3-004');
    });
});
