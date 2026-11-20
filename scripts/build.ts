#!/usr/bin/env bun
// The build, stage by stage, skipping each stage whose inputs are unchanged since its last
// successful run (src/pipeline/stamps.ts). Every stage still writes build/assembled/ and
// build:layout still writes compiled/; this only decides which stages need to run.
//
//   bun scripts/build.ts                 every stage (bun run build)
//   bun scripts/build.ts data grammar    the stages of these groups or names, in pipeline order
//   bun scripts/build.ts --force         deletes build/ (stamps included) and runs every stage
//                                        (also DATASET_BUILD_FORCE=1)
//   bun scripts/build.ts --dry-run       prints which stages would run, and runs none
//
// A run prints what it ran and skipped, with times, and adds the table to the GitHub job summary
// when there is one. Declaring a stage: its script, the sources it reads (`inputs`), the stages
// whose output it reads (`after`), and the stages it must restart (`restart`, see StageSpec).
// An input left out makes the stage skip when it should not; the full rebuild that
// check:determinism runs on main catches that.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { ContentHasher, checkStages, importClosure, planRun, readStamp, removeStamp, stageKey, writeStamp, type StageSpec } from '../src/pipeline/stamps';
import { removeTree } from '../src/utils/removeTree';

const ROOT = '.';
const BUILD_DIR = 'build';
const STAMP_DIR = 'build/.stamps';

/** Every assembled-file stage of build:data rewrites words build-data creates, so each restarts it. */
const DATA_RESTART = ['kanji', 'data'];
/** Likewise every stage of build:grammar after build-grammar reads or rewrites its points. */
const GRAMMAR_RESTART = ['grammar'];
const AUDIO_INPUTS = ['data/audio/clips.json', 'data/audio/voice.json'];
const GRAMMAR_INPUTS = ['data/raw/grammar', 'data/curriculum'];

