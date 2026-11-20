// Stage stamps for the incremental build (scripts/build.ts). A stage's key hashes everything that
// decides its output: its declared inputs (source files and directories), its script and every
// local module the script imports, the toolchain (Bun's version, bun.lock), its own declaration,
// and the stamps of the stages whose output it reads. After a stage succeeds its key is written to
// build/.stamps/<stage>.json; the next run skips the stage while the key is unchanged.
//
// An upstream stage enters the key through its stamp's run id, not through its output files: every
// run of a stage gets a new id, so whatever reran it (a changed input, a restart, a partial build
// such as bun run build:kanji), the stages reading its output run again after it. Hashing
// build/assembled/ itself would not work: later stages rewrite earlier stages' files in place.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** One build stage, as scripts/build.ts declares it. Paths are relative to the repository root. */
export interface StageSpec {
    name: string;
    /** The script it runs, with `bun`. */
    script: string;
    args?: readonly string[];
    /** Files and directories it reads that are not build output (sources, data the script loads at run time). */
    inputs: readonly string[];
    /** The stages whose output it reads: their stamps enter its key, and it runs whenever one of them runs. */
    after: readonly string[];
    /**
     * The stages that must run again before it whenever it runs: the creators of files it reads or
     * rewrites that a later stage rewrites in place. Run alone on such a file, it would see (or
     * stack its change on) what that later stage did on the last run, which a clean build never shows it.
     */
    restart?: readonly string[];
    /** Its committed outputs (outside build/): a stamp holds their hash, so an edited or stale copy runs it again. */
    tracked?: readonly string[];
    /** Paths under `tracked` that other stages own, left out of its hash. */
    trackedExclude?: readonly string[];
}

/** What a successful run leaves: its key, the hash of its committed outputs, and the run's own id. */
export interface Stamp {
    key: string;
    tracked: string;
    run: string;
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

const toPosix = (p: string): string => p.split(path.sep).join('/');

/** Under `prefix`, or `prefix` itself. */
export const isUnder = (rel: string, prefix: string): boolean => rel === prefix || rel.startsWith(`${prefix}/`);

/** Hashes files under a root, remembering each file's hash for the run: stages share many sources. */
export class ContentHasher {
    private readonly memo = new Map<string, string>();

    constructor(private readonly root: string) {}

    private fileHash(rel: string): string {
        let hash = this.memo.get(rel);
        if (hash === undefined) {
            hash = sha256(fs.readFileSync(path.join(this.root, rel)));
            this.memo.set(rel, hash);
        }
        return hash;
    }

    /** Every file under `rel` (or `rel` itself), as sorted repository paths; none if it does not exist. */
    files(rel: string, exclude: readonly string[] = []): string[] {
        const out: string[] = [];
        const walk = (at: string): void => {
            if (exclude.some(e => isUnder(at, e))) return;
            const stat = fs.statSync(path.join(this.root, at), { throwIfNoEntry: false });
            if (!stat) return;
            if (!stat.isDirectory()) {
                out.push(at);
                return;
            }
            for (const name of fs.readdirSync(path.join(this.root, at)).sort()) walk(`${at}/${name}`);
        };
        walk(toPosix(path.normalize(rel)));
        return out.sort();
    }

    /**
     * One hash for files and directories: each file's path and content, in order. A path that does not
     * exist hashes as absent, so creating it changes the hash.
     */
    paths(rels: readonly string[], exclude: readonly string[] = []): string {
        const hash = createHash('sha256');
        for (const rel of [...rels].sort()) {
            const files = this.files(rel, exclude);
            if (files.length === 0) hash.update(`${rel}\0absent\n`);
            for (const f of files) hash.update(`${f}\0${this.fileHash(f)}\n`);
        }
        return hash.digest('hex');
    }

