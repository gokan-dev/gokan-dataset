import fs from 'fs';
import path from 'path';
import { AUDIO_FORMATS, configHash, parseVoiceConfig } from '../src/audio/config';
import { readJson } from '../src/audio/compiled';
import { ensureLfsContent } from '../src/audio/lfs';
import { CLIPS_DIR, CLIPS_REPO_DIR, MANIFEST_PATH, VOICE_PATH, clipPath, missingClipFiles, parseManifest } from '../src/audio/manifest';
import { listClipKeys, uploadClips } from '../src/audio/s3';
import { DEFAULT_MAX_UPLOADS, estimatedPutCost, overCapMessage, planUploads } from '../src/audio/uploads';

/**
 * Puts the committed clips (data/audio/clips/, Git LFS) that the audio bucket lacks into it.
 * Run by gokan-srs's deploy before it publishes a dataset version, with the only key that can
 * write the bucket.
 *
 *   bun run upload:audio -- --bucket NAME --dry-run                # how many it would write, and the cost
 *   bun run upload:audio -- --bucket NAME --max-uploads 120000
 *
 * Every clip is written once, ever (S3 writes are what cost): the bucket is listed first and
 * only the clips it lacks are written, one PUT each, never overwritten and never deleted
 * (staging and production may use different dataset versions). At most --max-uploads (2,000
 * by default, as the deploy passes) per run, the guard against a key bug rewriting the
 * bucket; a run that leaves clips for later fails, so the cap is never hit unnoticed. A
 * re-run writes the next batch: a first fill or a voice change raises the cap instead
 * (overCapMessage says how). In a checkout without the clips'
 * content (the default, see .lfsconfig) it fetches from LFS only the clips it writes.
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
    const maxUploads = Number(arg('max-uploads') ?? DEFAULT_MAX_UPLOADS);
    if (!Number.isInteger(maxUploads) || maxUploads < 0) throw new Error(`--max-uploads must be a whole number, not ${arg('max-uploads')}`);

    const config = parseVoiceConfig(readJson<unknown>(VOICE_PATH));
    const format = AUDIO_FORMATS[config.format];
    if (!fs.existsSync(MANIFEST_PATH)) {
        console.log('No data/audio/clips.json: no clip is committed, nothing to upload.');
        return;
    }
    const manifest = parseManifest(readJson<unknown>(MANIFEST_PATH));
    if (manifest.config !== configHash(config)) throw new Error('clips.json was made with another voice config than voice.json: run build:audio again');
    const missing = missingClipFiles(manifest, fs.existsSync(CLIPS_DIR) ? fs.readdirSync(CLIPS_DIR) : [], format.extension);
    if (missing.length > 0) throw new Error(`clips.json names ${missing.length} clips that data/audio/clips/ lacks, such as ${missing[0]}`);
    const keys = [...new Set(Object.values(manifest.clips).map(e => e.clip))];

    const plan = planUploads(keys, listClipKeys(bucket, prefix), maxUploads);
    console.log([
        `Committed: ${keys.length.toLocaleString('en-US')} clips. Already in the bucket: ${plan.alreadyThere.toLocaleString('en-US')}.`,
        `To write: ${plan.write.length.toLocaleString('en-US')} (about $${estimatedPutCost(plan.write.length).toFixed(2)} in PUTs).`,
        plan.overCap > 0 ? `Over the cap of ${maxUploads.toLocaleString('en-US')}: ${plan.overCap.toLocaleString('en-US')}.` : '',
    ].filter(Boolean).join('\n'));
    if (dryRun) return;

    ensureLfsContent(plan.write.map(key => ({ file: clipPath(key, format.extension), repoPath: `${CLIPS_REPO_DIR}/${key}.${format.extension}` })), CLIPS_REPO_DIR);
    for (let i = 0; i < plan.write.length; i += BATCH) {
        const batch = plan.write.slice(i, i + BATCH);
        fs.rmSync(STAGE_DIR, { recursive: true, force: true });
        fs.mkdirSync(STAGE_DIR, { recursive: true });
        // Hard links, not copies: the staging folder holds exactly this batch, for one recursive upload.
        for (const key of batch) fs.linkSync(clipPath(key, format.extension), path.join(STAGE_DIR, `${key}.${format.extension}`));
        uploadClips(STAGE_DIR, bucket, prefix, format.contentType);
        console.log(`Uploaded ${Math.min(i + BATCH, plan.write.length).toLocaleString('en-US')} of ${plan.write.length.toLocaleString('en-US')}`);
    }
    fs.rmSync(STAGE_DIR, { recursive: true, force: true });
    if (plan.overCap > 0) throw new Error(overCapMessage(plan.overCap, maxUploads));
}

try {
    main();
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
}
