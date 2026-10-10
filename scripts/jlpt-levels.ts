import fs from 'fs';
import path from 'path';
import type { TextbookLesson } from '../src/models/vocabulary.model';

/**
 * JLPT levels for JMdict entries, from Jonathan Waller's lists (tanos.co.uk, the
 * same data jisho.org shows), read from two copies that fail in different places:
 *
 *  - The id list (data/raw/jlpt/waller-ids, stephenmk/yomitan-jlpt-vocab) gives every
 *    entry a hand-assigned JMdict id, so a level lands on exactly one word, with no
 *    spelling or reading guesswork. It is the authority wherever it has an entry.
 *  - The decks (data/raw/jlpt/waller-decks, jamsinclair/open-anki-jlpt-decks) are
 *    Waller's Anki decks. They still carry entries the web list lost (顔, 母, 父,
 *    頑張る, ない), but their N3 is a looser revision: on a sample of 29 words where
 *    the two disagree, jisho sided with the id list 27 times. So a deck row only
 *    fills an entry the id list does not have. The one exception is an N5/N4 deck
 *    row written in kana, which may make a listed word easier: Waller files a word
 *    usually written in kana under its rare kanji at N1 (丈) and under kana at N5
 *    (～だけ), and the id list sometimes kept only the first.
 *
 * Deck rows have no ids. A row written with kanji matches only an entry with that
 * exact spelling AND reading (JMdict's appliesToKanji respected); where both copies
 * list the same entry this agrees with the id list's hand-assigned id 6037 times out
 * of 6038. A row written in kana (ない, ～たち) falls back to the one entry usually
 * written in kana that carries the reading; a reading shared by several is skipped.
 *
 * Corrections (data/raw/vocab/jlpt-corrections.json) hold the residue, by id:
 *  - `remap`: the id list sends a few kana-written N5/N4 entries to an interjection
 *    (これ to "hey; oi", あの to "say; well") while the word Waller means, the
 *    pronoun 此れ, sits at N1 under its rare kanji spelling. See ukRivalsOf.
 *  - `levels`: a level the lists never give. の is the only one: particles are not
 *    on Waller's lists, but の is 9% of what anime says and is met in lesson one.
 *  - `keep`: rows ukRivalsOf flags where the id list is right after review.
 *  - `derivedExclude`: idioms the derivation rules would level (jlpt-derived.ts).
 *
 * Levels run 5 (N5, easiest) .. 1 (N1); a word listed twice keeps the easiest.
 */

export interface WallerIdRow {
    id: string;
    kana: string;
    /** Waller's spelling; empty when he writes the word in kana. */
    kanji: string;
    level: number;
}

export interface WallerDeckRow {
    expression: string;
    reading: string;
    tags: string[];
    level: number;
}

export interface JlptCorrections {
    remap: Record<string, { to: string; key: string; why: string }>;
    levels: Record<string, { level: number; word: string; why: string }>;
    keep: Record<string, { key: string; why: string }>;
    /** Vocab ids that must not take a level from the word they look formed from (see jlpt-derived.ts). */
    derivedExclude: Record<string, { word: string; why: string }>;
}

/** The JMdict fields resolution reads (jmdict-simplified's Word). */
export interface JmdictWordLike {
    id: string;
    kanji: Array<{ text: string; tags: string[] }>;
    kana: Array<{ text: string; common: boolean; tags: string[]; appliesToKanji: string[] }>;
    sense: Array<{ misc: string[] }>;
}

export type JlptSource = 'list' | 'deck' | 'deck-kana' | 'override';

export interface JlptAssignment {
    level: number;
    source: JlptSource;
}

export interface JlptResolution {
    /** JMdict id -> level, before any homograph merge. */
    levels: Map<string, JlptAssignment>;
    /** JMdict id -> the textbook lessons that teach it (deck tags). */
    textbooks: Map<string, TextbookLesson[]>;
    /** Id-list rows the list leaves without an id: single-kanji readings (依/い), not words. */
    unidentifiedListRows: WallerIdRow[];
    /** Deck rows written with kanji that match no entry, or several. */
    unmatchedDeckRows: WallerDeckRow[];
    ambiguousDeckRows: WallerDeckRow[];
}

const LEVELS = [5, 4, 3, 2, 1] as const;
const KANA = /^[぀-ヿー]+$/;
const TEXTBOOK_TAG = /^(Genki|Intermediate_Japanese)_Ln\.(\d+)$/;
const BOOKS: Record<string, TextbookLesson['book']> = { Genki: 'genki', Intermediate_Japanese: 'intermediate-japanese' };

