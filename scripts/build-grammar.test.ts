import { describe, it, expect } from 'vitest';
import { splitTitle, compileContrasts } from './build-grammar';
import type { GrammarContrastLesson } from '../src/models/grammar.model';

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
    const familyMembers = new Map([
        ['causality', { name: 'Causality (Because / Since / Due to)', ids: ['n5-073', 'n4-110', 'n3-004', 'n2-139'] }],
        ['regardless-a-or-b', { name: 'Regardless (Whether A or B)', ids: ['n1-100', 'n1-101'] }],
        ['big', { name: 'Big family', ids: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'] }],
    ]);
    const axisOf = (id: string): string | undefined =>
        id.startsWith('n1-10') ? 'variant' : 'register';

    const lesson = (over: Partial<GrammarContrastLesson> = {}): GrammarContrastLesson => ({
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
        );
        expect(caseCount).toBe(1);
        expect(index.causality.name).toBe('Causality (Because / Since / Due to)');
        expect(index.causality.lessons[0].cases[0].focus).toBe('n4-110');
    });

    it('applies the sanitiser to label, situation, and guidance', () => {
        const shout = (s: string) => s.toUpperCase();
        const { index } = compileContrasts(
            { causality: { lessons: [lesson()] } },
            familyMembers,
            axisOf,
            shout,
        );
        const u = index.causality.lessons[0].cases[0];
        expect(index.causality.lessons[0].title).toBe('から / ので');
        expect(u.situation).toBe('APOLOGISING.');
        expect(u.guidance).toBe('USE ので.');
    });

    it('throws on an unknown family', () => {
        expect(() => compileContrasts({ nope: { lessons: [lesson()] } }, familyMembers, axisOf))
            .toThrow(/unknown family "nope"/);
    });

    it('throws when a focus/vs id is not a member of the family', () => {
        expect(() => compileContrasts(
            { causality: { lessons: [lesson({ cases: [{ focus: 'n4-110', vs: ['n5-999'], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
        )).toThrow(/"n5-999", which is not a \(non-dropped\) member/);
    });

    it("throws when a lesson touches a 'variant'-axis point", () => {
        expect(() => compileContrasts(
            { 'regardless-a-or-b': { lessons: [lesson({ points: ['n1-100', 'n1-101'], cases: [{ focus: 'n1-100', vs: ['n1-101'], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
        )).toThrow(/axis 'variant'/);
    });

    it('throws when a lesson references a family member outside its own lesson (lesson must be a subset of its lesson)', () => {
        // n3-004 is a real causality member, but not in this lesson's points.
        expect(() => compileContrasts(
            { causality: { lessons: [lesson({ points: ['n5-073', 'n4-110'], cases: [{ focus: 'n4-110', vs: ['n3-004'], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
        )).toThrow(/has a case naming/);
    });

    it('warns (but does not throw) when a lesson exceeds the soft cap', () => {
        const warnings: string[] = [];
        const { caseCount } = compileContrasts(
            { big: { lessons: [lesson({ id: 'big-lesson', points: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'], cases: [{ focus: 'b2', vs: ['b1'], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
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
        )).toThrow(/lists itself in vs/);
    });

    it('throws on an empty vs list', () => {
        expect(() => compileContrasts(
            { causality: { lessons: [lesson({ cases: [{ focus: 'n4-110', vs: [], situation: 's', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
        )).toThrow(/empty vs list/);
    });

    it('throws when situation or guidance is blank', () => {
        expect(() => compileContrasts(
            { causality: { lessons: [lesson({ cases: [{ focus: 'n4-110', vs: ['n5-073'], situation: '  ', guidance: 'g' }] })] } },
            familyMembers,
            axisOf,
        )).toThrow(/missing situation or guidance/);
    });

    it('lists a variant family as interchangeable even with no authored lesson', () => {
        // The whole point of the interchangeable list: a family that can never
        // carry a lesson still has to say so, rather than being absent entirely.
        const { index, caseCount } = compileContrasts({}, familyMembers, axisOf);
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
        );
        expect(index.causality.interchangeable).toBeUndefined();
        expect(index['regardless-a-or-b'].interchangeable).toHaveLength(2);
    });
});
