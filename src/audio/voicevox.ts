import type { SynthesisParams } from './config';

/**
 * A client for a running VOICEVOX engine (its Docker image or desktop app), over its HTTP
 * API. Every response enters as `unknown` and is narrowed here; the audio query is passed
 * back to the engine for synthesis, so only the fields read are checked.
 */
export const DEFAULT_ENGINE_URL = 'http://127.0.0.1:50021';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function request(url: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`VOICEVOX ${init?.method ?? 'GET'} ${url}: ${response.status} ${await response.text()}`);
    return response;
}

export interface VoicevoxStyle {
    name: string;
    id: number;
}

export interface VoicevoxSpeaker {
    name: string;
    uuid: string;
    styles: VoicevoxStyle[];
}

/** The engine's audio query: opaque to us but for the morae read from it. */
export type AudioQuery = Record<string, unknown>;

export class Voicevox {
    constructor(private readonly base: string = DEFAULT_ENGINE_URL) {}

    async version(): Promise<string> {
        const value: unknown = await (await request(`${this.base}/version`)).json();
        if (typeof value !== 'string') throw new Error('VOICEVOX /version: expected a string');
        return value;
    }

    async speakers(): Promise<VoicevoxSpeaker[]> {
        const value: unknown = await (await request(`${this.base}/speakers`)).json();
        if (!Array.isArray(value)) throw new Error('VOICEVOX /speakers: expected an array');
        return value.flatMap((s: unknown) => {
            if (!isRecord(s) || typeof s.name !== 'string' || typeof s.speaker_uuid !== 'string' || !Array.isArray(s.styles)) return [];
            const styles = s.styles.flatMap((st: unknown) =>
                isRecord(st) && typeof st.name === 'string' && typeof st.id === 'number' ? [{ name: st.name, id: st.id }] : []);
            return [{ name: s.name, uuid: s.speaker_uuid, styles }];
        });
    }

    /** The voice's terms of use, as the engine ships them (Markdown). */
    async policy(speakerUuid: string): Promise<string> {
        const value: unknown = await (await request(`${this.base}/speaker_info?speaker_uuid=${encodeURIComponent(speakerUuid)}`)).json();
        if (!isRecord(value) || typeof value.policy !== 'string') throw new Error('VOICEVOX /speaker_info: expected a policy');
        return value.policy;
    }

    async audioQuery(text: string, styleId: number): Promise<AudioQuery> {
        const url = `${this.base}/audio_query?text=${encodeURIComponent(text)}&speaker=${styleId}`;
        const value: unknown = await (await request(url, { method: 'POST' })).json();
        if (!isRecord(value) || !Array.isArray(value.accent_phrases)) throw new Error(`VOICEVOX /audio_query: no accent phrases for ${text}`);
        return value;
    }

    /** WAV bytes for a query, with our synthesis parameters written over the engine's. */
    async synthesis(query: AudioQuery, styleId: number, params: SynthesisParams): Promise<Uint8Array> {
        const response = await request(`${this.base}/synthesis?speaker=${styleId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...query, ...params }),
        });
        return new Uint8Array(await response.arrayBuffer());
    }
}

/** The morae the engine will say for a query, in katakana, pauses left out. */
export function moraeOf(query: AudioQuery): string {
    const phrases = query.accent_phrases;
    if (!Array.isArray(phrases)) return '';
    let out = '';
    for (const phrase of phrases) {
        if (!isRecord(phrase) || !Array.isArray(phrase.moras)) continue;
        for (const mora of phrase.moras) {
            if (isRecord(mora) && typeof mora.text === 'string') out += mora.text;
        }
    }
    return out;
}

/** Analyses each text once per run: planning asks for the same sentence several times, and synthesis reuses the query. */
export function cachedAnalysis(engine: Voicevox, styleId: number): { pronounce: (text: string) => Promise<string>; query: (text: string) => Promise<AudioQuery> } {
    const cache = new Map<string, Promise<AudioQuery>>();
    const query = (text: string): Promise<AudioQuery> => {
        let q = cache.get(text);
        if (!q) {
            q = engine.audioQuery(text, styleId);
            cache.set(text, q);
        }
        return q;
    };
    return { query, pronounce: async text => moraeOf(await query(text)) };
}
