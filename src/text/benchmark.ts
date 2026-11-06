// The benchmark as a build stage (docs/MULTILINGUAL.md, build check 9): coverage per source and
// JLPT level, corroboration across communities, and first-hand sentence coverage, computed from
// the compiled output only, so it measures what consumers get. scripts/benchmark.ts reads the
// files; everything here is pure. Each number has a floor in a committed file, and a number
// falling below its floor fails the check.
import type { Rendering, SourceId, SourceRef } from '../models/text.model';
import { goldGuarded, goldReportLines } from './goldBenchmark';

export const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1', 'no level'] as const;
export type Level = (typeof LEVELS)[number];

/** The benchmark's columns: Japanese Wiktionary's two readings are measured apart, as they were. */
export const COLUMNS = ['zhwiktionary', 'jawiktionary-translations', 'jawiktionary-reverse', 'wikidata', 'wikipedia'] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABELS: Record<Column, string> = {
    zhwiktionary: 'zh.wikt definitions',
    'jawiktionary-translations': 'ja.wikt translations',
    'jawiktionary-reverse': 'ja.wikt reverse',
    wikidata: 'Wikidata',
    wikipedia: 'Wikipedia',
};

/** A rendering's or an evidence's column: Japanese Wiktionary's reverse entries are its Chinese sections (`信#中国語`). */
export function columnOf(ref: SourceRef): Column | undefined {
    switch (ref.source) {
        case 'zhwiktionary':
        case 'wikidata':
        case 'wikipedia':
            return ref.source;
        case 'jawiktionary':
            return ref.ref?.endsWith('#中国語') ? 'jawiktionary-reverse' : 'jawiktionary-translations';
        default:
            return undefined;
    }
}

/** What the benchmark needs of one word. */
export interface BenchmarkWord {
    level: Level;
    /** The columns with a text about it. Wikipedia is never displayed, so it counts where it corroborates. */
    covered: Set<Column>;
    corroborated: Set<Column>;
    /** The communities with a text about it, Wikipedia's where it corroborates. */
    communities: Set<string>;
    sentences: number;
    chineseSentences: number;
}

/** A word's row, from its Chinese renderings in every file (a text served in both scripts counts once). */
export function benchmarkWord(level: Level, renderings: Rendering[], community: (source: SourceId) => string, sentences: number, chineseSentences: number): BenchmarkWord {
    const word: BenchmarkWord = { level, covered: new Set(), corroborated: new Set(), communities: new Set(), sentences, chineseSentences };
    for (const r of renderings) {
        const column = columnOf(r.source);
        if (!column) continue;
        word.covered.add(column);
        word.communities.add(community(r.source.source));
        // By its evidence, not its status: a review replaces `corroborated` but keeps what agreed.
        if (r.status === 'corroborated' || (r.evidence ?? []).length > 0) word.corroborated.add(column);
        for (const e of r.evidence ?? []) {
            if (e.source !== 'wikipedia') continue;
            word.covered.add('wikipedia');
            word.communities.add(community(e.source));
        }
    }
    return word;
}

/** Totals the build reports beside the per-word rows. */
export interface BenchmarkTotals {
    /** Japanese sentences in the pool with a first-hand Mandarin translation. */
    poolSentences: number;
    poolWithChinese: number;
    /** The pool's first-hand translations by script: Simplified, Traditional, the same in both. */
    translationScripts: Record<'hans' | 'hant' | 'neutral', number>;
    kanji: number;
    kanjiLabelled: number;
    /** Values written in Simplified by the transform, in zh-hans. */
    derivedValues: number;
}

export type Metrics = Record<string, number>;

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);

const GROUPS: { name: string; levels: readonly Level[] }[] = [
    { name: 'N5-N3', levels: ['N5', 'N4', 'N3'] },
    { name: 'N2-N1', levels: ['N2', 'N1'] },
    { name: 'no level', levels: ['no level'] },
    { name: 'all', levels: LEVELS },
];

