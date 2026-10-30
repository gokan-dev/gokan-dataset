import { spawnSync } from 'child_process';

/**
 * The audio bucket, through the AWS CLI, so the credentials are whatever the CLI is set up
 * with (a profile, SSO, or environment variables), as for the site deploy.
 */
function aws(args: string[]): string {
    const result = spawnSync('aws', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`aws ${args.slice(0, 2).join(' ')} failed: ${result.stderr}`);
    return result.stdout;
}

/** The clip keys under a prefix: file names without their extension. The CLI pages through the listing itself (1,000 keys per LIST request). */
export function listClipKeys(bucket: string, prefix: string): Set<string> {
    const out = aws(['s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', prefix, '--query', 'Contents[].Key', '--output', 'json']);
    const parsed: unknown = JSON.parse(out || 'null');
    const keys = new Set<string>();
    if (!Array.isArray(parsed)) return keys;
    for (const key of parsed) {
        if (typeof key !== 'string') continue;
        const name = key.slice(prefix.length);
        const dot = name.lastIndexOf('.');
        keys.add(dot > 0 ? name.slice(0, dot) : name);
    }
    return keys;
}

/** Uploads every file in `dir`, one PUT each (clips are far below the multipart threshold), immutable for a year. */
export function uploadClips(dir: string, bucket: string, prefix: string, contentType: string): void {
    aws([
        's3', 'cp', dir, `s3://${bucket}/${prefix}`, '--recursive', '--only-show-errors',
        '--content-type', contentType,
        '--cache-control', 'public, max-age=31536000, immutable',
    ]);
}
