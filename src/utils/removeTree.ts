// Removing a build output directory (compiled/ before build:layout writes it again). On Windows a
// scanner or an indexer opening the files just written holds them for a while, and the removal
// fails with EBUSY: Node's own retries (maxRetries 10, a linear backoff of 200ms, about 11s in
// all) were not enough on a 200,000-file tree, which failed a full rebuild on 2026-11-06. This
// retries for up to about two and a half minutes before failing the build.
import fs from 'node:fs';

/** Node waits retryDelay times the attempt number between attempts: 200ms x (1 + ... + 38) is about 148s. */
export const REMOVE_RETRIES = 38;
export const REMOVE_RETRY_DELAY_MS = 200;

/** Removes a file or a directory tree, if it exists, retrying a busy file instead of failing at once. */
export function removeTree(target: string): void {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: REMOVE_RETRIES, retryDelay: REMOVE_RETRY_DELAY_MS });
}
