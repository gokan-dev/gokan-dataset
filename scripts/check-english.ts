#!/usr/bin/env bun
// Proves the English view changed only on purpose: the view the apps read (src/layout/english.ts,
// through @gokan/dataset-schema/english) is built twice, once by a git ref's own code from that
// ref's compiled/, once by this checkout's code from ./compiled, and every file of the two must
// serialise to the same bytes, with no file more or fewer. A difference is either intended (paste
// the report into the PR) or a regression. Serialised bytes rather than deep equality, so a
// reordered key counts too: it changes the bytes gokan-srs deploys.
//
// Run: bun run check:english [<git ref>]   (default origin/main)
//
// The ref is checked out once into a worktree under node_modules/.cache/ (sparse: src/ and
// compiled/ with only its English text), then moved incrementally on later runs, so only the
// first run pays for a full checkout. Running the ref's own code, not this checkout's, is what
// makes a change to the projections themselves show up.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { englishView, type EnglishView } from '../src/layout/english';

const REF = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'origin/main';
const COMPILED_DIR = './compiled';
const WORKTREE = path.resolve('node_modules', '.cache', 'check-english');
/** What the view reads: the code and the compiled output with its English, no other language. */
const SPARSE = ['/src/', '/compiled/', '!/compiled/text/*/', '/compiled/text/en/'];
const EXAMPLES = 15;

const git = (args: string[], cwd = '.'): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

/**
 * Git inside the cached worktree. The work tree is passed explicitly: in a submodule checkout the
 * shared config sets `core.worktree`, which a linked worktree inherits, so without it git writes
 * the files next to the submodule's git directory instead. The sparse settings are passed the
 * same way, so the repository's config is never changed (and `sparse-checkout set --no-cone`,
 * which git before 2.35 lacks, is not needed).
 */
const gitInWorktree = (args: string[]): string =>
    git(['--work-tree', WORKTREE, '-c', 'core.sparseCheckout=true', '-c', 'core.sparseCheckoutCone=false', ...args], WORKTREE);

/** The ref's tree, checked out sparsely in the cached worktree; created on the first run. */
function checkOut(commit: string): void {
    git(['worktree', 'prune']);
    if (!fs.existsSync(path.join(WORKTREE, '.git'))) {
        fs.rmSync(WORKTREE, { recursive: true, force: true });
        git(['worktree', 'add', '--no-checkout', '--detach', WORKTREE, commit]);
    }
    const gitDir = path.resolve(WORKTREE, git(['rev-parse', '--git-dir'], WORKTREE));
    fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'info', 'sparse-checkout'), `${SPARSE.join('\n')}\n`);
    const top = path.resolve(gitInWorktree(['rev-parse', '--show-toplevel']));
    if (top.toLowerCase() !== WORKTREE.toLowerCase()) throw new Error(`[check-english] the worktree resolves to ${top}, not ${WORKTREE}; refusing to check out.`);
    gitInWorktree(['reset', '--quiet', '--hard', commit]);
}

/** The ref's own englishView, imported from its checkout (the module has no package imports). */
async function viewAtRef(): Promise<EnglishView> {
    const file = path.join(WORKTREE, 'src', 'layout', 'english.ts');
    if (!fs.existsSync(file)) throw new Error(`[check-english] ${REF} has no src/layout/english.ts: it predates the text layer.`);
    // The ref's module has the same shape as this one's: that is what is being compared.
    const module = (await import(pathToFileURL(file).href)) as { englishView: typeof englishView };
    return module.englishView(path.join(WORKTREE, 'compiled'));
}

function serialised(view: EnglishView, compiledDir: string, relative: string): string {
    return relative.endsWith('.json') ? JSON.stringify(view.json(relative)) : fs.readFileSync(path.join(compiledDir, relative), 'utf8');
}

async function main(): Promise<void> {
    const commit = git(['rev-parse', '--verify', `${REF}^{commit}`]);
    checkOut(commit);
    const before = await viewAtRef();
    const now = englishView(COMPILED_DIR);

    const beforeFiles = before.files();
    const nowFiles = now.files();
    const beforeSet = new Set(beforeFiles);
    const nowSet = new Set(nowFiles);
    const removed = beforeFiles.filter(p => !nowSet.has(p));
    const added = nowFiles.filter(p => !beforeSet.has(p));
    const changed: string[] = [];
    for (const p of nowFiles) {
        if (!beforeSet.has(p)) continue;
        if (serialised(before, path.join(WORKTREE, 'compiled'), p) !== serialised(now, COMPILED_DIR, p)) changed.push(p);
    }

    const against = `${REF} (${commit.slice(0, 10)})`;
    const problems = removed.length + added.length + changed.length;
    if (problems === 0) {
        console.log(`[check-english] the English view is unchanged against ${against}: all ${nowFiles.length} files identical, none added or removed.`);
        return;
    }
    const byDir = new Map<string, number>();
    for (const p of changed) {
        const dir = p.includes('/') ? p.slice(0, p.indexOf('/')) : p;
        byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    }
    const lines = [
        `[check-english] the English view differs from ${against}: ${changed.length} changed, ${added.length} added, ${removed.length} removed, of ${nowFiles.length} files.`,
        ...(changed.length > 0 ? [`  changed by directory: ${[...byDir].map(([dir, n]) => `${dir} ${n}`).join(', ')}`] : []),
        ...changed.slice(0, EXAMPLES).map(p => `  changed  ${p}`),
        ...added.slice(0, EXAMPLES).map(p => `  added    ${p}`),
        ...removed.slice(0, EXAMPLES).map(p => `  removed  ${p}`),
        'If the change is intended, paste this report into the PR; otherwise it is a regression.',
    ];
    console.error(lines.join('\n'));
    process.exit(1);
}

await main();
