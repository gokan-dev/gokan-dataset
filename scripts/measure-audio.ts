import fs from 'fs';
import path from 'path';
import { rankForNewLearner } from '../src/audio/ranking';
import type { Sentence } from '../src/models/sentence.model';
import type { Vocabulary } from '../src/models/vocabulary.model';

/**
 * Measures how much of the compiled dataset Tatoeba's recordings can voice, and how much
 * would be left to text-to-speech (gokan-srs#164). Its result (1.4% recorded, 11 under
 * CC BY) is why every clip is TTS. Run by hand, never part of a build:
 *
 *   curl -sO https://downloads.tatoeba.org/exports/sentences_with_audio.tar.bz2
 *   tar xjf sentences_with_audio.tar.bz2
 *   bun scripts/measure-audio.ts path/to/sentences_with_audio.csv
 *
 * The export has no language column, so a recording counts only when its sentence id is
 * one of ours. A sentence recorded several times is credited with its most permissive
 * licence: that is the recording a build would pick.
 */

const SENTENCES_DIR = './compiled/sentences';
const VOCAB_DIR = './compiled/vocab';
const GRAMMAR_DIRS = ['./compiled/grammar/points', './compiled/grammar/mined'];

/** Most permissive first; '' is a recording whose owner gave no licence (Tatoeba only). */
const LICENSE_ORDER = ['CC0 1.0', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-NC 4.0', 'CC BY-NC-ND 3.0', ''] as const;
type License = (typeof LICENSE_ORDER)[number];

/** How many of a word's best-ranked sentences count as shown. */
const TOP_N = [1, 3, 5] as const;

/** Opus speech at ~24 kbps, a sentence at ~7 kana per second plus ~0.4 s of silence around it. */
const BYTES_PER_SECOND = 24_000 / 8;
const KANA_PER_SECOND = 7;
const PADDING_SECONDS = 0.4;

interface Recording {
    license: License;
    speaker: string;
}

interface GrammarExampleFile {
    examples?: { jp: string }[];
}

function readRecordings(file: string): Map<string, Recording> {
    const best = new Map<string, Recording>();
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        const [sentenceId, , speaker = '', rawLicense = ''] = line.split('\t');
        const license = LICENSE_ORDER.find(l => l === rawLicense) ?? '';
        const current = best.get(sentenceId);
        if (!current || LICENSE_ORDER.indexOf(license) < LICENSE_ORDER.indexOf(current.license)) {
            best.set(sentenceId, { license, speaker });
        }
    }
    return best;
}

