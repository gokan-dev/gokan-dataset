import fs from 'fs';
import path from 'path';
import { AUDIO_FORMATS, configHash, parseVoiceConfig } from '../src/audio/config';
import { loadCompiled, readJson } from '../src/audio/compiled';
import { encode } from '../src/audio/encode';
import { clipKey } from '../src/audio/key';
import { MANIFEST_PATH, VOICE_PATH, parseManifest, serializeManifest, type ClipManifest } from '../src/audio/manifest';
import { inputFor, planInput } from '../src/audio/plan';
import { listClipKeys, uploadClips } from '../src/audio/s3';
import { selectScope, sourceHash, type AudioItem } from '../src/audio/scope';
import { estimatedPutCost, planUploads } from '../src/audio/uploads';
import { cachedAnalysis, DEFAULT_ENGINE_URL, Voicevox } from '../src/audio/voicevox';

/**
 * Makes the clips of gokan-srs#164 and uploads them to the audio bucket. Run by hand, with
 * the VOICEVOX engine running and AWS credentials for the bucket:
 *
 *   bun run build:audio -- --bucket NAME --dry-run           # what it would write, and its cost
 *   bun run build:audio -- --bucket NAME --max-uploads 120000 --minutes 600
 *
 * On a GPU (VOICEVOX's Windows DirectML engine, `run.exe --use_gpu`) a clip takes about
 * 0.54 s with the default two workers, so the first fill (~107k clips) is about 16 hours;
 * on a CPU about three times that. The Docker NVIDIA image could not load the voice
 * models under WSL2; the Windows engine has no such problem.
 *
 * Every clip is written once, ever (S3 writes are what cost): its name is its content key,
 * the bucket is listed first and only missing keys are written, a run stops at
 * --max-uploads writes (default 1,000), and an engine whose version is not the one in
 * voice.json is refused, since it would change every key. Resumable: clips are uploaded in
 * batches and clips.json is rewritten after each, so a run that stops loses nothing.
 */

const PLAN_CACHE_PATH = './data/audio/.plan-cache.json';
const STAGE_DIR = './data/audio/.stage';
const BATCH = 200;

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Inputs planned in an earlier run, keyed by item id, source hash and voice config: planning a sentence asks the engine several times. */
function readPlanCache(): Map<string, string> {
    if (!fs.existsSync(PLAN_CACHE_PATH)) return new Map();
    return new Map(Object.entries(readJson<Record<string, string>>(PLAN_CACHE_PATH)));
}

