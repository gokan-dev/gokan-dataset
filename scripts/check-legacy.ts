#!/usr/bin/env bun
// Proves the text layer changed nothing for an app that reads English: the dataset's English
// view (src/layout/english.ts, the one gokan-srs and gokan-dictionary read through) gives back
// every file of the old layout exactly as it was, and no file more or fewer. This is the dataset
// half of phase 2's "nothing changes for a user" (docs/MULTILINGUAL.md, "Phases").
//
// Run: bun run check:legacy [<git ref with the old layout>] [--baseline <dir>]
//
// The old files are read at the git ref (default origin/main). With --baseline, grammar, media
// and the indexes other than search.json are read from <dir> instead (a copy of compiled/'s
// grammar/, media/ and index/ as an earlier build made them), for when the ref's copies differ
// for a reason of their own: origin/main's mined grammar sentences were written in an order a
// since-fixed nondeterminism chose.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { englishView } from '../src/layout/english';

const args = process.argv.slice(2);
const baselineAt = args.indexOf('--baseline');
const BASELINE = baselineAt >= 0 ? args[baselineAt + 1] : undefined;
if (baselineAt >= 0 && !BASELINE) throw new Error('--baseline needs a directory.');
const REF = args.find((a, i) => !a.startsWith('--') && (baselineAt < 0 || i !== baselineAt + 1)) ?? 'origin/main';
const COMPILED_DIR = './compiled';
/** The directories, relative to compiled/, a baseline stands in for. */
const BASELINE_DIRS = ['grammar', 'media', 'index'];
const fromBaseline = (relative: string): boolean =>
    BASELINE !== undefined && relative !== 'index/search.json' && BASELINE_DIRS.some(dir => relative.startsWith(`${dir}/`));

/** Runs git with `input` on stdin, returning its stdout. */
async function git(gitArgs: string[], input = ''): Promise<Buffer> {
    const child = spawn('git', gitArgs, { stdio: ['pipe', 'pipe', 'inherit'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code => (code === 0 ? resolve() : reject(new Error(`git ${gitArgs[0]} exited ${code}`))));
    });
    child.stdin.end(input);
    await done;
    return Buffer.concat(chunks);
}

/** The given paths' contents at REF, read in one `git cat-file --batch` (one process for 70k files). */
async function filesAtRef(paths: string[]): Promise<Map<string, string | null>> {
    const out = await git(['cat-file', '--batch'], paths.map(p => `${REF}:compiled/${p}\n`).join(''));
    const result = new Map<string, string | null>();
    let at = 0;
    for (const p of paths) {
        const lineEnd = out.indexOf(0x0a, at);
        const header = out.subarray(at, lineEnd).toString('utf8');
        at = lineEnd + 1;
        if (header.endsWith(' missing')) { result.set(p, null); continue; }
        const size = Number(header.split(' ')[2]);
        result.set(p, out.subarray(at, at + size).toString('utf8'));
        at += size + 1;
    }
    return result;
}

function walk(root: string, relative: string): string[] {
    const at = path.join(root, relative);
    if (!fs.existsSync(at)) return [];
    return fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap(entry => {
        const rel = `${relative}/${entry.name}`;
        return entry.isDirectory() ? walk(root, rel) : entry.name.endsWith('.log') ? [] : [rel];
    });
}

/** Every file of the old layout, relative to compiled/. */
async function oldFiles(): Promise<string[]> {
    // -z: one NUL-separated name per file, never quoted (git quotes non-ASCII names, such as a kanji's, otherwise).
    const listing = (await git(['ls-tree', '-r', '-z', '--name-only', REF, 'compiled'])).toString('utf8');
    const atRef = listing.split('\0').filter(Boolean).map(p => p.slice('compiled/'.length)).filter(p => !fromBaseline(p));
    const baseline = BASELINE ? BASELINE_DIRS.flatMap(dir => walk(BASELINE, dir)).filter(fromBaseline) : [];
    return [...atRef, ...baseline].sort();
}

async function main(): Promise<void> {
    const view = englishView(COMPILED_DIR);
    const now = view.files();
    const before = await oldFiles();
    const old = await filesAtRef(before.filter(p => !fromBaseline(p)));
    for (const p of before.filter(fromBaseline)) old.set(p, fs.readFileSync(path.join(BASELINE ?? '', p), 'utf8'));

    const failures: string[] = [];
    const nowSet = new Set(now);
    for (const p of before) if (!nowSet.has(p)) failures.push(`${p}: in the old layout but not in the English view`);
    const beforeSet = new Set(before);
    for (const p of now) if (!beforeSet.has(p)) failures.push(`${p}: in the English view but not in the old layout`);

    let checked = 0;
    for (const p of now.filter(p => beforeSet.has(p))) {
        checked++;
        const was = old.get(p);
        if (was === null || was === undefined) { failures.push(`${p}: could not be read as it was`); continue; }
        const same = p.endsWith('.json')
            ? isDeepStrictEqual(view.json(p), JSON.parse(was))
            : fs.readFileSync(path.join(COMPILED_DIR, p), 'utf8') === was;
        if (!same) failures.push(p);
    }

    if (failures.length > 0) {
        console.error(`[check-legacy] ${failures.length} problem(s) over ${checked} files, such as:\n  ${failures.slice(0, 15).join('\n  ')}`);
        process.exit(1);
    }
    const against = BASELINE ? `${REF} (and ${BASELINE} for grammar, media and the other indexes)` : REF;
    console.log(`[check-legacy] the English view gives back all ${checked} files of the old layout exactly as ${against} has them, and no other file.`);
}

await main();