/** Rows of a CSV with a header line, honouring double-quoted fields. */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    for (const line of text.replace(/\r/g, '').split('\n').slice(1)) {
        if (!line.trim()) continue;
        const fields: string[] = [];
        let field = '';
        let quoted = false;
        for (const ch of line) {
            if (ch === '"') quoted = !quoted;
            else if (ch === ',' && !quoted) {
                fields.push(field);
                field = '';
            } else field += ch;
        }
        fields.push(field);
        rows.push(fields);
    }
    return rows;
}

/** data/raw/jlpt/waller-ids/n{1..5}.csv: jmdict_seq, kana, kanji, waller_definition. */
export function readWallerIdList(dir: string): WallerIdRow[] {
    return LEVELS.flatMap(level =>
        parseCsv(fs.readFileSync(path.join(dir, `n${level}.csv`), 'utf-8'))
            .map(([id, kana, kanji]) => ({ id, kana, kanji: kanji ?? '', level })));
}

/** data/raw/jlpt/waller-decks/n{1..5}.csv: expression, reading, meaning, tags, guid. */
export function readWallerDecks(dir: string): WallerDeckRow[] {
    return LEVELS.flatMap(level =>
        parseCsv(fs.readFileSync(path.join(dir, `n${level}.csv`), 'utf-8'))
            .map(([expression, reading, , tags]) => ({ expression, reading, tags: (tags ?? '').split(' ').filter(Boolean), level })));
}

/** A deck cell's spellings: "在る; 有る" is two, "～たち" is たち. */
function variants(cell: string): string[] {
    return cell.split(/[;；]\s*/).map(s => s.replace(/[～〜~]/g, '').trim()).filter(Boolean);
}

function textbookLessons(tags: string[]): TextbookLesson[] {
    return tags.flatMap(tag => {
        const m = TEXTBOOK_TAG.exec(tag);
        return m ? [{ book: BOOKS[m[1]], lesson: Number(m[2]) }] : [];
    });
}

const firstSenseUk = (w: JmdictWordLike) => w.sense[0]?.misc.includes('uk') ?? false;

/**
 * Entries the id list sends a kana-written row to although a likelier word exists:
 * the row's entry has no kanji spelling at all (an interjection, a kana-only
 * homophone), while an entry that is usually written in kana and HAS a kanji
 * spelling carries the same reading and is listed at a harder level, or not at all.
 * That is how N5 これ landed on "hey; oi" and left the pronoun 此れ at N1. Rows
 * already settled in jlpt-corrections.json (a remap or a keep) are not reported.
 */
export function ukRivalsOf(
    rows: WallerIdRow[],
    words: Map<string, JmdictWordLike>,
    levels: Map<string, JlptAssignment>,
    corrections: Pick<JlptCorrections, 'remap' | 'keep'>,
): Array<{ row: WallerIdRow; rivals: string[] }> {
    const byKana = new Map<string, string[]>();
    for (const w of words.values()) {
        if (!w.kanji.length || !firstSenseUk(w)) continue;
        for (const k of w.kana) {
            if (k.tags.includes('sk')) continue;
            const list = byKana.get(k.text) ?? [];
            list.push(w.id);
            byKana.set(k.text, list);
        }
    }
    const hits: Array<{ row: WallerIdRow; rivals: string[] }> = [];
    for (const row of rows) {
        if (!row.id || row.kanji || words.get(row.id)?.kanji.length) continue;
        if (row.id in corrections.remap || row.id in corrections.keep) continue;
        const rivals = (byKana.get(row.kana) ?? []).filter(id => (levels.get(id)?.level ?? 0) < row.level);
        if (rivals.length) hits.push({ row, rivals });
    }
    return hits;
}

