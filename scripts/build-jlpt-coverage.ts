import fs from 'fs';
import path from 'path';
import type { Vocabulary } from '../src/models/vocabulary.model';
import type { JLPTVocabDatasetDTO, JMDict, Word } from '../src/models/data.model';
import { buildKanaKeyOwners, parseJpdbTsv, type JpdbFrequencies, type KanaOwnerOverrides } from './build-common';

/**
 * Writes docs/JLPT_COVERAGE.md: every entry of the JLPT vocabulary list that no
 * word in compiled/vocab answers, grouped by why it is missing and sorted by
 * frequency, so the gaps worth closing come first.
 *
 * GENERATED, never hand-edited. Regenerated on every `bun run build:data`
 * (after build:jlpt), so it always describes the compiled output beside it.
 *
 * An entry counts as covered when a compiled word carries its written form, or,
 * for a kana key, when the word that owns the key (buildKanaKeyOwners) was
 * compiled. Everything else falls into one of four buckets, each with a
 * different remedy: kana-only words need the dataset to accept words without
 * kanji, dropped words need the build's keep rule relaxed, and the last two
 * need curation by hand.
 *
 * Run: `bun run build:jlpt-coverage`.
 */

const VOCAB_DIR = './compiled/vocab';
const JLPT_PATH = './data/raw/jlpt-vocab.json';
const OWNERS_PATH = './data/raw/vocab/jlpt-kana-owners.json';
const JMDICT_PATH = './data/raw/jmdict.json';
const JPDB_PATH = './data/raw/jpdb_v2.2_freq_list_2024-10-13.json';
const JPDB_TSV_PATH = './data/raw/jpdb_v2.2_freq_list_2024-10-13.csv';
const OUTPUT_PATH = './docs/JLPT_COVERAGE.md';

const LEVELS = [5, 4, 3, 2, 1] as const;
const KANA_ONLY = /^[぀-ヿー]+$/;
const KATAKANA_ONLY = /^[゠-ヿー]+$/;
const NO_RANK = Number.MAX_SAFE_INTEGER;

type Bucket = 'katakana' | 'kana-only' | 'dropped' | 'not-in-jmdict';

const BUCKETS: Record<Bucket, { title: string; why: string }> = {
    'kana-only': {
        title: 'Words with no kanji spelling',
        why: 'JMdict has no kanji spelling for these, and the dataset only builds words that have one (build-data.ts skips any entry without kanji). Including them means accepting kana-only words.',
    },
    katakana: {
        title: 'Katakana loanwords',
        why: 'Loanwords have no kanji spelling, so the dataset skips them for the same reason as the kana-only words above.',
    },
    dropped: {
        title: 'Dropped by the build',
        why: 'JMdict spells these with kanji, but the build keeps a word only when its kanji spelling is marked common or occurs in the sentence corpus. These are usually written in kana, so their kanji spelling is neither, and the word never reaches compiled/vocab.',
    },
    'not-in-jmdict': {
        title: 'Not found in JMdict',
        why: 'No JMdict entry is spelled this way. Usually a phrase the list files as one item (コピーする, ゆっくりと), or a spelling JMdict does not record.',
    },
};

interface Gap {
    key: string;
    reading: string;
    level: number;
    bucket: Bucket;
    kanji?: string;
    meaning: string;
    rank: number;
}

