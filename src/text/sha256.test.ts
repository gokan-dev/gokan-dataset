import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

const native = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('sha256Hex', () => {
    it('matches the published test vectors', () => {
        expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    });

    it('matches node:crypto on Japanese and on every length around the block boundaries', () => {
        for (const text of ['食べる', '日本語の文です。', '🍣 寿司', 'naïve café']) expect(sha256Hex(text)).toBe(native(text));
        for (let n = 0; n <= 200; n++) {
            const text = 'あa'.repeat(n).slice(0, n);
            expect(sha256Hex(text), `length ${n}`).toBe(native(text));
        }
    });

    it('matches node:crypto on the ids the build hashes', () => {
        const ids = [JSON.stringify(['vocab', '1358280', 'en', { role: 'definition', senses: [{ glosses: ['to eat'] }] }]), 'n5-001: 私は学生です。'];
        for (const text of ids) expect(sha256Hex(text)).toBe(native(text));
    });
});