/** The pipeline, in the order a full build runs it. */
const STAGES: StageSpec[] = [
    // build:data
    { name: 'kanji', script: 'scripts/build-kanji.ts', inputs: ['data/raw/kklc.json', 'data/raw/jpdb_v2.json', 'data/raw/jlpt-kanji.json', 'data/raw/kanji'], after: [] },
    {
        name: 'data', script: 'scripts/build-data.ts', after: ['kanji'], restart: ['kanji'],
        inputs: [
            'data/raw/jmdict.json', 'data/raw/jpdb_v2.2_freq_list_2024-10-13.json', 'data/raw/jpdb_v2.2_freq_list_2024-10-13.csv',
            'data/raw/Sentence pairs in Japanese-English - 2026-02-15.tsv', 'data/raw/jpn_indices.csv', 'data/raw/jlpt', 'data/raw/vocab', 'data/raw/media/jiten',
        ],
    },
    { name: 'jlpt', script: 'scripts/build-jlpt-index.ts', inputs: [], after: ['data'], restart: DATA_RESTART },
    {
        name: 'jlpt-coverage', script: 'scripts/build-jlpt-coverage.ts', after: ['jlpt'], restart: DATA_RESTART, tracked: ['docs/JLPT_COVERAGE.md'],
        inputs: ['data/raw/jlpt', 'data/raw/vocab', 'data/raw/jmdict.json', 'data/raw/jpdb_v2.2_freq_list_2024-10-13.csv'],
    },
    { name: 'synonyms', script: 'scripts/build-synonyms.ts', inputs: ['data/raw/vocab/synonyms.json'], after: ['jlpt-coverage'], restart: DATA_RESTART },
    { name: 'media', script: 'scripts/build-media.ts', inputs: ['data/raw/media'], after: ['synonyms'], restart: DATA_RESTART },
    { name: 'attach-audio-data', script: 'scripts/attach-audio.ts', inputs: AUDIO_INPUTS, after: ['media'], restart: DATA_RESTART },
    { name: 'accent', script: 'scripts/attach-accent.ts', inputs: ['data/raw/accents'], after: ['attach-audio-data'], restart: DATA_RESTART },
    { name: 'text', script: 'scripts/build-text.ts', inputs: ['data/sources', 'data/reviews'], after: ['accent'], restart: DATA_RESTART },
    // build:grammar
    { name: 'grammar', script: 'scripts/build-grammar.ts', inputs: GRAMMAR_INPUTS, after: ['text'] },
    { name: 'curriculum', script: 'scripts/build-curriculum.ts', inputs: GRAMMAR_INPUTS, after: ['grammar'], restart: GRAMMAR_RESTART },
    { name: 'conjugations', script: 'scripts/build-conjugations.ts', inputs: GRAMMAR_INPUTS, after: ['curriculum'], restart: GRAMMAR_RESTART },
    { name: 'browse', script: 'scripts/build-browse-index.ts', inputs: GRAMMAR_INPUTS, after: ['conjugations'], restart: GRAMMAR_RESTART },
    { name: 'curriculum-doc', script: 'scripts/build-curriculum-doc.ts', inputs: GRAMMAR_INPUTS, after: ['browse'], restart: GRAMMAR_RESTART, tracked: ['docs/CURRICULUM.md'] },
    { name: 'grammar-sentences', script: 'scripts/build-grammar-sentences.ts', inputs: GRAMMAR_INPUTS, after: ['curriculum-doc'], restart: GRAMMAR_RESTART },
    { name: 'grammar-ruled-out', script: 'scripts/build-grammar-ruled-out.ts', inputs: GRAMMAR_INPUTS, after: ['grammar-sentences'], restart: GRAMMAR_RESTART },
    // Its writes to words and sentences repeat attach-audio-data's, made from the same manifest, so
    // they change nothing there: only the grammar files it rewrites need a restart.
    { name: 'attach-audio-grammar', script: 'scripts/attach-audio.ts', inputs: AUDIO_INPUTS, after: ['grammar-ruled-out'], restart: GRAMMAR_RESTART },
    // compiled/ and what is made from it. layout's stamp holds compiled/'s hash, so a compiled/ that
    // is not what the build last wrote (another branch's, an edit) is written again.
    { name: 'layout', script: 'scripts/build-layout.ts', inputs: [], after: ['attach-audio-grammar'], tracked: ['compiled'], trackedExclude: ['compiled/schemas', 'compiled/datapackage.json'] },
    { name: 'schemas', script: 'scripts/build-schemas.ts', inputs: ['src/models', 'tsconfig.json'], after: [], tracked: ['compiled/schemas'] },
    { name: 'datapackage', script: 'scripts/build-datapackage.ts', inputs: ['data/sources'], after: ['layout', 'schemas'], tracked: ['compiled/datapackage.json'] },
    { name: 'benchmark', script: 'scripts/benchmark.ts', inputs: ['data/sources', 'data/reviews'], after: ['layout'], tracked: ['docs/multilingual-benchmark/report.md'] },
];

/** The groups package.json runs, by name. */
const GROUPS: Record<string, string[]> = {
    data: STAGES.slice(0, STAGES.findIndex(s => s.name === 'grammar')).map(s => s.name),
    grammar: STAGES.slice(STAGES.findIndex(s => s.name === 'grammar'), STAGES.findIndex(s => s.name === 'layout')).map(s => s.name),
};

interface Outcome {
    stage: string;
    ran: boolean;
    seconds: number;
}

function selection(targets: string[]): Set<string> {
    if (targets.length === 0) return new Set(STAGES.map(s => s.name));
    const names = new Set<string>();
    for (const target of targets) {
        const group = GROUPS[target];
        if (group) group.forEach(n => names.add(n));
        else if (STAGES.some(s => s.name === target)) names.add(target);
        else throw new Error(`unknown stage or group ${target}: one of ${[...Object.keys(GROUPS), ...STAGES.map(s => s.name)].join(', ')}`);
    }
    return names;
}

