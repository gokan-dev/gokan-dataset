import { canonicalJson, sha256Hex, type AudioFormat, type SynthesisParams } from './config';

/** Everything a clip is made from. Each field changes the sound, so each is in the key. */
export interface ClipRecipe {
    engine: string;
    engineVersion: string;
    styleId: number;
    params: SynthesisParams;
    format: AudioFormat;
    /** The exact text sent to the engine: the text as written, or with some words in kana. */
    input: string;
}

/**
 * A clip's name in the bucket: 16 hex characters of the recipe's SHA-256.
 *
 * Named by what it is made from, not by its bytes: a reading fix, a new voice or a
 * parameter change gives a new key, so a new clip; the same recipe always gives the same
 * key, so a clip already in the bucket is never written again (S3 writes are what cost).
 */
export function clipKey(recipe: ClipRecipe): string {
    return sha256Hex(canonicalJson(recipe)).slice(0, 16);
}
