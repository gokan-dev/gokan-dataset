import type { AudioRef } from '../models/audio.model';

/** Sets or removes an object's `audio`. Returns whether it changed. */
export function applyClip(target: { audio?: AudioRef }, clip: string | undefined): boolean {
    if (clip === undefined) {
        if (target.audio === undefined) return false;
        delete target.audio;
        return true;
    }
    if (target.audio?.clip === clip) return false;
    target.audio = { clip };
    return true;
}

/**
 * A compiled file written back in the formatting it already has: build-data writes some
 * indented, build-synonyms and the grammar builds minified. Keeping it means an unchanged
 * file stays byte-identical, so the deploy uploads only files whose clip changed.
 */
export function serializeLike(original: string, value: unknown): string {
    const indented = original.startsWith('{\n') || original.startsWith('[\n');
    return indented ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}
