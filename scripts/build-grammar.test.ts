import { describe, it, expect } from 'vitest';
import { splitTitle, compileContrasts, duplicateTopLevelKeys, type AuthoredContrastLesson } from './build-grammar';
import type { TextByLanguage } from '../src/models/text.model';
import { contrastCaseId, grammarLabel } from '../src/text/grammarText';
import { labelsOf, proseOf } from '../src/text/renderings';

describe('duplicateTopLevelKeys', () => {
    it('finds a point listed twice, which JSON.parse would silently collapse to the last entry', () => {
        const text = '{\n  "n4-070": {\n    "removeExamples": []\n  },\n  "n3-024": {},\n  "n4-070": {\n    "examples": []\n  }\n}\n';
        expect(duplicateTopLevelKeys(text)).toEqual(['n4-070']);
    });
    it('ignores nested keys that repeat across entries', () => {
        const text = '{\n  "a": { "note": "x" },\n  "b": {\n    "note": "y"\n  }\n}\n';
        expect(duplicateTopLevelKeys(text)).toEqual([]);
    });
});

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

describe('compileContrasts', () => {
    const named = (id: string, name: string): TextByLanguage => ({ en: { renderings: [grammarLabel('family', id, 'en', 'family', name, { source: 'gokan', ref: id })] } });
    const familyMembers = new Map([
        ['causality', { text: named('causality', 'Causality (Because / Since / Due to)'), ids: ['n5-073', 'n4-110', 'n3-004', 'n2-139'] }],
        ['regardless-a-or-b', { text: named('regardless-a-or-b', 'Regardless (Whether A or B)'), ids: ['n1-100', 'n1-101'] }],
        ['big', { text: named('big', 'Big family'), ids: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'] }],
    ]);
    const axisOf = (id: string): string | undefined =>
        id.startsWith('n1-10') ? 'variant' : 'register';

    const lesson = (over: Partial<AuthoredContrastLesson> = {}): AuthoredContrastLesson => ({
        id: 'reason-core',
        title: 'から / ので',
        points: ['n5-073', 'n4-110'],
        cases: [{ focus: 'n4-110', vs: ['n5-073'], situation: 'Apologising.', guidance: 'Use ので.' }],
        ...over,
    });

    it('compiles a valid family, attaches the family name, and counts cases', () => {
        const { index, caseCount } = compileContrasts(
            { causality: { lessons: [lesson()] } },
            familyMembers,
            axisOf,
            'en',
        );
        expect(caseCount).toBe(1);
        expect(labelsOf(index.causality.text, 'en', { field: 'family' })).toEqual(['Causality (Because / Since / Due to)']);
        expect(index.causality.text).toBe(familyMembers.get('causality')?.text);
        expect(index.causality.lessons[0].cases[0].focus).toBe('n4-110');
    });

    it("writes a case's situation and guidance as Gokan's prose, identified by what the case contrasts", () => {
        const { index } = compileContrasts({ causality: { lessons: [lesson()] } }, familyMembers, axisOf, 'en');
        const case_ = index.causality.lessons[0].cases[0];
        expect(proseOf(case_.text, 'en', 'situation')).toBe('Apologising.');
        expect(proseOf(case_.text, 'en', 'guidance')).toBe('Use ので.');
        const [situation] = case_.text.en?.renderings ?? [];
        expect(situation?.source).toEqual({ source: 'gokan', ref: contrastCaseId('causality', 'reason-core', 'n4-110', ['n5-073']) });
        expect(situation?.status).toBe('reviewed');
        expect(case_).not.toHaveProperty('situation');
    });

    it('refuses two cases contrasting the same points in one lesson, which would share an id', () => {
        const twice = lesson({ cases: [{ focus: 'n4-110', vs: ['n5-073'], situation: 'a', guidance: 'b' }, { focus: 'n4-110', vs: ['n5-073'], situation: 'c', guidance: 'd' }] });
        expect(() => compileContrasts({ causality: { lessons: [twice] } }, familyMembers, axisOf, 'en')).toThrow(/two cases/);
    });

    it('applies the sanitiser to label, situation, and guidance', () => {
        const shout = (s: string) => s.toUpperCase();
        const { index } = compileContrasts(
            { causality: { lessons: [lesson()] } },
            familyMembers,
            axisOf,
            'en',
            shout,
        );
        const u = index.causality.lessons[0].cases[0];
        expect(index.causality.lessons[0].title).toBe('から / ので');
        expect(proseOf(u.text, 'en', 'situation')).toBe('APOLOGISING.');
        expect(proseOf(u.text, 'en', 'guidance')).toBe('USE ので.');
    });

    it('throws on an unknown family', () => {
        expect(() => compileContrasts({ nope: { lessons: [lesson()] } }, familyMembers, axisOf, 'en'))
            .toThrow(/unknown family "nope"/);
    });

    it('throws when a focus/vs id is not a member of the family', () => {
        expect(() => compileContrasts(
            { causality: { lessons: [lesson({ cases: [{ focus: 'n4-110', vs: ['n5-999'], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
            'en',
        )).toThrow(/"n5-999", which is not a \(non-dropped\) member/);
    });

    it("throws when a lesson touches a 'variant'-axis point", () => {
        expect(() => compileContrasts(
            { 'regardless-a-or-b': { lessons: [lesson({ points: ['n1-100', 'n1-101'], cases: [{ focus: 'n1-100', vs: ['n1-101'], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
            'en',
        )).toThrow(/axis 'variant'/);
    });

    it('throws when a lesson references a family member outside its own lesson (lesson must be a subset of its lesson)', () => {
        // n3-004 is a real causality member, but not in this lesson's points.
        expect(() => compileContrasts(
            { causality: { lessons: [lesson({ points: ['n5-073', 'n4-110'], cases: [{ focus: 'n4-110', vs: ['n3-004'], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
            'en',
        )).toThrow(/has a case naming/);
    });

    it('warns (but does not throw) when a lesson exceeds the soft cap', () => {
        const warnings: string[] = [];
        const { caseCount } = compileContrasts(
            { big: { lessons: [lesson({ id: 'big-lesson', points: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'], cases: [{ focus: 'b2', vs: ['b1'], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
            'en',
            undefined,
            (m) => warnings.push(m),
        );
        expect(caseCount).toBe(1);
        expect(warnings.some(w => /soft cap/.test(w))).toBe(true);
    });

    it('throws when focus lists itself in vs', () => {
        expect(() => compileContrasts(
            { causality: { lessons: [lesson({ cases: [{ focus: 'n4-110', vs: ['n4-110'], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
            'en',
        )).toThrow(/lists itself in vs/);
    });

    it('throws on an empty vs list', () => {
        expect(() => compileContrasts(
            { causality: { lessons: [lesson({ cases: [{ focus: 'n4-110', vs: [], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
            'en',
        )).toThrow(/empty vs list/);
    });

    it('throws when situation or guidance is blank', () => {
        expect(() => compileContrasts(
            { causality: { lessons: [lesson({ cases: [{ focus: 'n4-110', vs: ['n5-073'], situation: '  ', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
            'en',
        )).toThrow(/missing situation or guidance/);
    });

    it('lists a variant family as interchangeable even with no authored lesson', () => {
        // The whole point of the interchangeable list: a family that can never
        // carry a lesson still has to say so, rather than being absent entirely.
        const { index, caseCount } = compileContrasts({}, familyMembers, axisOf, 'en');
        expect(caseCount).toBe(0);
        expect(index['regardless-a-or-b'].lessons).toEqual([]);
        expect(index['regardless-a-or-b'].interchangeable).toEqual(['n1-100', 'n1-101']);
        // A family with no variant members is not listed at all.
        expect(index.causality).toBeUndefined();
    });

    it('merges the interchangeable list onto a family that also has lessons', () => {
        const { index } = compileContrasts(
            { causality: { lessons: [lesson()] } },
            familyMembers,
            axisOf,
            'en',
        );
        expect(index.causality.interchangeable).toBeUndefined();
        expect(index['regardless-a-or-b'].interchangeable).toHaveLength(2);
    });
});
