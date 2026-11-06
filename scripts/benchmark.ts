#!/usr/bin/env bun
// Build check 9 (docs/MULTILINGUAL.md, "Build checks"): the Chinese benchmark, computed from
// compiled/ (src/text/benchmark.ts). Writes docs/multilingual-benchmark/report.md; with --check,
// fails when a number is below its floor in docs/multilingual-benchmark/floors.json; with
// --set-floors, writes that file from this run, and with --add-floors only the floors it lacks (both
// deliberate acts, reviewed in the diff). The gold set's numbers read data/reviews/ too.
//
// Run: bun run build:benchmark (part of bun run build), bun run check:benchmark.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Sentence } from '../src/models/sentence.model';
import type { Rendering, SourceId, TextFile } from '../src/models/text.model';
import {
    benchmarkWord, floorProblems, floorsFrom, LEVELS, measure, reportMarkdown, type BenchmarkTotals, type BenchmarkWord, type Level, type Metrics,
} from '../src/text/benchmark';
import { MANDARIN_FILES } from '../src/text/chineseText';
import { measureGold, type FiledRendering, type TextTally } from '../src/text/goldBenchmark';
import { parseUnihanVariants } from '../src/text/hanScript';
import { sourceCommunities } from '../src/text/registry';
import { readReviews } from '../src/text/reviewFiles';

const COMPILED_DIR = './compiled';
const SOURCES_DIR = './data/sources';
const REVIEWS_DIR = './data/reviews';
const OUT_DIR = './docs/multilingual-benchmark';
const REPORT = path.join(OUT_DIR, 'report.md');
const FLOORS = path.join(OUT_DIR, 'floors.json');
const CHINESE = ['zh-hans', 'zh-hant', 'nan'];
const TATOEBA = 'tatoeba-cmn';

function read<T>(file: string): T {
    // Output of this repository's own build, or its committed floors, already typed by it.
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

const jsonFiles = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : []);
const textDir = (lang: string, relative: string): string => path.join(COMPILED_DIR, 'text', lang, relative);

function main(): Metrics {
    const community = sourceCommunities(SOURCES_DIR);
    const communityOf = (source: SourceId): string => community.get(source) ?? source;

    const levelOf = new Map<string, Level>();
    for (const [level, entries] of Object.entries(read<Record<string, { id: string }[]>>(path.join(COMPILED_DIR, 'index', 'jlpt.json')))) {
        const name = `N${level}`;
        const known = LEVELS.find(l => l === name);
        if (known) for (const e of entries) levelOf.set(e.id, known);
    }

    // Each word's Chinese renderings, from every Chinese file it has.
    const renderingsOf = new Map<string, Rendering[]>();
    const derived = new Set<string>();
    for (const lang of CHINESE) {
        for (const f of jsonFiles(textDir(lang, 'vocab'))) {
            const file = read<TextFile>(path.join(textDir(lang, 'vocab'), f));
            for (const [id, entity] of Object.entries(file.entities)) {
                renderingsOf.set(id, [...(renderingsOf.get(id) ?? []), ...entity.renderings]);
                if (lang === 'zh-hans') for (const r of entity.renderings) countDerived(r, derived);
            }
        }
    }

    // Each sentence's first-hand translations, by script: in which files they appear, and how.
    const translations = new Map<string, { hans?: 'plain' | 'derived' | 'neutral'; hant?: boolean }>();
    const chineseSentences = new Set<string>();
    for (const lang of ['zh-hans', 'zh-hant']) {
        for (const f of jsonFiles(textDir(lang, 'sentences'))) {
            const file = read<TextFile>(path.join(textDir(lang, 'sentences'), f));
            for (const [id, entity] of Object.entries(file.entities)) {
                for (const r of entity.renderings) {
                    if (r.role !== 'translation' || r.source.source !== TATOEBA) continue;
                    chineseSentences.add(id);
                    const key = `${id}\u0000${r.source.ref ?? ''}`;
                    const seen = translations.get(key) ?? {};
                    if (lang === 'zh-hant') seen.hant = true;
                    else {
                        seen.hans = r.lang === 'zh' ? 'neutral' : typeof r.value === 'string' ? 'plain' : 'derived';
                        countDerived(r, derived);
                    }
                    translations.set(key, seen);
                }
            }
        }
    }
    const scripts = { hans: 0, hant: 0, neutral: 0 };
    for (const t of translations.values()) {
        if (t.hans === 'neutral') scripts.neutral++;
        else if (t.hans === 'plain') scripts.hans++;
        else scripts.hant++;
    }

    const words: BenchmarkWord[] = [];
    const pool = new Set<string>();
    for (const f of jsonFiles(path.join(COMPILED_DIR, 'vocab'))) {
        const id = path.basename(f, '.json');
        const sentencesFile = path.join(COMPILED_DIR, 'sentences', f);
        const sentences = fs.existsSync(sentencesFile) ? read<Omit<Sentence, 'text'>[]>(sentencesFile).map(s => s.id) : [];
        for (const s of sentences) pool.add(s);
        words.push(benchmarkWord(levelOf.get(id) ?? 'no level', renderingsOf.get(id) ?? [], communityOf, sentences.length, sentences.filter(s => chineseSentences.has(s)).length));
    }

    const kanji = read<unknown[]>(path.join(COMPILED_DIR, 'kanji.json')).length;
    const labelled = new Set<string>();
    for (const lang of ['zh-hans', 'zh-hant']) {
        const file = textDir(lang, 'kanji.json');
        if (fs.existsSync(file)) for (const id of Object.keys(read<TextFile>(file).entities)) labelled.add(id);
    }
    const totals: BenchmarkTotals = {
        poolSentences: pool.size,
        poolWithChinese: [...pool].filter(s => chineseSentences.has(s)).length,
        translationScripts: scripts,
        kanji,
        kanjiLabelled: labelled.size,
        derivedValues: derived.size,
    };
    return { ...measure(words, totals), ...goldMetrics() };
}

