import { describe, it, expect } from 'vitest';
import { formatDuration, formatProgressLine, Progress } from './progress';

describe('Progress', () => {
    it('has no estimate before it has a rate', () => {
        const p = new Progress(100);
        expect(p.secondsLeft()).toBeUndefined();
        p.tick(0, 0);
        expect(p.secondsLeft()).toBeUndefined();
    });

    it('estimates the time left from the rate so far', () => {
        const p = new Progress(100);
        p.tick(0, 0);
        p.tick(10, 10_000);
        expect(p.rate()).toBe(1);
        expect(p.secondsLeft()).toBe(90);
    });

    it('follows the recent rate, not the start of the run', () => {
        const p = new Progress(1000, 0, 60_000);
        p.tick(0, 0);
        p.tick(10, 60_000);
        p.tick(130, 120_000);
        p.tick(250, 180_000);
        expect(p.rate()).toBe(2);
    });

    it('starts from what earlier runs did', () => {
        const p = new Progress(100, 40);
        p.tick(40, 0);
        p.tick(50, 10_000);
        expect(p.secondsLeft()).toBe(50);
    });
});

describe('formatDuration / formatProgressLine', () => {
    it('reads as hours and minutes', () => {
        expect(formatDuration(16 * 3600 + 5 * 60)).toBe('16 h 05 min');
        expect(formatDuration(125)).toBe('2 min');
        expect(formatDuration(42)).toBe('42 s');
        expect(formatDuration(undefined)).toBe('estimating...');
    });

    it('shows done, rate, time left and disk', () => {
        const p = new Progress(107_408);
        p.tick(0, 0);
        p.tick(1000, 500_000);
        expect(formatProgressLine(p, 4_500_000)).toBe('1,000 / 107,408 (0.9%)  ·  2.00 clips/s  ·  14 h 46 min left  ·  5 MB on disk');
    });
});
