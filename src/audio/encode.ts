import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { AUDIO_FORMATS, type AudioFormat } from './config';

/** ffmpeg from `ffmpeg-static` (pinned by the lockfile), or the one `FFMPEG` names. */
function ffmpeg(): string {
    const binary = process.env.FFMPEG ?? ffmpegPath;
    if (!binary) throw new Error('No ffmpeg: install the dataset dependencies (bun install) or set FFMPEG');
    return binary;
}

function run(binary: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`))));
    });
}

/**
 * Encodes the engine's WAV in a clip format, mono. Through temporary files rather than
 * pipes: the MP4 muxer needs a seekable output.
 */
export async function encode(wav: Uint8Array, format: AudioFormat): Promise<Uint8Array> {
    const spec = AUDIO_FORMATS[format];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gokan-audio-'));
    try {
        const input = path.join(dir, 'in.wav');
        const output = path.join(dir, `out.${spec.extension}`);
        fs.writeFileSync(input, wav);
        await run(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ac', '1', ...spec.codec, '-f', spec.muxer, output]);
        return new Uint8Array(fs.readFileSync(output));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