/** The gold set's numbers: the reviews of data/reviews/ against the compiled words' Chinese text. */
function goldMetrics(): Metrics {
    const { reviews, problems } = readReviews(REVIEWS_DIR);
    if (problems.length > 0) throw new Error(`data/reviews/ has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    const goldWords = new Set(reviews.gold.map(g => g.word));
    const renderingsOf = new Map<string, FiledRendering[]>();
    const allWords = new Map<string, TextTally[][]>();
    for (const lang of MANDARIN_FILES) {
        const tallies: TextTally[][] = [];
        for (const f of jsonFiles(textDir(lang, 'vocab'))) {
            for (const [id, entity] of Object.entries(read<TextFile>(path.join(textDir(lang, 'vocab'), f)).entities)) {
                tallies.push(entity.renderings.map(r => ({ source: r.source.source, status: r.status })));
                if (goldWords.has(id)) renderingsOf.set(id, [...(renderingsOf.get(id) ?? []), ...entity.renderings.map(rendering => ({ lang, rendering }))]);
            }
        }
        allWords.set(lang, tallies);
    }
    const variants = parseUnihanVariants(gunzipSync(fs.readFileSync(path.join(SOURCES_DIR, 'unihan', 'Unihan_Variants.txt.gz'))).toString('utf8').split('\n'));
    return measureGold({ gold: reviews.gold, verdicts: reviews.verdicts, renderingsOf, allWords, variants });
}

/** Counts each value the transform wrote once, by its rendering and position (a sentence is in many files). */
function countDerived(r: Rendering, derived: Set<string>): void {
    const values = r.role === 'definition' ? r.senses.flatMap(s => s.glosses) : [r.value];
    values.forEach((v, i) => { if (typeof v !== 'string') derived.add(`${r.id}#${i}`); });
}

const metrics = main();
const mode = process.argv[2];
if (mode === '--set-floors') {
    fs.writeFileSync(FLOORS, `${JSON.stringify(floorsFrom(metrics), null, 2)}\n`);
    console.log(`[benchmark] floors written to ${FLOORS} from this run.`);
} else if (mode === '--add-floors') {
    // Floors for numbers that have none yet, from this run, leaving every existing floor as it is.
    const floors = read<Metrics>(FLOORS);
    const added = Object.entries(floorsFrom(metrics)).filter(([key]) => !(key in floors));
    const merged = Object.fromEntries([...Object.entries(floors), ...added].sort(([a], [b]) => (a < b ? -1 : 1)));
    fs.writeFileSync(FLOORS, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`[benchmark] ${added.length} floors added to ${FLOORS} from this run.`);
} else if (mode === '--check') {
    if (!fs.existsSync(FLOORS)) throw new Error(`${FLOORS} not found: set the floors with bun scripts/benchmark.ts --set-floors.`);
    const problems = floorProblems(metrics, read<Metrics>(FLOORS));
    if (problems.length > 0) {
        console.error(`[check-benchmark] ${problems.length} number(s) below their floor:\n  ${problems.join('\n  ')}`);
        process.exit(1);
    }
    console.log(`[check-benchmark] every number is at or above its floor (${Object.keys(read<Metrics>(FLOORS)).length} floors).`);
} else {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT, reportMarkdown(metrics));
    console.log(`[benchmark] ${Object.keys(metrics).length} numbers -> ${REPORT}`);
}