function summary(outcomes: Outcome[], totalSeconds: number): string {
    const rows = outcomes.map(o => `| ${o.stage} | ${o.ran ? 'ran' : 'skipped'} | ${o.ran ? o.seconds.toFixed(1) : ''} |`);
    const ran = outcomes.filter(o => o.ran).length;
    return [`### Dataset build: ${ran} of ${outcomes.length} stages ran, ${totalSeconds.toFixed(0)} s`, '', '| Stage | | Seconds |', '| --- | --- | --- |', ...rows, ''].join('\n');
}

function main(): void {
    checkStages(STAGES);
    const args = process.argv.slice(2);
    const force = args.includes('--force') || process.env.DATASET_BUILD_FORCE === '1';
    const dryRun = args.includes('--dry-run');
    const unknown = args.filter(a => a.startsWith('--') && a !== '--force' && a !== '--dry-run');
    if (unknown.length > 0) throw new Error(`unknown option ${unknown.join(' ')}: a stage's own options go to its script (bun scripts/<stage>.ts ...)`);
    const selected = selection(args.filter(a => !a.startsWith('--')));
    if (force && !dryRun) {
        console.log('[build] --force: deleting build/ and running every selected stage.');
        removeTree(BUILD_DIR);
    }

    const hasher = new ContentHasher(ROOT);
    const environment = `bun ${process.versions.bun ?? process.version}; bun.lock ${hasher.paths(['bun.lock'])}`;
    const keyOf = (stage: StageSpec): string => stageKey({
        spec: stage,
        environment,
        code: hasher.paths(importClosure(ROOT, stage.script)),
        inputs: hasher.paths(stage.inputs),
        after: Object.fromEntries(stage.after.map(a => [a, readStamp(STAMP_DIR, a)?.run ?? null])),
    });
    const trackedOf = (stage: StageSpec): string => {
        for (const t of stage.tracked ?? []) hasher.forget(t);
        return stage.tracked ? hasher.paths(stage.tracked, stage.trackedExclude) : '';
    };
    const stale = (stage: StageSpec): boolean => {
        const stamp = readStamp(STAMP_DIR, stage.name);
        return stamp === null || stamp.key !== keyOf(stage) || stamp.tracked !== trackedOf(stage);
    };

    const started = performance.now();
    const plan = new Set(planRun(STAGES, selected, stale).map(s => s.name));
    console.log(`[build] ${plan.size} of ${selected.size} stages to run: ${[...plan].join(', ') || 'none'} (planned in ${((performance.now() - started) / 1000).toFixed(1)} s).`);
    if (dryRun) return;
    const outcomes: Outcome[] = [];
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'ran=0\n');
    for (const stage of STAGES.filter(s => selected.has(s.name))) {
        if (!plan.has(stage.name)) {
            outcomes.push({ stage: stage.name, ran: false, seconds: 0 });
            continue;
        }
        // A run that fails or is stopped leaves no stamp, so the stage and those after it run next time.
        removeStamp(STAMP_DIR, stage.name);
        // For CI: build/ has changed and is worth caching, even if this stage then fails.
        if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ran=${outcomes.filter(o => o.ran).length + 1}\n`);
        const key = keyOf(stage);
        console.log(`\n[build] ${stage.name}: bun ${stage.script}${stage.args ? ` ${stage.args.join(' ')}` : ''}`);
        const t0 = performance.now();
        const run = spawnSync('bun', [stage.script, ...(stage.args ?? [])], { stdio: 'inherit', shell: process.platform === 'win32' });
        const seconds = (performance.now() - t0) / 1000;
        if (run.status !== 0) {
            console.error(`[build] ${stage.name} failed (exit ${run.status ?? run.signal}) after ${seconds.toFixed(1)} s.`);
            process.exit(1);
        }
        writeStamp(STAMP_DIR, stage.name, { key, tracked: trackedOf(stage), run: randomUUID() });
        outcomes.push({ stage: stage.name, ran: true, seconds });
    }

    const table = summary(outcomes, (performance.now() - started) / 1000);
    console.log(`\n${table}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
}

main();
