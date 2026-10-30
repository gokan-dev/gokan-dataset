import { createHash } from 'crypto';

/**
 * The formats a clip can be encoded in. Opus is the smaller one; AAC is the fallback for
 * a browser that cannot play Ogg Opus (the listening test checks Safari on iOS).
 */
export const AUDIO_FORMATS = {
    'opus-24k': { extension: 'opus', contentType: 'audio/ogg', codec: ['-c:a', 'libopus', '-b:a', '24k', '-application', 'voip'], muxer: 'ogg' },
    'aac-32k': { extension: 'm4a', contentType: 'audio/mp4', codec: ['-c:a', 'aac', '-b:a', '32k'], muxer: 'mp4' },
} as const;

export type AudioFormat = keyof typeof AUDIO_FORMATS;

export function isAudioFormat(value: unknown): value is AudioFormat {
    return typeof value === 'string' && Object.hasOwn(AUDIO_FORMATS, value);
}

/**
 * Which text the engine is given:
 * - `written`: the text as written, read with the engine's own dictionary;
 * - `forced`: where the engine reads a word differently from our reading of it, that word
 *   is sent in kana, so the clip says what the page shows.
 */
export type InputVariant = 'written' | 'forced';

/**
 * Synthesis settings applied to the engine's query before synthesis. Written out in full,
 * not left to the engine's defaults, so a default changing between engine versions cannot
 * change a clip without changing its key.
 */
export interface SynthesisParams {
    speedScale: number;
    pitchScale: number;
    intonationScale: number;
    volumeScale: number;
    prePhonemeLength: number;
    postPhonemeLength: number;
}

export const DEFAULT_PARAMS: SynthesisParams = {
    speedScale: 1,
    pitchScale: 0,
    intonationScale: 1,
    volumeScale: 1,
    prePhonemeLength: 0.1,
    postPhonemeLength: 0.1,
};

/** `data/audio/voice.json`: the voice chosen by the listening test (gokan-srs#164), and everything a clip is made with. */
export interface VoiceConfig {
    engine: 'voicevox';
    /**
     * The engine version every clip is made with. build:audio refuses an engine reporting
     * another: the version is part of every key, so a different one would regenerate and
     * write every clip again.
     */
    engineVersion: string;
    speaker: string;
    speakerUuid: string;
    style: string;
    styleId: number;
    variant: InputVariant;
    params: SynthesisParams;
    format: AudioFormat;
    /** The credit the voice's terms require ("VOICEVOX:冥鳴ひまり"). */
    credit: string;
    termsUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    if (typeof value !== 'string' || value === '') throw new Error(`voice.json: "${key}" must be a non-empty string`);
    return value;
}

function numberField(record: Record<string, unknown>, key: string): number {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`voice.json: "${key}" must be a number`);
    return value;
}

/** Narrows `data/audio/voice.json`. Every field is required: a missing credit fails the build, as the voice's terms require one. */
export function parseVoiceConfig(raw: unknown): VoiceConfig {
    if (!isRecord(raw)) throw new Error('voice.json: expected an object');
    if (raw.engine !== 'voicevox') throw new Error('voice.json: "engine" must be "voicevox"');
    const variant = raw.variant;
    if (variant !== 'written' && variant !== 'forced') throw new Error('voice.json: "variant" must be "written" or "forced"');
    const format = raw.format;
    if (!isAudioFormat(format)) throw new Error(`voice.json: "format" must be one of ${Object.keys(AUDIO_FORMATS).join(', ')}`);
    const params = raw.params;
    if (!isRecord(params)) throw new Error('voice.json: "params" must be an object');
    return {
        engine: 'voicevox',
        engineVersion: stringField(raw, 'engineVersion'),
        speaker: stringField(raw, 'speaker'),
        speakerUuid: stringField(raw, 'speakerUuid'),
        style: stringField(raw, 'style'),
        styleId: numberField(raw, 'styleId'),
        variant,
        params: {
            speedScale: numberField(params, 'speedScale'),
            pitchScale: numberField(params, 'pitchScale'),
            intonationScale: numberField(params, 'intonationScale'),
            volumeScale: numberField(params, 'volumeScale'),
            prePhonemeLength: numberField(params, 'prePhonemeLength'),
            postPhonemeLength: numberField(params, 'postPhonemeLength'),
        },
        format,
        credit: stringField(raw, 'credit'),
        termsUrl: stringField(raw, 'termsUrl'),
    };
}

/** JSON with object keys sorted at every level, so a hash never depends on key order. */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (isRecord(value)) {
        const keys = Object.keys(value).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function sha256Hex(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

/**
 * The part of the voice config that changes how every clip sounds. The clips manifest
 * records it: a manifest made under another one names clips of another voice, so none of
 * them is attached until the clips are made again.
 */
export function configHash(config: VoiceConfig): string {
    const { engine, engineVersion, styleId, variant, params, format } = config;
    return sha256Hex(canonicalJson({ engine, engineVersion, styleId, variant, params, format })).slice(0, 16);
}
