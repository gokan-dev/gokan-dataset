import fs from 'fs';
import path from 'path';
import { AUDIO_FORMATS, configHash, parseVoiceConfig } from '../src/audio/config';
import { loadCompiled, readJson } from '../src/audio/compiled';
import { encode } from '../src/audio/encode';
import { clipKey } from '../src/audio/key';
import { LOCAL_CLIPS_DIR, LOCAL_INDEX_PATH, VOICE_PATH, parseManifest, serializeManifest, type ClipManifest } from '../src/audio/manifest';
import { inputFor, planInput } from '../src/audio/plan';
import { formatProgressLine, Progress } from '../src/audio/progress';
import { generationOrder, selectScope, sourceHash } from '../src/audio/scope';
import { cachedAnalysis, DEFAULT_ENGINE_URL, Voicevox } from '../src/audio/voicevox';

/**
 * Makes the clips of gokan-srs#164 on this machine, into data/audio/.clips/ (not committed).
 * Uploading them is a separate step, upload:audio. Run by hand, with the VOICEVOX engine running:
 *
 *   bun run build:audio -- --engine http://127.0.0.1:50021 [--minutes 600] [--workers 2]
 *
 * - Progress: one line every 10 seconds (done, clips per second over the last 5 minutes,
 *   time left at that rate, space used), also in data/audio/.clips/progress.json.
 * - Stopping: Ctrl+C (or a file data/audio/.clips/STOP) finishes the clips in progress,
 *   saves, and exits. Running it again continues where it stopped: a clip already made is
 *   never made again. A second Ctrl+C exits at once; nothing is lost but those clips.
 * - Order: the most frequent words and their sentences first, so a fill that stops halfway
 *   has voiced what a learner meets first.
 *
 * On a GPU (VOICEVOX's Windows DirectML engine, `run.exe --use_gpu`) a clip takes about
 * 0.54 s with two workers: about 16 hours for the first ~107k clips, ~470 MB in Opus. On a
 * CPU about three times that. The Docker NVIDIA image could not load the voice models under WSL2.
 * An engine whose version is not the one in voice.json is refused: the version is part of
 * every key, so another would make every clip again.
 */

const SAVE_EVERY = 200;
const REPORT_EVERY_MS = 10_000;

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function dirBytes(dir: string): number {
    let total = 0;
    for (const f of fs.readdirSync(dir)) total += fs.statSync(path.join(dir, f)).size;
    return total;
}

