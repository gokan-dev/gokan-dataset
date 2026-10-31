import { describe, it, expect } from 'vitest';
import { estimatedPutCost, overCapMessage, planUploads } from './uploads';

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

    it('sends a run over its cap to the variable that raises it, not to a workflow that does not exist', () => {
        const message = overCapMessage(105_307, 2000);
        expect(message).toContain('105,307 clips are left');
        expect(message).toContain('AUDIO_MAX_UPLOADS');
        expect(message).not.toMatch(/Audio: upload/);
    });

    it('prices the first fill at well under a dollar', () => {
        expect(estimatedPutCost(110_000)).toBeLessThan(1);
    });
});
