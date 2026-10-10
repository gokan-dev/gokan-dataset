import fs from 'fs';
import path from 'path';
import type { Vocabulary } from '../src/models/vocabulary.model';
import type { JMDict, Word } from '../src/models/data.model';
import { parseJpdbTsv } from './build-common';
import { readWallerDecks, readWallerIdList, resolveJlptLevels, type JlptCorrections, type JlptSource, type JmdictWordLike } from './jlpt-levels';

/**
 * Writes docs/JLPT_COVERAGE.md: where every JLPT-levelled JMdict entry ended up in
 * compiled/vocab, which ones no compiled word answers (grouped by why, most frequent
 * first, so the gaps worth closing come first), and every hand correction, deck fill
 * and derived level, so a review of the levels starts from one page.
 *
 * Levels come from jlpt-levels.ts, keyed by JMdict id, so "covered" is exact: the
 * entry is a compiled word, or a homograph merged into one. A merged homograph read
 * differently from its base keeps its own level out of the base (辛い/からい N5 does
 * not make 辛い/つらい N5), and is listed here so that loss stays visible.
 *
 * GENERATED, never hand-edited. Regenerated on every `bun run build:data`.
 *
 * Run: `bun run build:jlpt-coverage`.
 */

const VOCAB_DIR = './compiled/vocab';
const ID_LIST_DIR = './data/raw/jlpt/waller-ids';
const DECKS_DIR = './data/raw/jlpt/waller-decks';
const CORRECTIONS_PATH = './data/raw/vocab/jlpt-corrections.json';
const JMDICT_PATH = './data/raw/jmdict.json';
const JPDB_TSV_PATH = './data/raw/jpdb_v2.2_freq_list_2024-10-13.csv';
const OUTPUT_PATH = './docs/JLPT_COVERAGE.md';

const LEVELS = [5, 4, 3, 2, 1] as const;
const KATAKANA_ONLY = /^[゠-ヿー]+$/;
const NO_RANK = Number.MAX_SAFE_INTEGER;

type Bucket = 'kana-only' | 'katakana' | 'absorbed' | 'unbuildable';

const BUCKETS: Record<Bucket, { title: string; why: string }> = {
    'kana-only': {
        title: 'Words with no kanji spelling',
        why: 'JMdict has no kanji spelling for these, and the dataset only builds words that have one (build-data.ts skips any entry without kanji). Including them means accepting kana-only words.',
    },
    katakana: {
        title: 'Katakana loanwords',
        why: 'Loanwords have no kanji spelling, so the dataset skips them for the same reason as the kana-only words above.',
    },
    absorbed: {
        title: 'Merged under another reading',
        why: 'A homograph merged into a word read differently. Its level stays out of that word, which is a different word to the learner (see build-data.ts, MERGE EXACT KANJI HOMOGRAPHS).',
    },
    unbuildable: {
        title: 'Not buildable',
        why: 'JMdict spells these with kanji, but not with a CJK headword the build can use (ＯＫ, ０), or only with kanji outside every KKLC step.',
    },
};

const SOURCE_TITLES: Record<JlptSource | 'derived', string> = {
    list: 'Id list',
    deck: 'Deck fill',
    'deck-kana': 'Deck fill (kana)',
    override: 'Hand-set',
    derived: 'Derived',
};

interface Gap {
    id: string;
    word: string;
    reading: string;
    level: number;
    bucket: Bucket;
    meaning: string;
    rank: number;
    note?: string;
}

const cell = (s: string) => s.replace(/\|/g, '\\|');

