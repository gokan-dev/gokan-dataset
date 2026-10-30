import { isAudioFormat, type AudioFormat } from './config';
import { sourceHash, type AudioItem } from './scope';

export const VOICE_PATH = './data/audio/voice.json';
export const MANIFEST_PATH = './data/audio/clips.json';
/** The clips made on this machine, and their index (the same shape as clips.json): build:audio writes them, upload:audio reads them. Not committed. */
export const LOCAL_CLIPS_DIR = './data/audio/.clips';
export const LOCAL_INDEX_PATH = './data/audio/.clips/index.json';

/** One item's clip: its key, and the hash of the text and readings it was made from. */
export interface ClipEntry {
    clip: string;
    src: string;
}

/**
 * `data/audio/clips.json`: the clips that exist in the bucket, by item. Written only by
 * build:audio, after the bucket listing confirms each clip, so attaching from it never
 * names a clip that is missing. Committed, unlike the clips themselves.
 */
export interface ClipManifest {
    /** configHash of the voice the clips were made with. */
    config: string;
    format: AudioFormat;
    clips: Record<string, ClipEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseManifest(raw: unknown): ClipManifest {
    if (!isRecord(raw) || typeof raw.config !== 'string' || !isAudioFormat(raw.format) || !isRecord(raw.clips)) {
        throw new Error('clips.json: expected { config, format, clips }');
    }
    const clips: Record<string, ClipEntry> = {};
    for (const [id, entry] of Object.entries(raw.clips)) {
        if (!isRecord(entry) || typeof entry.clip !== 'string' || typeof entry.src !== 'string') throw new Error(`clips.json: bad entry for ${id}`);
        clips[id] = { clip: entry.clip, src: entry.src };
    }
    return { config: raw.config, format: raw.format, clips };
}

/** One entry per line, sorted by id: a run that adds clips is a diff of the lines it adds. */
export function serializeManifest(manifest: ClipManifest): string {
    const ids = Object.keys(manifest.clips).sort();
    const lines = ids.map(id => `    ${JSON.stringify(id)}: ${JSON.stringify(manifest.clips[id])}`);
    return `{\n  "config": ${JSON.stringify(manifest.config)},\n  "format": ${JSON.stringify(manifest.format)},\n  "clips": {\n${lines.join(',\n')}\n  }\n}\n`;
}

/**
 * The clip to attach to an item, if any: only from a manifest made with the current voice,
 * and only when the item still has the text and readings its clip was made from. An edited
 * sentence loses its clip until build:audio makes the new one.
 */
export function attachableClip(manifest: ClipManifest | null, currentConfig: string | null, item: AudioItem): string | undefined {
    if (!manifest || manifest.config !== currentConfig) return undefined;
    const entry = manifest.clips[item.id];
    return entry && entry.src === sourceHash(item) ? entry.clip : undefined;
}