async function main(): Promise<void> {
    const topSentences = Number(arg('top') ?? 3);
    const workers = Math.max(1, Number(arg('workers') ?? 2));

    if (!fs.existsSync(VOICE_PATH)) throw new Error(`No voice chosen yet: ${VOICE_PATH} is written once the listening test is decided (gokan-srs#164)`);
    const config = parseVoiceConfig(readJson<unknown>(VOICE_PATH));
    const hash = configHash(config);
    const format = AUDIO_FORMATS[config.format];
    const engine = new Voicevox(arg('engine') ?? DEFAULT_ENGINE_URL);
    const engineVersion = await engine.version();
    if (engineVersion !== config.engineVersion) {
        throw new Error(`The engine is VOICEVOX ${engineVersion}, voice.json says ${config.engineVersion}. Run that version: another would change every key and make every clip again.`);
    }

    console.log('Loading the compiled dataset...');
    const data = loadCompiled();
    const input = { vocab: data.vocab, sentencesByVocab: data.sentencesByVocab, grammarExamples: data.grammarExamples, topSentences };
    const rank = new Map(data.vocab.map(v => [v.id, v.usuallyKana ? v.frequency.kanaRank ?? v.frequency.kanjiRank : v.frequency.kanjiRank]));
    const scope = generationOrder(selectScope(input), input, id => rank.get(id) ?? Infinity);

    fs.mkdirSync(LOCAL_CLIPS_DIR, { recursive: true });
    // A clip half-written when a run was killed.
    for (const f of fs.readdirSync(LOCAL_CLIPS_DIR)) if (f.endsWith('.tmp')) fs.rmSync(path.join(LOCAL_CLIPS_DIR, f));
    const previous = fs.existsSync(LOCAL_INDEX_PATH) ? parseManifest(readJson<unknown>(LOCAL_INDEX_PATH)) : null;
    const local: ClipManifest = previous && previous.config === hash ? previous : { config: hash, format: config.format, clips: {} };
    if (previous && previous.config !== hash) console.log('The voice config changed: every clip is made again (the old ones stay in the folder, unused).');
    const fileOf = (key: string) => path.join(LOCAL_CLIPS_DIR, `${key}.${format.extension}`);
    const isDone = (id: string, src: string) => local.clips[id]?.src === src && fs.existsSync(fileOf(local.clips[id].clip));
    const todo = scope.filter(item => !isDone(item.id, sourceHash(item)));
    const progress = new Progress(scope.length, scope.length - todo.length);
    console.log(`VOICEVOX ${engineVersion}, ${config.speaker} (${config.style}), ${config.variant}, ${config.format}. ${scope.length.toLocaleString('en-US')} items: ${progress.done.toLocaleString('en-US')} already made, ${todo.length.toLocaleString('en-US')} to make.`);

    let stopping = false;
    process.on('SIGINT', () => {
        if (stopping) process.exit(130);
        stopping = true;
        console.log('\nStopping after the clips in progress (Ctrl+C again to exit at once)...');
    });
    const stopFile = path.join(LOCAL_CLIPS_DIR, 'STOP');
    if (fs.existsSync(stopFile)) fs.rmSync(stopFile);

    const analysis = cachedAnalysis(engine, config.styleId);
    let bytes = dirBytes(LOCAL_CLIPS_DIR);
    let sinceSave = 0;
    const save = (): void => {
        fs.writeFileSync(`${LOCAL_INDEX_PATH}.tmp`, serializeManifest(local));
        fs.renameSync(`${LOCAL_INDEX_PATH}.tmp`, LOCAL_INDEX_PATH);
        sinceSave = 0;
    };
    const report = (): void => {
        const line = formatProgressLine(progress, bytes);
        console.log(line);
        fs.writeFileSync(path.join(LOCAL_CLIPS_DIR, 'progress.json'), JSON.stringify({ at: new Date().toISOString(), done: progress.done, total: progress.total, clipsPerSecond: progress.rate(), secondsLeft: progress.secondsLeft() ?? null, bytes, line }));
    };
    progress.tick(progress.done, Date.now());
    const timer = setInterval(report, REPORT_EVERY_MS);
    // Counted from the first clip, not from loading the dataset (about 30 s).
    const deadline = arg('minutes') ? Date.now() + Number(arg('minutes')) * 60_000 : Infinity;

    const queue = [...todo];
    await Promise.all(Array.from({ length: workers }, async (_, worker) => {
        while (!stopping && Date.now() < deadline) {
            const item = queue.shift();
            if (!item) return;
            if (fs.existsSync(stopFile)) { stopping = true; return; }
            const clipInput = inputFor(await planInput(item, analysis.pronounce), config.variant);
            const key = clipKey({ engine: config.engine, engineVersion: config.engineVersion, styleId: config.styleId, params: config.params, format: config.format, input: clipInput });
            const file = fileOf(key);
            // Two items with the same text share one clip.
            if (!fs.existsSync(file)) {
                const wav = await engine.synthesis(await analysis.query(clipInput), config.styleId, config.params);
                const clip = await encode(wav, config.format);
                // Written whole, then renamed: a run stopped mid-write leaves no broken clip.
                fs.writeFileSync(`${file}.${worker}.tmp`, clip);
                fs.renameSync(`${file}.${worker}.tmp`, file);
                bytes += clip.length;
            }
            local.clips[item.id] = { clip: key, src: sourceHash(item) };
            progress.tick(progress.done + 1, Date.now());
            if (++sinceSave >= SAVE_EVERY) save();
        }
    }));
    clearInterval(timer);
    save();
    report();
    if (progress.done < progress.total) {
        console.log(`Stopped with ${(progress.total - progress.done).toLocaleString('en-US')} items left. Run the same command again to continue.`);
    } else {
        console.log('Every clip is made. Next: bun run upload:audio -- --bucket NAME --dry-run');
    }
}

main().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
