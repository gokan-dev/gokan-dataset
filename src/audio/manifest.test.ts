import { describe, it, expect } from 'vitest';
import { applyClip, serializeLike } from './attach';
import { attachableClip, parseManifest, serializeManifest, type ClipManifest } from './manifest';
import { sourceHash, type AudioItem } from './scope';

const item: AudioItem = { id: 's:1', text: '今日は雨。', readings: [{ start: 0, length: 2, reading: 'きょう' }] };
const manifest: ClipManifest = { config: 'cfg', format: 'opus-24k', clips: { 's:1': { clip: 'abc', src: sourceHash(item) } } };

describe('attachableClip', () => {
    it('attaches the clip of an unchanged item made with the current voice', () => {
        expect(attachableClip(manifest, 'cfg', item)).toBe('abc');
    });

    it('attaches nothing to an item edited since its clip was made', () => {
        expect(attachableClip(manifest, 'cfg', { ...item, text: '今日も雨。' })).toBeUndefined();
    });

    it('attaches nothing from a manifest made with another voice', () => {
        expect(attachableClip(manifest, 'other', item)).toBeUndefined();
        expect(attachableClip(null, 'cfg', item)).toBeUndefined();
    });
});

describe('serializeManifest', () => {
    it('round-trips, one sorted entry per line', () => {
        const two: ClipManifest = { ...manifest, clips: { 'w:2': { clip: 'd', src: 'e' }, ...manifest.clips } };
        const text = serializeManifest(two);
        expect(parseManifest(JSON.parse(text))).toEqual(two);
        expect(text.indexOf('"s:1"')).toBeLessThan(text.indexOf('"w:2"'));
    });

    it('rejects a malformed manifest', () => {
        expect(() => parseManifest({ config: 'c', format: 'wav', clips: {} })).toThrow();
        expect(() => parseManifest({ config: 'c', format: 'opus-24k', clips: { x: { clip: 1 } } })).toThrow(/x/);
    });
});

describe('applyClip / serializeLike', () => {
    it('sets, keeps and removes a clip, saying when it changed', () => {
        const target: { audio?: { clip: string } } = {};
        expect(applyClip(target, 'a')).toBe(true);
        expect(applyClip(target, 'a')).toBe(false);
        expect(applyClip(target, undefined)).toBe(true);
        expect(target).toEqual({});
        expect(applyClip(target, undefined)).toBe(false);
    });

    it('writes a file back in the formatting it had, so an unchanged one stays byte-identical', () => {
        const indented = JSON.stringify({ a: 1 }, null, 2);
        const minified = JSON.stringify({ a: 1 });
        expect(serializeLike(indented, { a: 1 })).toBe(indented);
        expect(serializeLike(minified, { a: 1 })).toBe(minified);
    });
});
