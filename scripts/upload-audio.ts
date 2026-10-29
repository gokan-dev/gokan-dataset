import fs from 'fs';
import path from 'path';
import { AUDIO_FORMATS, configHash, parseVoiceConfig } from '../src/audio/config';
import { readJson } from '../src/audio/compiled';
import { LOCAL_CLIPS_DIR, LOCAL_INDEX_PATH, MANIFEST_PATH, VOICE_PATH, parseManifest, serializeManifest, type ClipManifest } from '../src/audio/manifest';
import { listClipKeys, uploadClips } from '../src/audio/s3';
import { estimatedPutCost, planUploads } from '../src/audio/uploads';

/**
 * Uploads the clips build:audio made (data/audio/.clips/) to the audio bucket, and writes
 * data/audio/clips.json: the items whose clip the bucket has. No engine needed; AWS
 * credentials for the bucket are.
 *
 *   bun run upload:audio -- --bucket NAME --dry-run                # how many it would write, and the cost
 *   bun run upload:audio -- --bucket NAME --max-uploads 120000
 *
 * Every clip is written once, ever (S3 writes are what cost): the bucket is listed first,
 * only the clips it lacks are written, at most --max-uploads (default 1,000) per run, one
 * PUT each, never overwritten and never deleted (staging and production may use different
 * dataset versions). Uploads go in batches of 1,000, clips.json rewritten after each, so a
 * stopped run keeps what it wrote.
 */

const STAGE_DIR = './data/audio/.stage';
const BATCH = 1000;

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
    const bucket = arg('bucket');
    if (!bucket) throw new Error('--bucket is required');
    const prefix = arg('prefix') ?? 'audio/';
    const dryRun = process.argv.includes('--dry-run');
    const maxUploads = Number(arg('max-uploads') ?? 1000);

    const config = parseVoiceConfig(readJson<unknown>(VOICE_PATH));
    const hash = configHash(config);
    const format = AUDIO_FORMATS[config.format];
    if (!fs.existsSync(LOCAL_INDEX_PATH)) throw new Error('No clips made on this machine yet: run build:audio first');
    const local = parseManifest(readJson<unknown>(LOCAL_INDEX_PATH));
    if (local.config !== hash) throw new Error('The local clips were made with another voice config than voice.json: run build:audio again');
    const fileOf = (key: string) => path.join(LOCAL_CLIPS_DIR, `${key}.${format.extension}`);
    const localKeys = [...new Set(Object.values(local.clips).map(e => e.clip))].filter(k => fs.existsSync(fileOf(k)));

    const existing = listClipKeys(bucket, prefix);
    const plan = planUploads(localKeys, existing, maxUploads);
    console.log([
        `Made here: ${localKeys.length.toLocaleString('en-US')} clips. Already in the bucket: ${plan.alreadyThere.toLocaleString('en-US')}.`,
        `To write: ${plan.write.length.toLocaleString('en-US')} (about $${estimatedPutCost(plan.write.length).toFixed(2)} in PUTs).`,
        plan.overCap > 0 ? `Left for a later run by --max-uploads ${maxUploads}: ${plan.overCap.toLocaleString('en-US')}.` : '',
    ].filter(Boolean).join('\n'));

    // clips.json: the previous entries the bucket still has, and every local one it now has.
    const previous: ClipManifest | null = fs.existsSync(MANIFEST_PATH) ? parseManifest(readJson<unknown>(MANIFEST_PATH)) : null;
    const writeManifest = (): void => {
        const clips: ClipManifest['clips'] = {};
        if (previous && previous.config === hash) {
            for (const [id, e] of Object.entries(previous.clips)) if (existing.has(e.clip)) clips[id] = e;
        }
        for (const [id, e] of Object.entries(local.clips)) if (existing.has(e.clip)) clips[id] = e;
        fs.writeFileSync(MANIFEST_PATH, serializeManifest({ config: hash, format: config.format, clips }));
    };
    if (dryRun) return;

    for (let i = 0; i < plan.write.length; i += BATCH) {
        const batch = plan.write.slice(i, i + BATCH);
        fs.rmSync(STAGE_DIR, { recursive: true, force: true });
        fs.mkdirSync(STAGE_DIR, { recursive: true });
        // Hard links, not copies: the staging folder holds exactly this batch, for one recursive upload.
        for (const key of batch) fs.linkSync(fileOf(key), path.join(STAGE_DIR, path.basename(fileOf(key))));
        uploadClips(STAGE_DIR, bucket, prefix, format.contentType);
        for (const key of batch) existing.add(key);
        writeManifest();
        console.log(`Uploaded ${Math.min(i + BATCH, plan.write.length).toLocaleString('en-US')} of ${plan.write.length.toLocaleString('en-US')}`);
    }
    fs.rmSync(STAGE_DIR, { recursive: true, force: true });
    writeManifest();
    const listed = Object.keys(parseManifest(readJson<unknown>(MANIFEST_PATH)).clips).length;
    console.log(`clips.json lists ${listed.toLocaleString('en-US')} items. Next: bun run attach:audio, then commit compiled/ and data/audio/clips.json.`);
}

try {
    main();
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
}
