import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SyncedTree } from './syncedTree';

function compiled(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synced-tree-'));
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), content);
    }
    return root;
}

/** Every file under the root, with its content. */
function contents(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (rel: string): void => {
        for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
            const child = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(child);
            else out[child] = fs.readFileSync(path.join(root, child), 'utf8');
        }
    };
    walk('');
    return out;
}

describe('SyncedTree', () => {
    it('ends with exactly what the run produced, as a tree emptied first would', () => {
        const root = compiled({ 'vocab/1.json': 'old', 'vocab/2.json': 'same', 'vocab/3.json': 'gone', 'grammar/mined/x.json': 'gone' });
        const out = new SyncedTree(root);
        out.write('vocab/1.json', 'new');
        out.write('vocab/2.json', 'same');
        out.write('text/zh-hans/vocab/1.json', 'added');
        expect(out.prune()).toBe(2);
        expect(contents(root)).toEqual({ 'vocab/1.json': 'new', 'vocab/2.json': 'same', 'text/zh-hans/vocab/1.json': 'added' });
        expect(fs.existsSync(path.join(root, 'grammar'))).toBe(false);
        expect({ written: out.written, unchanged: out.unchanged }).toEqual({ written: 2, unchanged: 1 });
    });

    it('leaves an unchanged file untouched on disk', () => {
        const root = compiled({ 'kanji.json': '[]' });
        const file = path.join(root, 'kanji.json');
        const past = new Date('2020-01-01T00:00:00Z');
        fs.utimesSync(file, past, past);
        const out = new SyncedTree(root);
        out.write('kanji.json', '[]');
        expect(fs.statSync(file).mtime.getTime()).toBe(past.getTime());
    });

    it('rewrites a file of the same length whose bytes differ', () => {
        const root = compiled({ 'a.json': 'abc' });
        new SyncedTree(root).write('a.json', 'abd');
        expect(fs.readFileSync(path.join(root, 'a.json'), 'utf8')).toBe('abd');
    });

    it('copies a file, and never prunes what other stages own', () => {
        const root = compiled({ 'schemas/vocab.json': 's', 'datapackage.json': 'd', 'media/old.json': 'o' });
        const source = path.join(compiled({ 'm.json': 'media' }), 'm.json');
        const out = new SyncedTree(root, ['schemas', 'datapackage.json']);
        out.copy(source, 'media/m.json');
        out.prune();
        expect(contents(root)).toEqual({ 'schemas/vocab.json': 's', 'datapackage.json': 'd', 'media/m.json': 'media' });
    });

    it('replaces a folder where a file now goes', () => {
        const root = compiled({ 'index/search.json/stale.json': 'x' });
        const out = new SyncedTree(root);
        out.write('index/search.json', '[]');
        out.prune();
        expect(contents(root)).toEqual({ 'index/search.json': '[]' });
    });

    it('refuses a path written twice in one run', () => {
        const out = new SyncedTree(compiled({}));
        out.write('a.json', '1');
        expect(() => out.write('a.json', '2')).toThrow(/written twice/);
    });
});
