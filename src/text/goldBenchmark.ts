// The gold set's part of the benchmark (docs/MULTILINGUAL.md, "Corroboration and review", build
// check 9): what the reviews of the gold words say about the texts as they were before review, and
// what each candidate acceptance rule would show. Pure: scripts/benchmark.ts reads the compiled
// files and data/reviews/, and passes them here. The numbers join the benchmark's metrics, so the
// same floors guard them.
import type { LanguageTag, Rendering, SourceId, TextStatus } from '../models/text.model';
import { MANDARIN_FILES } from './chineseText';
import { agree } from './corroborate';
import type { HanVariants } from './hanScript';
import { valueText } from './renderings';
import { GOLD_LEVELS, type GoldLevel, type GoldWord, type Verdict } from './reviews';

/** The statuses a text can have before anyone reviews it: what precision is measured by. */
export const SEEN_STATUSES = ['corroborated', 'imported'] as const;

export const RULES = ['A', 'B', 'C'] as const;
export type Rule = (typeof RULES)[number];

export const RULE_LABELS: Record<Rule, string> = {
    A: 'reviewed or corroborated only',
    B: 'reviewed, corroborated, or imported from a source whose imported precision on the gold set is at least 85%',
    C: 'everything not rejected',
};

/** Rule B's bar for a source's imported texts. */
export const IMPORTED_PRECISION_BAR = 85;

/** One Chinese rendering of a word, with the file it is in. */
export interface FiledRendering {
    lang: LanguageTag;
    rendering: Rendering;
}

/** What one rendering is, as a rule needs it: whole renderings for the gold words only, this for every word. */
export interface TextTally {
    source: SourceId;
    status: TextStatus;
}

export interface GoldInput {
    gold: GoldWord[];
    verdicts: Verdict[];
    /** Each gold word's Chinese renderings, in zh-hans and zh-hant, as compiled (after review). */
    renderingsOf: ReadonlyMap<string, FiledRendering[]>;
    /** Every word's renderings per Mandarin file, after review: what a rule would show across the dataset. */
    allWords: ReadonlyMap<LanguageTag, TextTally[][]>;
    variants: HanVariants;
}

type Metrics = Record<string, number>;
type LevelKey = GoldLevel | 'all';
const LEVEL_KEYS: readonly LevelKey[] = [...GOLD_LEVELS, 'all'];

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((1000 * n) / d) / 10);

/** The texts a rendering gives for matching a gold sense: a note says what a word is not, so it never counts. */
function meaningTexts(r: Rendering): string[] | undefined {
    switch (r.role) {
        case 'definition':
            return r.senses.flatMap(s => s.glosses.map(valueText));
        case 'equivalent':
            return [valueText(r.value)];
        case 'translation':
        case 'label':
        case 'prose':
        case 'note':
            return undefined;
    }
}

/** How many of a word's gold senses some rendering agrees with (the corroboration rule, in Simplified). */
function sensesCovered(word: GoldWord, renderings: Rendering[], v: HanVariants): number {
    const texts = renderings.map(meaningTexts).filter((t): t is string[] => t !== undefined);
    return word.senses.filter(s => texts.some(t => agree(t, s.accept, v))).length;
}

/** Whether a rule shows a text of this source at this status, given the sources rule B admits. */
export function ruleShows(rule: Rule, status: TextStatus, source: SourceId, admitted: ReadonlySet<SourceId>): boolean {
    if (status === 'rejected') return false;
    switch (rule) {
        case 'A':
            return status === 'reviewed' || status === 'corroborated';
        case 'B':
            return status === 'reviewed' || status === 'corroborated' || admitted.has(source);
        case 'C':
            return true;
    }
}

const sortedKeys = <T>(map: Map<string, T>): [string, T][] => [...map].sort(([a], [b]) => (a < b ? -1 : 1));

