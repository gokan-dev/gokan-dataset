import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REMOVE_RETRIES, REMOVE_RETRY_DELAY_MS, removeTree } from './removeTree';

describe('removeTree', () => {
    it('removes a nested tree, and does nothing when it is already gone', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-tree-'));
        fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
        fs.writeFileSync(path.join(root, 'a', 'b', 'c.json'), '{}');
        removeTree(root);
        expect(fs.existsSync(root)).toBe(false);
        expect(() => removeTree(root)).not.toThrow();
    });

    it('waits well beyond Node defaults before giving up on a busy file', () => {
        // Node waits retryDelay x attempt between attempts.
        const totalMs = (REMOVE_RETRY_DELAY_MS * REMOVE_RETRIES * (REMOVE_RETRIES + 1)) / 2;
        expect(totalMs).toBeGreaterThan(120_000);
    });
});
