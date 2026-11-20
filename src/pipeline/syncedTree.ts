// Writing a committed output tree (compiled/) in place. A file is written only when its bytes
// differ from what is on disk, and once the run has written everything, the files it did not
// produce are deleted. The tree ends as a clean rebuild would leave it, without emptying it first:
// rewriting about 200,000 unchanged files cost minutes on Windows and made every file look touched.
import fs from 'node:fs';
import path from 'node:path';
import { isUnder } from './stamps';

const toPosix = (p: string): string => p.split(path.sep).join('/');

/**
 * Windows and macOS keep a file's old name when it is rewritten under another case, so there a
 * file on disk counts as produced when only its case differs: pruning it would delete what was just written.
 */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

export class SyncedTree {
    private readonly produced = new Set<string>();
    private lower: Set<string> | null = null;

    private producedLower(): Set<string> {
        this.lower ??= new Set([...this.produced].map(p => p.toLowerCase()));
        return this.lower;
    }
    written = 0;
    unchanged = 0;

    /**
     * @param dir the tree's root.
     * @param keep paths under it, relative to it, that other stages own: never pruned.
     */
    constructor(private readonly dir: string, private readonly keep: readonly string[] = []) {}

    /** Writes a file at `relative` (to the root), unless it already holds exactly these bytes. */
    write(relative: string, content: string | Buffer): void {
        const rel = toPosix(path.normalize(relative));
        if (this.produced.has(rel)) throw new Error(`${rel} is written twice in one run`);
        this.produced.add(rel);
        const file = path.join(this.dir, rel);
        const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
        const stat = fs.statSync(file, { throwIfNoEntry: false });
        if (stat?.isFile() && stat.size === bytes.length && fs.readFileSync(file).equals(bytes)) {
            this.unchanged++;
            return;
        }
        if (stat?.isDirectory()) fs.rmSync(file, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
        this.written++;
    }

    /** Copies a file into the tree at `relative`, as `write` does. */
    copy(from: string, relative: string): void {
        this.write(relative, fs.readFileSync(from));
    }

    /** Deletes every file this run did not produce (outside `keep`), then the folders left empty. Returns how many files. */
    prune(): number {
        let removed = 0;
        const walk = (relative: string): boolean => {
            const entries = fs.readdirSync(path.join(this.dir, relative), { withFileTypes: true });
            let empty = true;
            for (const entry of entries) {
                const rel = relative ? `${relative}/${entry.name}` : entry.name;
                if (this.keep.some(k => isUnder(rel, k))) {
                    empty = false;
                } else if (entry.isDirectory()) {
                    if (walk(rel)) fs.rmdirSync(path.join(this.dir, rel));
                    else empty = false;
                } else if (this.produced.has(rel) || (CASE_INSENSITIVE && this.producedLower().has(rel.toLowerCase()))) {
                    empty = false;
                } else {
                    fs.rmSync(path.join(this.dir, rel));
                    removed++;
                }
            }
            return empty;
        };
        if (fs.existsSync(this.dir)) walk('');
        return removed;
    }
}
