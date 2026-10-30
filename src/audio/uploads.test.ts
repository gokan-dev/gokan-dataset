import { describe, it, expect } from 'vitest';
import { estimatedPutCost, planUploads } from './uploads';

describe('planUploads', () => {
    it('writes only keys the bucket lacks, each once', () => {
        const plan = planUploads(['a', 'b', 'b', 'c'], new Set(['a']), 100);
        expect(plan.write).toEqual(['b', 'c']);
        expect(plan.alreadyThere).toBe(1);
        expect(plan.overCap).toBe(0);
    });

    it('stops at the cap and says how many are left', () => {
        const plan = planUploads(['a', 'b', 'c', 'd'], new Set(), 2);
        expect(plan.write).toHaveLength(2);
        expect(plan.overCap).toBe(2);
    });

    it('writes nothing for a bucket that already has every clip', () => {
        expect(planUploads(['a', 'b'], new Set(['a', 'b']), 1000).write).toEqual([]);
    });

    it('prices the first fill at well under a dollar', () => {
        expect(estimatedPutCost(110_000)).toBeLessThan(1);
    });
});