/** Every number the report shows and the floors hold, keyed by a stable name. Percentages have one decimal. */
export function measure(words: BenchmarkWord[], totals: BenchmarkTotals): Metrics {
    const metrics: Metrics = {};
    for (const level of [...LEVELS, 'all'] as const) {
        const rows = words.filter(w => level === 'all' || w.level === level);
        const key = level.replace(' ', '-');
        metrics[`words.${key}`] = rows.length;
        for (const column of COLUMNS) metrics[`coverage.${key}.${column}`] = pct(rows.filter(w => w.covered.has(column)).length, rows.length);
        metrics[`coverage.${key}.any`] = pct(rows.filter(w => [...w.covered].some(c => c !== 'wikipedia')).length, rows.length);
        metrics[`coverage.${key}.communities2`] = pct(rows.filter(w => w.communities.size >= 2).length, rows.length);
        metrics[`sentences.${key}.any`] = pct(rows.filter(w => w.sentences >= 1).length, rows.length);
        metrics[`sentences.${key}.chinese1`] = pct(rows.filter(w => w.chineseSentences >= 1).length, rows.length);
        metrics[`sentences.${key}.chinese3`] = pct(rows.filter(w => w.chineseSentences >= 3).length, rows.length);
    }
    for (const group of GROUPS) {
        const key = group.name.replace(' ', '-');
        const defined = words.filter(w => group.levels.includes(w.level) && w.covered.has('zhwiktionary'));
        const checked = defined.filter(w => [...w.communities].some(c => c !== 'zh.wiktionary'));
        const corroborated = defined.filter(w => w.corroborated.has('zhwiktionary'));
        metrics[`zhwiktionary.${key}.words`] = defined.length;
        metrics[`zhwiktionary.${key}.corroborated`] = pct(corroborated.length, defined.length);
        metrics[`zhwiktionary.${key}.contradicted`] = pct(checked.length - corroborated.length, defined.length);
        metrics[`zhwiktionary.${key}.unchecked`] = pct(defined.length - checked.length, defined.length);
    }
    for (const column of COLUMNS) {
        if (column === 'wikipedia') continue;
        const covered = words.filter(w => w.covered.has(column));
        metrics[`corroboration.${column}`] = pct(covered.filter(w => w.corroborated.has(column)).length, covered.length);
    }
    metrics['tatoeba.poolSentences'] = totals.poolSentences;
    metrics['tatoeba.poolWithChinese'] = totals.poolWithChinese;
    for (const script of ['hans', 'hant', 'neutral'] as const) metrics[`tatoeba.script.${script}`] = totals.translationScripts[script];
    metrics['kanji.labelled'] = pct(totals.kanjiLabelled, totals.kanji);
    metrics['script.derivedValues'] = totals.derivedValues;
    return metrics;
}

/**
 * The metrics a floor guards: what should only grow. The split of contradicted and unchecked
 * words moves both ways as sources improve, and the script counts describe the data, so neither
 * has a floor.
 */
export function guarded(key: string): boolean {
    if (key.startsWith('gold.') || key.startsWith('rules.')) return goldGuarded(key);
    return !/\.(contradicted|unchecked)$/.test(key) && !key.startsWith('tatoeba.script.') && key !== 'script.derivedValues';
}

/** Floors set from a run: a percentage one point below, a count 2% below, rounded down. */
export function floorsFrom(metrics: Metrics): Metrics {
    const floors: Metrics = {};
    for (const [key, value] of Object.entries(metrics).sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (!guarded(key)) continue;
        floors[key] = isCount(key) ? Math.floor(value * 0.98) : Math.max(0, Math.floor(value - 1));
    }
    return floors;
}

function isCount(key: string): boolean {
    return key.startsWith('words.') || key.endsWith('.words') || key === 'tatoeba.poolSentences' || key === 'tatoeba.poolWithChinese';
}

/** Every guarded number below its floor, and every floor naming no number. */
export function floorProblems(metrics: Metrics, floors: Metrics): string[] {
    const problems: string[] = [];
    for (const [key, floor] of Object.entries(floors).sort(([a], [b]) => (a < b ? -1 : 1))) {
        const value = metrics[key];
        if (value === undefined) problems.push(`${key}: has a floor (${floor}) but the benchmark no longer measures it`);
        else if (value < floor) problems.push(`${key}: ${value} is below its floor ${floor}`);
    }
    return problems;
}