function readJson<T>(file: string): T {
    // Compiled output of this repo's own build, already typed by it.
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/** A sentence's spoken length in kana: its matched words' readings, every other character as one. */
function kanaLength(sentence: Sentence): number {
    let length = sentence.original.length;
    for (const spans of Object.values(sentence.matches ?? {})) {
        for (const span of spans) length += (span.reading?.length ?? span.length) - span.length;
    }
    return length;
}

function clipBytes(kana: number): number {
    return (kana / KANA_PER_SECOND + PADDING_SECONDS) * BYTES_PER_SECOND;
}

interface Tally {
    total: number;
    characters: number;
    kana: number;
    byLicense: Map<License, number>;
    speakers: Set<string>;
    /** Characters of the sentences with no recording under an open licence (CC0, BY, BY-SA). */
    ttsCharacters: number;
    ttsCount: number;
}

function newTally(): Tally {
    return { total: 0, characters: 0, kana: 0, byLicense: new Map(), speakers: new Set(), ttsCharacters: 0, ttsCount: 0 };
}

const OPEN: ReadonlySet<License> = new Set(['CC0 1.0', 'CC BY 4.0', 'CC BY-SA 4.0']);

function count(tally: Tally, id: string | null, text: string, kana: number, recordings: Map<string, Recording>): void {
    tally.total++;
    tally.characters += text.length;
    tally.kana += kana;
    const recording = id === null ? undefined : recordings.get(id);
    if (recording) {
        tally.byLicense.set(recording.license, (tally.byLicense.get(recording.license) ?? 0) + 1);
        tally.speakers.add(recording.speaker);
    }
    if (!recording || !OPEN.has(recording.license)) {
        tally.ttsCount++;
        tally.ttsCharacters += text.length;
    }
}

function percent(part: number, whole: number): string {
    return whole === 0 ? '0%' : `${((100 * part) / whole).toFixed(1)}%`;
}

function megabytes(bytes: number): string {
    return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

function report(name: string, tally: Tally): string {
    const recorded = [...tally.byLicense.values()].reduce((a, b) => a + b, 0);
    const rows = LICENSE_ORDER.filter(l => tally.byLicense.has(l)).map(
        l => `| ${l || '(none: Tatoeba only)'} | ${tally.byLicense.get(l)} | ${percent(tally.byLicense.get(l) ?? 0, tally.total)} |`
    );
    const meanKana = tally.total === 0 ? 0 : tally.kana / tally.total;
    return [
        `#### ${name}`,
        '',
        `${tally.total} sentences, ${tally.characters} characters (${(tally.characters / Math.max(1, tally.total)).toFixed(1)} on average). ` +
            `Recorded: ${recorded} (${percent(recorded, tally.total)}), by ${tally.speakers.size} speakers.`,
        '',
        '| Best licence | Sentences | Share |',
        '|---|---:|---:|',
        ...rows,
        '',
        `Left to TTS if only CC0 / BY / BY-SA are allowed: ${tally.ttsCount} sentences, ${tally.ttsCharacters} characters. ` +
            `Opus at 24 kbps for all of them: ~${megabytes(tally.total * clipBytes(meanKana))}.`,
        '',
    ].join('\n');
}

function main(): void {
    const csv = process.argv[2];
    if (!csv) throw new Error('usage: bun scripts/measure-audio.ts path/to/sentences_with_audio.csv');
    const recordings = readRecordings(csv);

    const all = newTally();
    const shown = new Map(TOP_N.map(n => [n, newTally()]));
    const seen = new Set<string>();
    const seenShown = new Map(TOP_N.map(n => [n, new Set<string>()]));
    const idByText = new Map<string, string>();

    for (const file of fs.readdirSync(SENTENCES_DIR)) {
        const vocabId = path.basename(file, '.json');
        const sentences = readJson<Sentence[]>(path.join(SENTENCES_DIR, file));
        for (const s of sentences) {
            idByText.set(s.original, s.id);
            if (seen.has(s.id)) continue;
            seen.add(s.id);
            count(all, s.id, s.original, kanaLength(s), recordings);
        }
        const ranked = rankForNewLearner(vocabId, sentences);
        for (const n of TOP_N) {
            const seenN = seenShown.get(n);
            const tallyN = shown.get(n);
            if (!seenN || !tallyN) continue;
            for (const s of ranked.slice(0, n)) {
                if (seenN.has(s.id)) continue;
                seenN.add(s.id);
                count(tallyN, s.id, s.original, kanaLength(s), recordings);
            }
        }
    }

    const grammar = newTally();
    const grammarSeen = new Set<string>();
    for (const dir of GRAMMAR_DIRS) {
        for (const file of fs.readdirSync(dir)) {
            const parsed = readJson<GrammarExampleFile | { jp: string }[]>(path.join(dir, file));
            const examples = Array.isArray(parsed) ? parsed : (parsed.examples ?? []);
            for (const { jp } of examples) {
                if (grammarSeen.has(jp)) continue;
                grammarSeen.add(jp);
                count(grammar, idByText.get(jp) ?? null, jp, jp.length, recordings);
            }
        }
    }
    const grammarFromTatoeba = [...grammarSeen].filter(jp => idByText.has(jp)).length;

    let words = 0;
    let wordKana = 0;
    for (const file of fs.readdirSync(VOCAB_DIR)) {
        const vocab = readJson<Vocabulary>(path.join(VOCAB_DIR, file));
        words++;
        wordKana += vocab.reading.primary.length;
    }

    console.log(
        [
            `### Audio measurement (Tatoeba export of ${fs.statSync(csv).mtime.toISOString().slice(0, 10)})`,
            '',
            report('Every compiled sentence', all),
            ...TOP_N.map(n => report(`Shown by quizzes: the top ${n} per word (new learner)`, shown.get(n) ?? newTally())),
            report(`Grammar examples (${grammarFromTatoeba} of ${grammarSeen.size} are Tatoeba sentences of ours)`, grammar),
            '#### Word readings (TTS only)',
            '',
            `${words} words, ${wordKana} kana (${(wordKana / words).toFixed(1)} on average). ` +
                `Opus at 24 kbps: ~${megabytes(words * clipBytes(wordKana / words))}.`,
        ].join('\n')
    );
}

main();