function main() {
    const jmdict: JMDict = JSON.parse(fs.readFileSync(JMDICT_PATH, 'utf-8'));
    const corrections: JlptCorrections = JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf-8'));
    const byId = new Map<string, Word>(jmdict.words.map(w => [w.id, w]));
    const asLike = new Map<string, JmdictWordLike>(jmdict.words.map(w => [w.id, {
        id: w.id,
        kanji: w.kanji.map(k => ({ text: k.text, tags: k.tags as unknown as string[] })),
        kana: w.kana.map(k => ({ text: k.text, common: k.common, tags: k.tags as unknown as string[], appliesToKanji: k.appliesToKanji })),
        sense: w.sense.map(s => ({ misc: s.misc as unknown as string[] })),
    }]));
    const jlpt = resolveJlptLevels(asLike, readWallerIdList(ID_LIST_DIR), readWallerDecks(DECKS_DIR), corrections);

    // Display ranks come from the TSV rather than the JSON, which keeps the last row
    // of a repeated term/reading pair (はい reads 249201 there, 446 in the TSV).
    const jpdbRows = parseJpdbTsv(fs.readFileSync(JPDB_TSV_PATH, 'utf-8')).rows;
    const rankOf = (w: Word) => Math.min(NO_RANK, ...w.kana.flatMap(kana => [
        ...(jpdbRows.get(`${kana.text}|${kana.text}`) ?? []).map(r => r.frequency),
        ...w.kanji.flatMap(k => (jpdbRows.get(`${k.text}|${kana.text}`) ?? []).map(r => r.kanaFrequency || r.frequency)),
    ]));

    // Compiled words, and each absorbed homograph -> the word it lives under.
    const compiled = new Map<string, Vocabulary>();
    const baseOf = new Map<string, Vocabulary>();
    for (const file of fs.readdirSync(VOCAB_DIR)) {
        if (!file.endsWith('.json')) continue;
        const vocab: Vocabulary = JSON.parse(fs.readFileSync(path.join(VOCAB_DIR, file), 'utf-8'));
        compiled.set(vocab.id, vocab);
        for (const merged of vocab.mergedVocabs ?? []) if (!merged.isBase) baseOf.set(merged.id, vocab);
    }

    const meaningOf = (w: Word) => w.sense[0]?.gloss.slice(0, 3).map(g => g.text).join('; ') ?? '';
    const total: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const bySource: Record<number, Record<string, number>> = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} };
    const gaps: Gap[] = [];

    for (const [id, { level, source }] of jlpt.levels) {
        total[level]++;
        bySource[level][source] = (bySource[level][source] ?? 0) + 1;
        if (compiled.has(id)) continue;
        const w = byId.get(id)!;
        const word = w.kanji[0]?.text ?? w.kana[0].text;
        const reading = w.kana[0].text;
        const base = baseOf.get(id);
        if (base) {
            if ((base.jlptLevel ?? 0) >= level) continue;
            gaps.push({ id, word, reading, level, bucket: 'absorbed', meaning: meaningOf(w), rank: rankOf(w), note: `${base.writtenForm.kanji}/${base.reading.primary} (${base.jlptLevel ? 'N' + base.jlptLevel : 'no level'})` });
            continue;
        }
        const bucket: Bucket = w.kanji.length ? 'unbuildable' : KATAKANA_ONLY.test(reading) ? 'katakana' : 'kana-only';
        gaps.push({ id, word: w.kanji.length ? word : '', reading, level, bucket, meaning: meaningOf(w), rank: rankOf(w) });
    }

    const derived = [...compiled.values()].filter(v => v.jlptLevelFrom);
    for (const v of derived) bySource[v.jlptLevel!].derived = (bySource[v.jlptLevel!].derived ?? 0) + 1;

    const order: Bucket[] = ['kana-only', 'katakana', 'absorbed', 'unbuildable'];
    const sources: Array<JlptSource | 'derived'> = ['list', 'deck', 'deck-kana', 'override', 'derived'];
    const lines: string[] = [];
    lines.push('# JLPT vocabulary coverage');
    lines.push('');
    lines.push('> GENERATED by `scripts/build-jlpt-coverage.ts` on every `bun run build:data`. Do not edit by hand.');
    lines.push('');
    lines.push("Levels come from Jonathan Waller's JLPT lists (tanos.co.uk, the data jisho.org shows), resolved per JMdict entry by `scripts/jlpt-levels.ts` from two copies: the id list ([stephenmk/yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab)), which assigns every entry a JMdict id by hand, and Waller's Anki decks ([jamsinclair/open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks)), which only fill entries the id list lacks. An entry listed at several levels counts once, at the easiest. Within each group below, the most frequent words (JPDB rank) come first.");
    lines.push('');
    lines.push('## Where the levels come from');
    lines.push('');
    lines.push('| Level | ' + sources.map(s => SOURCE_TITLES[s]).join(' | ') + ' |');
    lines.push('|---|' + sources.map(() => '---').join('|') + '|');
    for (const level of LEVELS) lines.push(`| N${level} | ` + sources.map(s => bySource[level][s] ?? 0).join(' | ') + ' |');
    lines.push('');
    lines.push('- **Id list**: an entry of the id list, after the remaps below.');
    lines.push('- **Deck fill**: an entry only the decks have, matched on its exact spelling and reading.');
    lines.push('- **Deck fill (kana)**: a deck entry written in kana, given to the one word usually written in kana whose common spelling it is.');
    lines.push('- **Hand-set**: `levels` in `data/raw/vocab/jlpt-corrections.json`.');
    lines.push("- **Derived**: a compiled word formed from a listed word by one affix, taking its level (`scripts/jlpt-derived.ts`). Counted on compiled words, not JMdict entries.");
    lines.push('');
    lines.push('## Coverage');
    lines.push('');
    lines.push('| Level | Levelled entries | Covered | ' + order.map(b => BUCKETS[b].title).join(' | ') + ' |');
    lines.push('|---|---|---|' + order.map(() => '---').join('|') + '|');
    for (const level of LEVELS) {
        const missing = gaps.filter(g => g.level === level);
        const covered = total[level] - missing.length;
        lines.push(`| N${level} | ${total[level]} | ${covered} (${Math.round((covered / total[level]) * 100)}%) | ` + order.map(b => missing.filter(g => g.bucket === b).length).join(' | ') + ' |');
    }
    lines.push('');
    for (const bucket of order) lines.push(`- **${BUCKETS[bucket].title}**: ${BUCKETS[bucket].why}`);

    lines.push('');
    lines.push('## Hand corrections');
    lines.push('');
    lines.push('| Row | Id list entry | Corrected to | Why |');
    lines.push('|---|---|---|---|');
    for (const [from, { to, key, why }] of Object.entries(corrections.remap)) {
        const t = byId.get(to)!;
        lines.push(`| ${key} | ${from} | ${to} ${t.kanji[0]?.text ?? ''}/${t.kana[0].text} | ${cell(why)} |`);
    }
    for (const [id, { level, word, why }] of Object.entries(corrections.levels)) lines.push(`| ${word} | (none) | ${id}, N${level} | ${cell(why)} |`);
    lines.push('');
    lines.push(`Reviewed and kept as the id list has them: ${Object.values(corrections.keep).map(k => k.key).join(', ')}.`);

    lines.push('');
    lines.push(`<details><summary>Derived levels (${derived.length})</summary>`, '');
    lines.push('| Word | Reading | Level | Formed from |');
    lines.push('|---|---|---|---|');
    for (const v of derived.sort((a, b) => b.jlptLevel! - a.jlptLevel! || a.writtenForm.kanji.localeCompare(b.writtenForm.kanji))) {
        const from = compiled.get(v.jlptLevelFrom!)!;
        lines.push(`| ${v.writtenForm.kanji} | ${v.reading.primary} | N${v.jlptLevel} | ${from.writtenForm.kanji}/${from.reading.primary} |`);
    }
    lines.push('', '</details>');

    for (const level of LEVELS) {
        lines.push('');
        lines.push(`## N${level}`);
        for (const bucket of order) {
            const rows = gaps.filter(g => g.level === level && g.bucket === bucket).sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
            if (!rows.length) continue;
            lines.push('');
            // N5 and N4 are short and are where a gap hurts most: keep them open.
            const open = level >= 4;
            if (!open) lines.push(`<details><summary>${BUCKETS[bucket].title} (${rows.length})</summary>`, '');
            else lines.push(`### ${BUCKETS[bucket].title} (${rows.length})`, '');
            const absorbed = bucket === 'absorbed';
            lines.push(`| Word | Reading | Meaning | JPDB rank |${absorbed ? ' Merged into |' : ''}`);
            lines.push(`|---|---|---|---|${absorbed ? '---|' : ''}`);
            for (const g of rows) {
                lines.push(`| ${g.word} | ${g.reading} | ${cell(g.meaning)} | ${g.rank === NO_RANK ? '' : g.rank} |${absorbed ? ` ${g.note} |` : ''}`);
            }
            if (!open) lines.push('', '</details>');
        }
    }

    lines.push('');
    lines.push('## Deck rows left unmatched');
    lines.push('');
    lines.push(`The id list leaves ${jlpt.unidentifiedListRows.length} rows without an id (single-kanji readings such as 依/い, not words). Deck rows written with kanji match an entry only on their exact spelling and reading; ${jlpt.ambiguousDeckRows.length} match several entries and ${jlpt.unmatchedDeckRows.length} match none (mostly affixes such as ～式, and spellings JMdict does not record). Rows the id list already covers lose nothing.`);
    lines.push('');
    lines.push('<details><summary>Rows</summary>', '');
    lines.push('| Deck entry | Reading | Level | Matches |');
    lines.push('|---|---|---|---|');
    for (const r of jlpt.ambiguousDeckRows) lines.push(`| ${r.expression} | ${r.reading} | N${r.level} | several |`);
    for (const r of jlpt.unmatchedDeckRows) lines.push(`| ${r.expression} | ${r.reading} | N${r.level} | none |`);
    lines.push('', '</details>');
    lines.push('');

    fs.writeFileSync(OUTPUT_PATH, lines.join('\n'));
    console.log(`✅ ${OUTPUT_PATH} written: ${gaps.length} uncovered entries.`);
    for (const level of LEVELS) console.log(`   - N${level}: ${gaps.filter(g => g.level === level).length} of ${total[level]} uncovered`);
}

main();