const percent = (value: number | undefined): string => `${(value ?? 0).toFixed(1)}%`;
/** 35872 as 35,872, without Intl, so no machine's locale data enters the report. */
const integer = (value: number | undefined): string => String(value ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The report, in Markdown, from the metrics alone: no date, so an unchanged dataset gives an unchanged file. */
export function reportMarkdown(metrics: Metrics): string {
    const m = (key: string): number | undefined => metrics[key];
    const levels = [...LEVELS, 'all'] as const;
    const lines: string[] = [
        '# Chinese benchmark',
        '',
        'Generated by `bun run build:benchmark` from the compiled dataset (docs/MULTILINGUAL.md, build check 9). Do not edit: rebuild. `bun run check:benchmark` fails when a number falls below its floor in [floors.json](floors.json).',
        '',
        '## Meanings, per source',
        '',
        'Share of words with at least one text from the source, in zh-hans, zh-hant or nan. Wikipedia is never displayed, so it counts where it corroborates another text; "any" counts displayed sources only, "2+ communities" counts Wikipedia too.',
        '',
        `| Level | Words | ${COLUMNS.map(c => COLUMN_LABELS[c]).join(' | ')} | any | 2+ communities |`,
        `|---|---:|${COLUMNS.map(() => '---:').join('|')}|---:|---:|`,
        ...levels.map(level => {
            const key = level.replace(' ', '-');
            return `| ${level} | ${integer(m(`words.${key}`))} | ${COLUMNS.map(c => percent(m(`coverage.${key}.${c}`))).join(' | ')} | ${percent(m(`coverage.${key}.any`))} | ${percent(m(`coverage.${key}.communities2`))} |`;
        }),
        '',
        '## Corroboration',
        '',
        'A text is corroborated when a text from another community shares an equivalent with it, both in Simplified characters (decision D6).',
        '',
        '| Chinese Wiktionary, words defined | Words | Corroborated | Contradicted | Unchecked |',
        '|---|---:|---:|---:|---:|',
        ...GROUPS.map(g => {
            const key = g.name.replace(' ', '-');
            return `| ${g.name} | ${integer(m(`zhwiktionary.${key}.words`))} | ${percent(m(`zhwiktionary.${key}.corroborated`))} | ${percent(m(`zhwiktionary.${key}.contradicted`))} | ${percent(m(`zhwiktionary.${key}.unchecked`))} |`;
        }),
        '',
        '| Source | Words it covers with a corroborated text |',
        '|---|---:|',
        ...COLUMNS.filter(c => c !== 'wikipedia').map(c => `| ${COLUMN_LABELS[c]} | ${percent(m(`corroboration.${c}`))} |`),
        '',
        '## Example sentences, Tatoeba, first hand only',
        '',
        `${integer(m('tatoeba.poolWithChinese'))} of the pool's ${integer(m('tatoeba.poolSentences'))} Japanese sentences have a first-hand Mandarin translation. Their translations by script: ${integer(m('tatoeba.script.hans'))} Simplified, ${integer(m('tatoeba.script.hant'))} Traditional, ${integer(m('tatoeba.script.neutral'))} the same in both.`,
        '',
        '| Level | Words | ≥1 sentence | ≥1 Chinese | ≥3 Chinese |',
        '|---|---:|---:|---:|---:|',
        ...levels.map(level => {
            const key = level.replace(' ', '-');
            return `| ${level} | ${integer(m(`words.${key}`))} | ${percent(m(`sentences.${key}.any`))} | ${percent(m(`sentences.${key}.chinese1`))} | ${percent(m(`sentences.${key}.chinese3`))} |`;
        }),
        '',
        '## Kanji and script',
        '',
        `${percent(m('kanji.labelled'))} of kanji have a Unihan label (a Mandarin reading, a Simplified or Traditional form). ${integer(m('script.derivedValues'))} values in zh-hans were written in Simplified by the transform \`script:hant-to-hans\` (decision D3).`,
        '',
        ...goldReportLines(metrics),
    ];
    return lines.join('\n');
}
