#!/usr/bin/env bun
// Build check 8 (docs/MULTILINGUAL.md, "Build checks"): the build is deterministic. Hashes every
// file in compiled/, rebuilds everything from the raw sources (bun run build), hashes again, and
// fails on any file that changed, appeared or disappeared. Run it on a tree that was itself just
// built, so a difference can only come from the build, not from an edit.
//
// Run: bun run check:determinism (as long as a full build: about 20 minutes).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COMPILED_DIR = './compiled';

function hashes(dir: string, relative = '', out = new Map<string, string>()): Map<string, string> {
    for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) hashes(dir, rel, out);
        else out.set(rel, createHash('sha256').update(fs.readFileSync(path.join(dir, rel))).digest('hex'));
    }
    return out;
}

const before = hashes(COMPILED_DIR);
console.log(`[check-determinism] ${before.size} files hashed; rebuilding from the raw sources...`);
const build = spawnSync('bun', ['run', 'build'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) throw new Error(`bun run build exited ${build.status}`);
const after = hashes(COMPILED_DIR);

const changed = [...before].filter(([p, h]) => after.has(p) && after.get(p) !== h).map(([p]) => p);
const gone = [...before.keys()].filter(p => !after.has(p));
const added = [...after.keys()].filter(p => !before.has(p));
if (changed.length + gone.length + added.length > 0) {
    console.error(`[check-determinism] the rebuild differs: ${changed.length} changed, ${gone.length} gone, ${added.length} new, such as:\n  ${[...changed, ...gone, ...added].slice(0, 20).join('\n  ')}`);
    process.exit(1);
}
console.log(`[check-determinism] all ${after.size} files are byte-identical after a rebuild from the raw sources.`);