    /** Forgets the files under `rel`: a stage just rewrote them. */
    forget(rel: string): void {
        for (const key of this.memo.keys()) if (isUnder(key, rel)) this.memo.delete(key);
    }
}

const IMPORT = /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm;

/** The file a relative import names: as written, or with `.ts`, or its folder's `index.ts`. */
function resolveImport(root: string, fromFile: string, specifier: string): string {
    const base = path.posix.join(path.posix.dirname(fromFile), specifier);
    for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
        const stat = fs.statSync(path.join(root, candidate), { throwIfNoEntry: false });
        if (stat?.isFile()) return candidate;
    }
    throw new Error(`${fromFile}: cannot resolve the import ${specifier}`);
}

/** A script and every local module (or JSON file) it imports, directly or not, as sorted repository paths. */
export function importClosure(root: string, entry: string): string[] {
    const seen = new Set<string>();
    const pending = [toPosix(path.normalize(entry))];
    while (pending.length > 0) {
        const file = pending.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        if (!file.endsWith('.ts')) continue;
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        for (const match of source.matchAll(IMPORT)) {
            const specifier = match[1] ?? match[2] ?? match[3];
            if (specifier) pending.push(resolveImport(root, file, specifier));
        }
    }
    return [...seen].sort();
}

/** What a stage's key is made of. */
export interface KeyParts {
    spec: StageSpec;
    /** The toolchain: Bun's version and the lockfile's hash. */
    environment: string;
    /** The hash of its script and the modules it imports. */
    code: string;
    /** The hash of its declared inputs. */
    inputs: string;
    /** Each upstream stage's run id, or null for one that never ran. */
    after: Record<string, string | null>;
}

/** Bumped when the key's recipe changes, so every stamp written by an older recipe is stale. */
export const STAMP_FORMAT = 1;

export function stageKey(parts: KeyParts): string {
    const { spec, ...rest } = parts;
    return sha256(JSON.stringify({ format: STAMP_FORMAT, spec, ...rest }));
}

const stampFile = (dir: string, name: string): string => path.join(dir, `${name}.json`);

function isStamp(value: unknown): value is Stamp {
    return typeof value === 'object' && value !== null && 'key' in value && typeof value.key === 'string' && 'tracked' in value && typeof value.tracked === 'string' && 'run' in value && typeof value.run === 'string';
}

/** The stamp of the stage's last successful run, or null (never run, or a run that did not finish). */
export function readStamp(dir: string, name: string): Stamp | null {
    const file = stampFile(dir, name);
    if (!fs.existsSync(file)) return null;
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isStamp(value) ? value : null;
}

export function writeStamp(dir: string, name: string, stamp: Stamp): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stampFile(dir, name), `${JSON.stringify(stamp, null, 2)}\n`);
}

export function removeStamp(dir: string, name: string): void {
    fs.rmSync(stampFile(dir, name), { force: true });
}

/**
 * The stages to run, in pipeline order: of the selected stages, those whose stamp is stale
 * (`stale`), those reading the output of a stage that runs, and those a running stage restarts,
 * until nothing more is added. A stage outside the selection never runs: its stamp is taken as it is.
 */
export function planRun(stages: readonly StageSpec[], selected: ReadonlySet<string>, stale: (stage: StageSpec) => boolean): StageSpec[] {
    const inPlan = stages.filter(s => selected.has(s.name));
    const runs = new Set(inPlan.filter(stale).map(s => s.name));
    for (let grew = true; grew; ) {
        grew = false;
        for (const stage of inPlan) {
            const mark = (name: string): void => {
                if (selected.has(name) && !runs.has(name)) {
                    runs.add(name);
                    grew = true;
                }
            };
            if (stage.after.some(a => runs.has(a))) mark(stage.name);
            if (runs.has(stage.name)) for (const r of stage.restart ?? []) mark(r);
        }
    }
    return inPlan.filter(s => runs.has(s.name));
}

/** Checks a pipeline's declarations: unique names, and every stage it names declared before it. */
export function checkStages(stages: readonly StageSpec[]): void {
    const seen = new Set<string>();
    for (const stage of stages) {
        if (seen.has(stage.name)) throw new Error(`stage ${stage.name} is declared twice`);
        for (const other of [...stage.after, ...(stage.restart ?? [])]) {
            if (!seen.has(other)) throw new Error(`stage ${stage.name} names ${other}, which is not declared before it`);
        }
        seen.add(stage.name);
    }
}
