import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { englishView } from './english';
import { englishFile, englishInputs, englishTextPath } from './englishFile';

const COMPILED_DIR = './compiled';

/** Every module `entry` reaches through value imports (type-only imports are erased), relative to src/. */
function valueImports(entry: string): Map<string, string[]> {
    const seen = new Map<string, string[]>();
    const visit = (file: string): void => {
        if (seen.has(file)) return;
        const source = fs.readFileSync(file, 'utf8');
        const specifiers = [...source.matchAll(/^(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gms)]
            .filter(m => !m[1])
            .map(m => m[2]);
        seen.set(file, specifiers);
        for (const s of specifiers) if (s.startsWith('.')) visit(path.resolve(path.dirname(file), `${s}.ts`));
    };
    visit(path.resolve(entry));
    return seen;
}

describe('englishFile', () => {
    it('imports nothing from node: anywhere below it, so it runs in a browser', () => {
        const offenders = [...valueImports('src/layout/englishFile.ts')]
            .flatMap(([file, specifiers]) => specifiers.filter(s => s.startsWith('node:') || !s.startsWith('.')).map(s => `${path.relative('.', file)}: ${s}`));
        expect(offenders).toEqual([]);
    });

    it('fails loudly when a declared shared input is not given', () => {
        expect(() => englishFile('grammar/index/variant-groups.json', { core: {} })).toThrow(/declared shared input/);
    });
});

describe('englishInputs', () => {
    it('names a file, its English text and its shared files', () => {
        expect(englishInputs('vocab/1358280.json')).toEqual({ core: 'vocab/1358280.json', text: 'text/en/vocab/1358280.json', shared: [] });
        expect(englishInputs('grammar/points/n5-001.json')).toEqual({
            core: 'grammar/points/n5-001.json', text: 'text/en/grammar/points/n5-001.json', shared: ['grammar/slots.json', 'text/en/grammar/slots.json'],
        });
        expect(englishInputs('grammar/index/variant-groups.json')).toEqual({ core: 'grammar/index/variant-groups.json', shared: ['text/en/grammar/index/browse.json'] });
    });

    it('names only the core for a file the view copies', () => {
        expect(englishInputs('index/frequency.json')).toEqual({ core: 'index/frequency.json', shared: [] });
        expect(englishInputs('media/library.json')).toEqual({ core: 'media/library.json', shared: [] });
    });

    it('finds every declared English text in the compiled output, so a reader treats a missing one as an error', () => {
        const missing = englishView(COMPILED_DIR).files()
            .filter(f => f.endsWith('.json'))
            .flatMap(f => {
                const { text, shared } = englishInputs(f);
                return [...(text ? [text] : []), ...shared].filter(p => !fs.existsSync(path.join(COMPILED_DIR, p)));
            });
        expect([...new Set(missing)]).toEqual([]);
        expect(englishTextPath('kanji.json')).toBe('text/en/kanji.json');
    }, 120_000);
});
