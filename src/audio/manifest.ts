import path from 'path';
import { isAudioFormat, type AudioFormat } from './config';
import { sourceHash, type AudioItem } from './scope';

export const VOICE_PATH = './data/audio/voice.json';
export const MANIFEST_PATH = './data/audio/clips.json';
/**
 * Every clip, `{clip}.{extension}`, committed in Git LFS: what the audio bucket's `audio/`
 * mirrors. A clone checks out only their LFS pointers (`.lfsconfig`); upload:audio fetches the
 * content of the ones the bucket lacks.
 */
export const CLIPS_DIR = './data/audio/clips';
/** The same folder as a path from the repository root, for `git lfs`. */
export const CLIPS_REPO_DIR = 'data/audio/clips';
/** build:audio's run state: progress, the STOP file, failures, half-written clips. Not committed. */
export const BUILD_STATE_DIR = './data/audio/.build';

export function clipPath(clip: string, extension: string): string {
    return path.join(CLIPS_DIR, `${clip}.${extension}`);
}

/** One item's clip: its key, and the hash of the text and readings it was made from. */
export interface ClipEntry {
    clip: string;
    src: string;
}

/**
 * `data/audio/clips.json`: each item's clip in data/audio/clips/. Written by build:audio as
 * it makes them, committed with them. attach:audio refuses an entry whose clip is not in the
 * folder, and gokan-srs's deploy uploads the committed clips the bucket lacks before it
 * publishes a dataset version, so a deployed dataset never names a clip the site lacks.
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

function referencedFiles(manifest: ClipManifest, extension: string): Set<string> {
    return new Set(Object.values(manifest.clips).map(e => `${e.clip}.${extension}`));
}

/** The clips the manifest names that the folder (its file names) lacks, sorted. */
export function missingClipFiles(manifest: ClipManifest, files: Iterable<string>, extension: string): string[] {
    const present = new Set(files);
    return [...referencedFiles(manifest, extension)].filter(f => !present.has(f)).sort();
}

/**
 * The clip files no item uses any more: an edited sentence's old clip, a previous voice's.
 * build:audio removes them from the folder; the bucket keeps them, as an older dataset
 * version may still name them.
 */
export function staleClipFiles(manifest: ClipManifest, files: Iterable<string>, extension: string): string[] {
    const used = referencedFiles(manifest, extension);
    return [...files].filter(f => f.endsWith(`.${extension}`) && !used.has(f)).sort();
}
