import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readReviews } from './reviewFiles';

describe('the review files', () => {
    it('reads every file of the directory, and nothing when there is none', () => {
        expect(readReviews(path.join(os.tmpdir(), 'gokan-no-reviews-here'))).toEqual({ reviews: { verdicts: [], gold: [], notes: [] }, problems: [] });
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gokan-reviews-'));
        try {
            const note = { word: '1', headword: '手紙', lang: 'zh-hans', value: '不是手纸', by: 'a', basis: 'b', date: '2026-11-06', confidence: 'low' };
            fs.writeFileSync(path.join(dir, 'notes-zh-hans.jsonl'), `${JSON.stringify(note)}\n`);
            fs.writeFileSync(path.join(dir, 'notes.txt'), '');
            const { reviews, problems } = readReviews(dir);
            expect(reviews.notes).toEqual([note]);
            expect(problems).toEqual(['data/reviews/notes.txt: not a review file (<lang>.jsonl, gold-<lang>.jsonl or notes-<lang>.jsonl)']);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('reads the repository\'s own reviews without a problem', () => {
        const { reviews, problems } = readReviews('./data/reviews');
        expect(problems).toEqual([]);
        expect(reviews.gold.length).toBeGreaterThan(0);
    });
});
