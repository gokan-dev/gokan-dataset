import { describe, it, expect } from 'vitest';
import { isLfsPointer, lfsIncludes } from './lfs';

describe('isLfsPointer', () => {
    it('tells a pointer file from a clip', () => {
        expect(isLfsPointer('version https://git-lfs.github.com/spec/v1\noid sha256:ab\nsize 12\n')).toBe(true);
        expect(isLfsPointer('OggS\u0000\u0002')).toBe(false);
        expect(isLfsPointer('')).toBe(false);
    });
});

describe('lfsIncludes', () => {
    const paths = Array.from({ length: 10 }, (_, i) => `data/audio/clips/${String(i).padStart(16, '0')}.opus`);

    it('names each file, in lists that fit one command line', () => {
        const lists = lfsIncludes(paths, 'data/audio/clips', 5000, 120);
        expect(lists.every(l => l.length <= 120)).toBe(true);
        expect(lists.flatMap(l => l.split(','))).toEqual(paths);
    });

    it('fetches the whole folder when most of it is wanted', () => {
        expect(lfsIncludes(paths, 'data/audio/clips', 5)).toEqual(['data/audio/clips/**']);
    });

    it('fetches nothing for no files', () => {
        expect(lfsIncludes([], 'data/audio/clips')).toEqual([]);
    });
});