/** Every gold-set number, keyed as the benchmark's other metrics. Percentages have one decimal. */
export function measureGold(input: GoldInput): Metrics {
    const metrics: Metrics = {};
    const goldById = new Map(input.gold.map(g => [g.word, g]));
    const levelOf = (word: string): GoldLevel | undefined => goldById.get(word)?.level;
    const inLevel = (level: LevelKey, word: string): boolean => level === 'all' || levelOf(word) === level;
    const goldVerdicts = input.verdicts.filter(v => goldById.has(v.entity.id));
    const verdictOf = new Map(goldVerdicts.map(v => [`${v.lang}\u0000${v.rendering}`, v]));
    const before = (f: FiledRendering): TextStatus => verdictOf.get(`${f.lang}\u0000${f.rendering.id}`)?.seen ?? f.rendering.status;

    // (a) precision by the status a text had before review, per level, and per source over all levels
    for (const lang of MANDARIN_FILES) {
        const verdicts = goldVerdicts.filter(v => v.lang === lang);
        for (const level of LEVEL_KEYS) {
            for (const seen of SEEN_STATUSES) {
                const judged = verdicts.filter(v => v.seen === seen && inLevel(level, v.entity.id));
                metrics[`gold.${lang}.${level}.verdicts.${seen}`] = judged.length;
                metrics[`gold.${lang}.${level}.precision.${seen}`] = pct(judged.filter(v => v.decision === 'reviewed').length, judged.length);
            }
        }
        const bySource = new Map<string, Verdict[]>();
        for (const v of verdicts) bySource.set(v.source, [...(bySource.get(v.source) ?? []), v]);
        for (const [source, list] of sortedKeys(bySource)) {
            for (const seen of SEEN_STATUSES) {
                const judged = list.filter(v => v.seen === seen);
                metrics[`gold.${lang}.all.verdicts.${source}.${seen}`] = judged.length;
                metrics[`gold.${lang}.all.precision.${source}.${seen}`] = pct(judged.filter(v => v.decision === 'reviewed').length, judged.length);
            }
        }
    }

    // (b) gold coverage, (c) words with a rejected text, per gold language and level
    const goldLanguages = [...new Set(input.gold.map(g => g.lang))].sort();
    for (const goldLang of goldLanguages) {
        const words = input.gold.filter(g => g.lang === goldLang);
        for (const level of LEVEL_KEYS) {
            const rows = words.filter(g => level === 'all' || g.level === level);
            const senses = rows.reduce((n, g) => n + g.senses.length, 0);
            const covered = rows.reduce((n, g) => n + sensesCovered(g, (input.renderingsOf.get(g.word) ?? []).map(f => f.rendering).filter(r => r.status !== 'rejected'), input.variants), 0);
            const rejected = rows.filter(g => (input.renderingsOf.get(g.word) ?? []).some(f => f.rendering.status === 'rejected')).length;
            metrics[`gold.${goldLang}.${level}.words`] = rows.length;
            metrics[`gold.${goldLang}.${level}.senses`] = senses;
            metrics[`gold.${goldLang}.${level}.coverage`] = pct(covered, senses);
            metrics[`gold.${goldLang}.${level}.rejectedWords`] = pct(rejected, rows.length);
        }
    }

    // The acceptance rule candidates, per Mandarin file: what each shows now, and how it did on the gold words before review.
    for (const lang of MANDARIN_FILES) {
        const admitted = new Set<SourceId>();
        for (const [key, n] of Object.entries(metrics)) {
            const m = new RegExp(`^gold\\.${lang}\\.all\\.verdicts\\.([^.]+)\\.imported$`).exec(key);
            const source = m?.[1];
            if (source && n > 0 && (metrics[`gold.${lang}.all.precision.${source}.imported`] ?? 0) >= IMPORTED_PRECISION_BAR) admitted.add(source);
        }
        const tallies = input.allWords.get(lang) ?? [];
        metrics[`rules.${lang}.texts`] = tallies.reduce((n, w) => n + w.length, 0);
        metrics[`rules.${lang}.words`] = tallies.filter(w => w.length > 0).length;
        metrics[`rules.${lang}.B.admitted`] = admitted.size;
        for (const source of [...admitted].sort()) metrics[`rules.${lang}.B.admits.${source}`] = 1;
        const verdicts = goldVerdicts.filter(v => v.lang === lang);
        for (const rule of RULES) {
            const shows = (t: TextTally): boolean => ruleShows(rule, t.status, t.source, admitted);
            metrics[`rules.${lang}.${rule}.texts`] = tallies.reduce((n, w) => n + w.filter(shows).length, 0);
            metrics[`rules.${lang}.${rule}.words`] = tallies.filter(w => w.some(shows)).length;
            const judged = verdicts.filter(v => ruleShows(rule, v.seen, v.source, admitted));
            metrics[`rules.${lang}.${rule}.verdicts`] = judged.length;
            metrics[`rules.${lang}.${rule}.precision`] = pct(judged.filter(v => v.decision === 'reviewed').length, judged.length);
            let senses = 0;
            let covered = 0;
            for (const g of input.gold) {
                const shown = (input.renderingsOf.get(g.word) ?? []).filter(f => f.lang === lang && ruleShows(rule, before(f), f.rendering.source.source, admitted));
                senses += g.senses.length;
                covered += sensesCovered(g, shown.map(f => f.rendering), input.variants);
            }
            metrics[`rules.${lang}.${rule}.goldCoverage`] = pct(covered, senses);
        }
    }
    return metrics;
}

/** Counts and the rule candidates describe the data and the choice still open, so no floor guards them. */
export function goldGuarded(key: string): boolean {
    return !key.startsWith('rules.') && !/\.(verdicts|senses|words)(\.|$)/.test(key);
}