async function main(): Promise<void> {
    const bucket = arg('bucket');
    const prefix = arg('prefix') ?? 'audio/';
    const dryRun = process.argv.includes('--dry-run');
    const maxUploads = Number(arg('max-uploads') ?? 1000);
    const deadline = Date.now() + Number(arg('minutes') ?? 60) * 60_000;
    const topSentences = Number(arg('top') ?? 3);
    const workers = Math.max(1, Number(arg('workers') ?? 2));
    if (!bucket && !dryRun) throw new Error('--bucket is required (or --dry-run, which then assumes an empty bucket)');

    if (!fs.existsSync(VOICE_PATH)) throw new Error(`No voice chosen yet: ${VOICE_PATH} is written once the listening test is decided (gokan-srs#164)`);
    const config = parseVoiceConfig(readJson<unknown>(VOICE_PATH));
    const hash = configHash(config);
    const format = AUDIO_FORMATS[config.format];
    const engine = new Voicevox(arg('engine') ?? DEFAULT_ENGINE_URL);
    const engineVersion = await engine.version();
    if (engineVersion !== config.engineVersion) {
        throw new Error(`The engine is VOICEVOX ${engineVersion}, voice.json says ${config.engineVersion}. Run that version: another would change every key and write every clip again.`);
    }

    const data = loadCompiled();
    const scope = selectScope({ vocab: data.vocab, sentencesByVocab: data.sentencesByVocab, grammarExamples: data.grammarExamples, topSentences });
    const previous: ClipManifest | null = fs.existsSync(MANIFEST_PATH) ? parseManifest(readJson<unknown>(MANIFEST_PATH)) : null;
    const manifest: ClipManifest = previous && previous.config === hash ? previous : { config: hash, format: config.format, clips: {} };
    if (previous && previous.config !== hash) console.log('The voice config changed since clips.json was written: every clip is new.');
    console.log(`Scope: ${scope.length} items (${topSentences} sentences per word).`);

    // 1. Each item's key: from the manifest when its source is unchanged, else planned with the engine.
    const planCache = readPlanCache();
    const analysis = cachedAnalysis(engine, config.styleId);
    const keyOf = new Map<string, string>();
    const itemOfKey = new Map<string, AudioItem>();
    let planned = 0;
    const inputOf = async (item: AudioItem): Promise<string> => {
        const cacheKey = `${item.id}|${sourceHash(item)}|${hash}`;
        let input = planCache.get(cacheKey);
        if (input === undefined) {
            input = inputFor(await planInput(item, analysis.pronounce), config.variant);
            planCache.set(cacheKey, input);
            if (++planned % 1000 === 0) {
                console.log(`Planned ${planned} items`);
                fs.writeFileSync(PLAN_CACHE_PATH, JSON.stringify(Object.fromEntries(planCache)));
            }
        }
        return input;
    };
    const keyFor = (input: string): string =>
        clipKey({ engine: config.engine, engineVersion: config.engineVersion, styleId: config.styleId, params: config.params, format: config.format, input });
    for (const item of scope) {
        if (Date.now() > deadline) break;
        const known = manifest.clips[item.id];
        const key = known?.src === sourceHash(item) ? known.clip : keyFor(await inputOf(item));
        keyOf.set(item.id, key);
        itemOfKey.set(key, item);
    }
    fs.mkdirSync(path.dirname(PLAN_CACHE_PATH), { recursive: true });
    fs.writeFileSync(PLAN_CACHE_PATH, JSON.stringify(Object.fromEntries(planCache)));

    // 2. What the bucket lacks, capped.
    const existing = bucket ? listClipKeys(bucket, prefix) : new Set<string>();
    const uploads = planUploads(keyOf.values(), existing, maxUploads);
    console.log([
        `Keys resolved: ${keyOf.size} of ${scope.length} (${planned} planned with the engine this run).`,
        `Already in the bucket: ${uploads.alreadyThere}. To write: ${uploads.write.length} (about $${estimatedPutCost(uploads.write.length).toFixed(2)} in PUTs).`,
        uploads.overCap > 0 ? `Left for a later run by --max-uploads ${maxUploads}: ${uploads.overCap}.` : '',
    ].filter(Boolean).join('\n'));

    const writeManifest = (): void => {
        const clips: ClipManifest['clips'] = {};
        for (const item of scope) {
            const key = keyOf.get(item.id);
            if (key && existing.has(key)) clips[item.id] = { clip: key, src: sourceHash(item) };
        }
        fs.writeFileSync(MANIFEST_PATH, serializeManifest({ config: hash, format: config.format, clips }));
    };
    if (dryRun || !bucket) return;

    // 3. Synthesise, encode and upload in batches; clips.json after each, so a stopped run keeps what it wrote.
    let written = 0;
    for (let i = 0; i < uploads.write.length && Date.now() < deadline; i += BATCH) {
        fs.rmSync(STAGE_DIR, { recursive: true, force: true });
        fs.mkdirSync(STAGE_DIR, { recursive: true });
        const batch = uploads.write.slice(i, i + BATCH);
        const queue = [...batch];
        // Two requests at once keep the engine busy while the previous clip is encoded (measured on a GPU: 0.54 s a clip against 0.72; four is no faster).
        await Promise.all(Array.from({ length: workers }, async () => {
            for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
                const item = itemOfKey.get(key);
                if (!item) throw new Error(`No item for clip ${key}`);
                // A key taken from clips.json whose clip is gone from the bucket is planned again; the same engine and voice give the same input.
                const input = await inputOf(item);
                if (keyFor(input) !== key) throw new Error(`${item.id} plans to another input than its clip ${key} was made from: rerun after removing its entry from clips.json`);
                const wav = await engine.synthesis(await analysis.query(input), config.styleId, config.params);
                fs.writeFileSync(path.join(STAGE_DIR, `${key}.${format.extension}`), await encode(wav, config.format));
            }
        }));
        uploadClips(STAGE_DIR, bucket, prefix, format.contentType);
        for (const key of batch) existing.add(key);
        written += batch.length;
        writeManifest();
        console.log(`Uploaded ${written} of ${uploads.write.length}`);
    }
    fs.rmSync(STAGE_DIR, { recursive: true, force: true });
    writeManifest();

    const used = new Set(keyOf.values());
    const orphans = [...existing].filter(k => !used.has(k)).length;
    console.log(`Done: ${written} clips written; clips.json lists ${Object.keys(parseManifest(readJson<unknown>(MANIFEST_PATH)).clips).length} items. ${orphans} clips in the bucket are no longer used (kept: staging may still use them).`);
    console.log('Next: bun run attach:audio, then commit compiled/ and data/audio/clips.json.');
}

main().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