export function resolveJlptLevels(
    words: Map<string, JmdictWordLike>,
    idRows: WallerIdRow[],
    deckRows: WallerDeckRow[],
    corrections: JlptCorrections,
): JlptResolution {
    for (const [from, { to, key }] of Object.entries(corrections.remap)) {
        if (!idRows.some(r => r.id === from && r.kana === key)) {
            throw new Error(`jlpt-corrections: remap ${from} (${key}) is not a row of the id list.`);
        }
        if (!words.get(to)?.kana.some(k => k.text === key)) {
            throw new Error(`jlpt-corrections: remap target ${to} is not a JMdict entry read "${key}".`);
        }
    }
    for (const id of Object.keys(corrections.levels)) {
        if (!words.has(id)) throw new Error(`jlpt-corrections: level override ${id} is not a JMdict entry.`);
    }

    const levels = new Map<string, JlptAssignment>();
    const assign = (id: string, level: number, source: JlptSource) => {
        const current = levels.get(id);
        if (!current || level > current.level) levels.set(id, { level, source });
    };
    const textbooks = new Map<string, TextbookLesson[]>();
    const teach = (id: string, lessons: TextbookLesson[]) => {
        if (!lessons.length) return;
        const list = textbooks.get(id) ?? [];
        for (const l of lessons) if (!list.some(x => x.book === l.book && x.lesson === l.lesson)) list.push(l);
        textbooks.set(id, list);
    };

    // 1. The id list.
    const listed = new Set<string>();
    const listedAt = new Map<string, string[]>(); // `${level}|${kana}` -> ids
    const unidentifiedListRows: WallerIdRow[] = [];
    for (const row of idRows) {
        if (!row.id) { unidentifiedListRows.push(row); continue; }
        if (!words.has(row.id)) {
            throw new Error(`JLPT id list: ${row.id} (${row.kanji || row.kana}, N${row.level}) is not in this JMdict. Update the list or remap it.`);
        }
        const id = corrections.remap[row.id]?.to ?? row.id;
        assign(id, row.level, 'list');
        listed.add(row.id);
        listed.add(id);
        const key = `${row.level}|${row.kana}`;
        listedAt.set(key, [...(listedAt.get(key) ?? []), id]);
    }

    // 2. Deck rows: fill entries the id list lacks, and collect textbook lessons.
    const byPair = new Map<string, string[]>();
    const kanaUsuallyWritten = new Map<string, string[]>();
    for (const w of words.values()) {
        for (const kana of w.kana) {
            for (const kanji of w.kanji) {
                if (!kana.appliesToKanji.includes('*') && !kana.appliesToKanji.includes(kanji.text)) continue;
                const key = `${kanji.text}|${kana.text}`;
                const list = byPair.get(key) ?? [];
                if (!list.includes(w.id)) list.push(w.id);
                byPair.set(key, list);
            }
            if (w.kanji.length && firstSenseUk(w) && kana.common && !kana.tags.includes('sk')) {
                const list = kanaUsuallyWritten.get(kana.text) ?? [];
                if (!list.includes(w.id)) list.push(w.id);
                kanaUsuallyWritten.set(kana.text, list);
            }
        }
    }

    const unmatchedDeckRows: WallerDeckRow[] = [];
    const ambiguousDeckRows: WallerDeckRow[] = [];
    for (const row of deckRows) {
        const spellings = variants(row.expression);
        const readings = variants(row.reading);
        const lessons = textbookLessons(row.tags);

        if (spellings.every(s => KANA.test(s))) {
            for (const reading of readings) {
                const listedIds = listedAt.get(`${row.level}|${reading}`);
                if (listedIds) {
                    if (listedIds.length === 1) teach(listedIds[0], lessons);
                    continue;
                }
                const owners = kanaUsuallyWritten.get(reading);
                if (owners?.length !== 1) continue;
                // A listed word moves only to an easier N5/N4 kana row: Waller lists
                // だけ at N5 as ～だけ but its kanji 丈 at N1, like これ and 此れ. The
                // decks' N3 is the loose revision, so an N3 row never moves a level.
                if (!listed.has(owners[0]) || row.level >= 4) assign(owners[0], row.level, 'deck-kana');
                teach(owners[0], lessons);
            }
            continue;
        }

        const ids = new Set<string>();
        for (const s of spellings) for (const r of readings) for (const id of byPair.get(`${s}|${r}`) ?? []) ids.add(id);
        if (ids.size === 0) { unmatchedDeckRows.push(row); continue; }
        if (ids.size > 1) { ambiguousDeckRows.push(row); continue; }
        const [id] = ids;
        if (!listed.has(id)) assign(id, row.level, 'deck');
        teach(id, lessons);
    }

    // 3. Hand-set levels.
    for (const [id, { level }] of Object.entries(corrections.levels)) levels.set(id, { level, source: 'override' });

    // A row the id list may have sent to the wrong entry must be reviewed, not guessed.
    const unsettled = ukRivalsOf(idRows, words, levels, corrections);
    if (unsettled.length) {
        throw new Error(`JLPT id list: ${unsettled.length} kana row(s) need a remap or keep in jlpt-corrections.json: `
            + unsettled.map(h => `N${h.row.level} ${h.row.kana} (${h.row.id}; rivals ${h.rivals.join(', ')})`).join('; '));
    }
    for (const [id, { key }] of Object.entries(corrections.keep)) {
        if (!idRows.some(r => r.id === id && r.kana === key)) throw new Error(`jlpt-corrections: keep ${id} (${key}) is not a row of the id list.`);
    }

    for (const list of textbooks.values()) list.sort((a, b) => a.book.localeCompare(b.book) || a.lesson - b.lesson);
    return { levels, textbooks, unidentifiedListRows, unmatchedDeckRows, ambiguousDeckRows };
}
