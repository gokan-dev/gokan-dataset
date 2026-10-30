import { spawnSync } from 'child_process';
import fs from 'fs';

/** The first line of every Git LFS pointer file. */
const POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';

export function isLfsPointer(head: string): boolean {
    return head.startsWith(POINTER_PREFIX);
}

function isPointerFile(file: string): boolean {
    const fd = fs.openSync(file, 'r');
    try {
        const head = Buffer.alloc(POINTER_PREFIX.length);
        const read = fs.readSync(fd, head, 0, head.length, 0);
        return isLfsPointer(head.subarray(0, read).toString('utf8'));
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * The `--include` values for `git lfs pull` that fetch these files: their paths, comma-joined
 * in lists that fit one command line, or the whole folder when that is most of it (a first
 * fill, a voice change).
 */
export function lfsIncludes(repoPaths: readonly string[], folder: string, wholeFolderOver = 5000, maxChars = 30_000): string[] {
    if (repoPaths.length === 0) return [];
    if (repoPaths.length > wholeFolderOver) return [`${folder}/**`];
    const lists: string[] = [];
    let current = '';
    for (const p of repoPaths) {
        if (current && current.length + 1 + p.length > maxChars) {
            lists.push(current);
            current = '';
        }
        current = current ? `${current},${p}` : p;
    }
    lists.push(current);
    return lists;
}

/**
 * Makes sure these files hold their content, not their LFS pointer: fetches the ones that are
 * pointers, and fails if any still is. `lfs.fetchexclude` is cleared for the command, since
 * `.lfsconfig` keeps the clips out of every other fetch.
 */
export function ensureLfsContent(files: readonly { file: string; repoPath: string }[], folder: string): void {
    const pointers = files.filter(f => isPointerFile(f.file));
    if (pointers.length === 0) return;
    console.log(`Fetching ${pointers.length.toLocaleString('en-US')} clips from Git LFS...`);
    for (const include of lfsIncludes(pointers.map(p => p.repoPath), folder)) {
        const result = spawnSync('git', ['-c', 'lfs.fetchexclude=', 'lfs', 'pull', `--include=${include}`], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'pipe'] });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`git lfs pull failed: ${result.stderr}`);
    }
    const left = pointers.filter(p => isPointerFile(p.file));
    if (left.length > 0) throw new Error(`${left.length} clips are still LFS pointers after git lfs pull, such as ${left[0].repoPath}`);
}
