/** What a build:audio run would write to the bucket. */
export interface UploadPlan {
    /** Clip keys to synthesise and upload, each once, at most the cap. */
    write: string[];
    alreadyThere: number;
    /** Missing keys left for a later run by the cap. */
    overCap: number;
}

/**
 * The writes a run makes: every wanted key not already in the bucket, deduplicated (one
 * clip can serve several items), capped. The cap is the guard on write cost: a bug that
 * changed every key would otherwise rewrite the whole bucket in one run.
 */
export function planUploads(wanted: Iterable<string>, existing: ReadonlySet<string>, maxUploads: number): UploadPlan {
    const missing = new Set<string>();
    const there = new Set<string>();
    for (const key of wanted) (existing.has(key) ? there : missing).add(key);
    const all = [...missing].sort();
    const write = all.slice(0, Math.max(0, maxUploads));
    return { write, alreadyThere: there.size, overCap: all.length - write.length };
}

/** The deploy's cap on writes per run (gokan-srs deploy-site.yml passes the same). */
export const DEFAULT_MAX_UPLOADS = 2000;

/**
 * What a run over its cap says: what is left, and how a run with that many new clips (a first
 * fill, a voice change) gets through.
 */
export function overCapMessage(overCap: number, maxUploads: number): string {
    return `${overCap.toLocaleString('en-US')} clips are left by --max-uploads ${maxUploads.toLocaleString('en-US')}. If that many new clips is expected (a first fill, a voice change), set gokan-srs's AUDIO_MAX_UPLOADS variable (read by staging deploys only), deploy this dataset version to staging, then delete the variable.`;
}

/** S3 Standard, eu-west-3: about $0.005 per 1,000 PUT or LIST requests (check the current rate). */
export const PUT_COST_PER_1000_USD = 0.0054;

export function estimatedPutCost(writes: number): number {
    return (writes / 1000) * PUT_COST_PER_1000_USD;
}