const percent = (value: number | undefined): string => `${(value ?? 0).toFixed(1)}%`;
const integer = (value: number | undefined): string => String(value ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The report's gold-set sections, from the metrics alone. */
export function goldReportLines(metrics: Metrics): string[] {
    const m = (key: string): number | undefined => metrics[key];
    const share = (rate: string, count: string): string => (m(count) ? `${percent(m(rate))} of ${integer(m(count))}` : 'none');
    const keys = Object.keys(metrics).sort();
    const goldLanguages = [...new Set(keys.flatMap(k => /^gold\.([^.]+)\.all\.coverage$/.exec(k)?.[1] ?? []))];
    if (goldLanguages.length === 0) return [];
    const sourcesIn = (lang: string): string[] => [...new Set(keys.flatMap(k => new RegExp(`^gold\\.${lang}\\.all\\.verdicts\\.([^.]+)\\.imported$`).exec(k)?.[1] ?? []))];
    const lines: string[] = [
        '## Gold set',
        '',
        `The gold words' texts as they were before review (\`seen\` in data/reviews/), scored by the review: precision is the share of reviewed texts accepted. Reviews are provisional (basis \`ai-provisional\`) until a person confirms them. ${goldLanguages.map(l => `${integer(m(`gold.${l}.all.words`))} gold words in ${l}`).join(', ')}.`,
        '',
        `| Level | ${MANDARIN_FILES.flatMap(l => SEEN_STATUSES.map(s => `${l}, ${s}`)).join(' | ')} |`,
        `|---|${MANDARIN_FILES.flatMap(() => SEEN_STATUSES.map(() => '---:')).join('|')}|`,
        ...LEVEL_KEYS.map(level => `| ${level} | ${MANDARIN_FILES.flatMap(l => SEEN_STATUSES.map(s => share(`gold.${l}.${level}.precision.${s}`, `gold.${l}.${level}.verdicts.${s}`))).join(' | ')} |`),
        '',
        `| Source | ${MANDARIN_FILES.flatMap(l => SEEN_STATUSES.map(s => `${l}, ${s}`)).join(' | ')} |`,
        `|---|${MANDARIN_FILES.flatMap(() => SEEN_STATUSES.map(() => '---:')).join('|')}|`,
        ...[...new Set(MANDARIN_FILES.flatMap(sourcesIn))].sort().map(source =>
            `| ${source} | ${MANDARIN_FILES.flatMap(l => SEEN_STATUSES.map(s => share(`gold.${l}.all.precision.${source}.${s}`, `gold.${l}.all.verdicts.${source}.${s}`))).join(' | ')} |`),
        '',
        'Coverage is the share of the gold senses for which a text of the word that is not rejected, in zh-hans or zh-hant, agrees with one of the accepted words (the corroboration rule, in Simplified characters). A note never counts.',
        '',
        ...goldLanguages.flatMap(l => [
            `| ${l} | Words | Senses | Covered | Words with a rejected text |`,
            '|---|---:|---:|---:|---:|',
            ...LEVEL_KEYS.map(level => `| ${level} | ${integer(m(`gold.${l}.${level}.words`))} | ${integer(m(`gold.${l}.${level}.senses`))} | ${percent(m(`gold.${l}.${level}.coverage`))} | ${percent(m(`gold.${l}.${level}.rejectedWords`))} |`),
            '',
        ]),
        '## Acceptance rule candidates',
        '',
        'Which Chinese texts of a word to show is still to be chosen. For each candidate: the word texts it shows now, across the dataset (after review); its precision on the gold words, applied to their texts as they were before review; and the gold senses those texts cover. A note (source `gokan`, `imported`) is shown by C only, since the gold set measures no precision for it.',
        '',
        ...MANDARIN_FILES.flatMap(lang => {
            const admitted = keys.flatMap(k => new RegExp(`^rules\\.${lang}\\.B\\.admits\\.(.+)$`).exec(k)?.[1] ?? []);
            return [
                `${lang}: ${integer(m(`rules.${lang}.texts`))} texts on ${integer(m(`rules.${lang}.words`))} words. Rule B admits ${admitted.length > 0 ? admitted.map(s => `\`${s}\``).join(', ') : 'no source'} (imported precision at least ${IMPORTED_PRECISION_BAR}%).`,
                '',
                '| Rule | Texts shown | Words with a text | Precision on the gold set | Gold senses covered |',
                '|---|---:|---:|---:|---:|',
                ...RULES.map(rule => `| ${rule}: ${RULE_LABELS[rule]} | ${integer(m(`rules.${lang}.${rule}.texts`))} | ${integer(m(`rules.${lang}.${rule}.words`))} | ${share(`rules.${lang}.${rule}.precision`, `rules.${lang}.${rule}.verdicts`)} | ${percent(m(`rules.${lang}.${rule}.goldCoverage`))} |`),
                '',
            ];
        }),
    ];
    return lines;
}
