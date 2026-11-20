import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContentHasher, checkStages, importClosure, planRun, readStamp, removeStamp, stageKey, writeStamp, type KeyParts, type StageSpec } from './stamps';

function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stamps-'));
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), content);
    }
    return root;
}

const stage = (name: string, after: string[] = [], restart?: string[]): StageSpec => ({ name, script: `scripts/${name}.ts`, inputs: [], after, restart });

describe('ContentHasher', () => {
    it('hashes a directory by its files paths and contents, and a missing path as absent', () => {
        const root = tree({ 'data/a.json': '1', 'data/sub/b.json': '2' });
        const hash = (): string => new ContentHasher(root).paths(['data', 'missing.json']);
        const before = hash();
        expect(hash()).toBe(before);

        fs.writeFileSync(path.join(root, 'data/sub/b.json'), '3');
        const edited = hash();
        expect(edited).not.toBe(before);

        fs.renameSync(path.join(root, 'data/sub/b.json'), path.join(root, 'data/sub/c.json'));
        expect(hash()).not.toBe(edited);

        const renamed = hash();
        fs.writeFileSync(path.join(root, 'missing.json'), '');
        expect(hash()).not.toBe(renamed);
    });

    it('leaves out excluded paths, and rereads a file once forgotten', () => {
        const root = tree({ 'compiled/a.json': '1', 'compiled/schemas/s.json': 'x' });
        const hasher = new ContentHasher(root);
        const before = hasher.paths(['compiled'], ['compiled/schemas']);
        fs.writeFileSync(path.join(root, 'compiled/schemas/s.json'), 'y');
        expect(hasher.paths(['compiled'], ['compiled/schemas'])).toBe(before);

        fs.writeFileSync(path.join(root, 'compiled/a.json'), '2');
        expect(hasher.paths(['compiled'], ['compiled/schemas'])).toBe(before);
        hasher.forget('compiled');
        expect(hasher.paths(['compiled'], ['compiled/schemas'])).not.toBe(before);
    });
});

describe('importClosure', () => {
    it('follows relative imports through .ts, index.ts and JSON, and ignores packages', () => {
        const root = tree({
            'scripts/main.ts': "import fs from 'node:fs';\nimport { a } from './lib';\nimport {\n    b,\n} from \"../src/b\";\nimport labels from './labels.json';\n",
            'scripts/lib/index.ts': "export { c } from '../../src/c';\nexport const a = 1;\n",
            'scripts/labels.json': '{}',
            'src/b.ts': "import type { C } from './c';\nexport const b = 2;\n",
            'src/c.ts': 'export const c = 3;\n',
            'src/unused.ts': '',
        });
        expect(importClosure(root, 'scripts/main.ts')).toEqual(['scripts/labels.json', 'scripts/lib/index.ts', 'scripts/main.ts', 'src/b.ts', 'src/c.ts']);
    });

    it('fails on an import it cannot resolve', () => {
        const root = tree({ 'scripts/main.ts': "import { x } from './gone';\n" });
        expect(() => importClosure(root, 'scripts/main.ts')).toThrow(/cannot resolve the import \.\/gone/);
    });
});

describe('stageKey', () => {
    const parts: KeyParts = { spec: stage('data', ['kanji']), environment: 'bun 1', code: 'c', inputs: 'i', after: { kanji: 'run-1' } };

    it('changes with every part, and only with them', () => {
        const key = stageKey(parts);
        expect(stageKey({ ...parts })).toBe(key);
        expect(stageKey({ ...parts, environment: 'bun 2' })).not.toBe(key);
        expect(stageKey({ ...parts, code: 'd' })).not.toBe(key);
        expect(stageKey({ ...parts, inputs: 'j' })).not.toBe(key);
        expect(stageKey({ ...parts, after: { kanji: 'run-2' } })).not.toBe(key);
        expect(stageKey({ ...parts, after: { kanji: null } })).not.toBe(key);
        expect(stageKey({ ...parts, spec: { ...parts.spec, inputs: ['data/raw/x.json'] } })).not.toBe(key);
    });
});

describe('stamps on disk', () => {
    it('round-trips, and reads a removed or malformed stamp as none', () => {
        const dir = path.join(tree({}), '.stamps');
        expect(readStamp(dir, 'kanji')).toBeNull();
        writeStamp(dir, 'kanji', { key: 'k', tracked: '', run: 'r' });
        expect(readStamp(dir, 'kanji')).toEqual({ key: 'k', tracked: '', run: 'r' });
        removeStamp(dir, 'kanji');
        expect(readStamp(dir, 'kanji')).toBeNull();
        fs.writeFileSync(path.join(dir, 'data.json'), '{"key":"k"}');
        expect(readStamp(dir, 'data')).toBeNull();
    });
});

describe('planRun', () => {
    // kanji -> data -> text (text rewrites data's and kanji's files) -> grammar -> layout; schemas apart.
    const stages = [stage('kanji'), stage('data', ['kanji']), stage('text', ['data'], ['kanji', 'data']), stage('grammar', ['text']), stage('layout', ['grammar']), stage('schemas')];
    const all = new Set(stages.map(s => s.name));
    const plan = (stale: string[], selected: ReadonlySet<string> = all): string[] => planRun(stages, selected, s => stale.includes(s.name)).map(s => s.name);

    it('runs nothing when every stamp is current', () => {
        expect(plan([])).toEqual([]);
    });

    it('runs a stale stage and every stage reading its output, but not those before it', () => {
        expect(plan(['grammar'])).toEqual(['grammar', 'layout']);
        expect(plan(['schemas'])).toEqual(['schemas']);
    });

    it('restarts the creators of the files a stale stage rewrites, and then everything after them', () => {
        expect(plan(['text'])).toEqual(['kanji', 'data', 'text', 'grammar', 'layout']);
    });

    it('restarts from a stage that is stale only because its upstream runs', () => {
        expect(plan(['data'])).toEqual(['kanji', 'data', 'text', 'grammar', 'layout']);
    });

    it('never runs a stage outside the selection, nor restarts one', () => {
        expect(plan(['text'], new Set(['text', 'grammar']))).toEqual(['text', 'grammar']);
        expect(plan(['kanji'], new Set(['grammar']))).toEqual([]);
    });
});

describe('checkStages', () => {
    it('accepts a pipeline naming only earlier stages', () => {
        expect(() => checkStages([stage('kanji'), stage('data', ['kanji'], ['kanji'])])).not.toThrow();
    });

    it('refuses a later or unknown stage, and a name declared twice', () => {
        expect(() => checkStages([stage('data', ['kanji']), stage('kanji')])).toThrow(/data names kanji/);
        expect(() => checkStages([stage('kanji'), stage('data', [], ['typo'])])).toThrow(/data names typo/);
        expect(() => checkStages([stage('kanji'), stage('kanji')])).toThrow(/declared twice/);
    });
});