function main() {
    const jlpt: JLPTVocabDatasetDTO = JSON.parse(fs.readFileSync(JLPT_PATH, 'utf-8'));
    const overrides: KanaOwnerOverrides = JSON.parse(fs.readFileSync(OWNERS_PATH, 'utf-8'));
    const jmdict: JMDict = JSON.parse(fs.readFileSync(JMDICT_PATH, 'utf-8'));
    const jpdb: JpdbFrequencies = JSON.parse(fs.readFileSync(JPDB_PATH, 'utf-8'));
    const owners = buildKanaKeyOwners(jlpt, jmdict.words, jpdb, overrides);

    // Display ranks come from the TSV rather than the JSON: the JSON keeps the
    // last row of a repeated term/reading pair, which buries common kana words
    // (はい reads 249201 there, 446 in the TSV).
    const jpdbRows = parseJpdbTsv(fs.readFileSync(JPDB_TSV_PATH, 'utf-8')).rows;
    const rank = (term: string, reading: string) => Math.min(
        NO_RANK,
        ...(jpdbRows.get(`${term}|${reading}`) ?? []).map(row => row.kanaFrequency || row.frequency),
    );

    // Every compiled id, including the homographs merged into a base entry,
    // and every written form a compiled word carries.
    const compiledIds = new Set<string>();
    const compiledForms = new Set<string>();
    for (const file of fs.readdirSync(VOCAB_DIR)) {
        if (!file.endsWith('.json')) continue;
        const vocab: Vocabulary = JSON.parse(fs.readFileSync(path.join(VOCAB_DIR, file), 'utf-8'));
        compiledIds.add(vocab.id);
        for (const merged of vocab.mergedVocabs ?? []) compiledIds.add(merged.id);
        compiledForms.add(vocab.writtenForm.kanji);
        for (const form of vocab.writtenForm.alternatives) compiledForms.add(form);
    }

    const byId = new Map<string, Word>();
    const byKanji = new Map<string, Word[]>();
    for (const word of jmdict.words) {
        byId.set(word.id, word);
        for (const k of word.kanji) {
            const list = byKanji.get(k.text) ?? [];
            list.push(word);
            byKanji.set(k.text, list);
        }
    }

    const meaningOf = (word: Word | undefined) =>
        word?.sense[0]?.gloss.slice(0, 3).map(g => g.text).join('; ') ?? '';

    const total: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const gaps: Gap[] = [];

    for (const [key, entries] of Object.entries(jlpt)) {
        // One row per key: the list repeats keys across levels (ここ at N3 and
        // N5), and the word is met at the easiest.
        const own = entries.filter(e => e.reading === key || !KANA_ONLY.test(key));
        if (!own.length) continue;
        const level = Math.max(...own.map(e => e.level));
        const reading = own.find(e => e.level === level)!.reading;
        total[level]++;

        if (compiledForms.has(key)) continue;

        if (KANA_ONLY.test(key)) {
            const ownerId = owners.get(key);
            if (ownerId && compiledIds.has(ownerId)) continue;
            const owner = ownerId ? byId.get(ownerId) : undefined;
            const bucket: Bucket = !owner ? 'not-in-jmdict'
                : owner.kanji.length ? 'dropped'
                : KATAKANA_ONLY.test(key) ? 'katakana' : 'kana-only';
            const keyRank = Math.min(rank(key, key), ...(owner?.kanji ?? []).map(k => rank(k.text, key)));
            gaps.push({ key, reading, level, bucket, kanji: owner?.kanji.map(k => k.text).join('、') || undefined, meaning: meaningOf(owner), rank: keyRank });
            continue;
        }

        const candidates = byKanji.get(key) ?? [];
        const match = candidates.find(w => w.kana.some(k => k.text === reading)) ?? candidates[0];
        gaps.push({
            key,
            reading,
            level,
            bucket: match ? 'dropped' : 'not-in-jmdict',
            meaning: meaningOf(match),
            rank: rank(key, reading),
        });
    }

    const order: Bucket[] = ['kana-only', 'katakana', 'dropped', 'not-in-jmdict'];
    const lines: string[] = [];
    lines.push('# JLPT vocabulary coverage');
    lines.push('');
    lines.push('> GENERATED by `scripts/build-jlpt-coverage.ts` on every `bun run build:data`. Do not edit by hand.');
    lines.push('');
    lines.push('Every entry of the JLPT vocabulary list ([Bluskyo/JLPT_Vocabulary](https://github.com/Bluskyo/JLPT_Vocabulary), via tanos.co.uk) that no word in `compiled/vocab` answers. A list entry is a written form, or a kana spelling owned by one word (see `buildKanaKeyOwners` and `data/raw/vocab/jlpt-kana-owners.json`). Entries listed at several levels count once, at the easiest. Within each group, the most frequent words (JPDB rank) come first.');
    lines.push('');
    lines.push('| Level | List entries | Covered | ' + order.map(b => BUCKETS[b].title).join(' | ') + ' |');
    lines.push('|---|---|---|' + order.map(() => '---').join('|') + '|');
    for (const level of LEVELS) {
        const missing = gaps.filter(g => g.level === level);
        const covered = total[level] - missing.length;
        const pct = Math.round((covered / total[level]) * 100);
        lines.push(`| N${level} | ${total[level]} | ${covered} (${pct}%) | ` + order.map(b => missing.filter(g => g.bucket === b).length).join(' | ') + ' |');
    }
    lines.push('');
    for (const bucket of order) {
        lines.push(`- **${BUCKETS[bucket].title}**: ${BUCKETS[bucket].why}`);
    }

    for (const level of LEVELS) {
        lines.push('');
        lines.push(`## N${level}`);
        for (const bucket of order) {
            const rows = gaps
                .filter(g => g.level === level && g.bucket === bucket)
                .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
            if (!rows.length) continue;
            lines.push('');
            // N5 and N4 are short and are where a gap hurts most: keep them open.
            const open = level >= 4;
            if (!open) lines.push(`<details><summary>${BUCKETS[bucket].title} (${rows.length})</summary>`, '');
            else lines.push(`### ${BUCKETS[bucket].title} (${rows.length})`, '');
            lines.push('| Word | Reading | Kanji in JMdict | Meaning | JPDB rank |');
            lines.push('|---|---|---|---|---|');
            for (const g of rows) {
                const cell = (s: string) => s.replace(/\|/g, '\\|');
                lines.push(`| ${g.key} | ${g.reading === g.key ? '' : g.reading} | ${g.kanji ?? ''} | ${cell(g.meaning)} | ${g.rank === NO_RANK ? '' : g.rank} |`);
            }
            if (!open) lines.push('', '</details>');
        }
    }
    lines.push('');

    fs.writeFileSync(OUTPUT_PATH, lines.join('\n'));
    console.log(`✅ ${OUTPUT_PATH} written: ${gaps.length} uncovered entries.`);
    for (const level of LEVELS) {
        console.log(`   - N${level}: ${gaps.filter(g => g.level === level).length} of ${total[level]} uncovered`);
    }
}

main();
