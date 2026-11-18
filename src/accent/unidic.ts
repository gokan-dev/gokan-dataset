/**
 * UniDic's accents (unidic-cwj, NINJAL; used under its New BSD option), from its lexicon
 * `lex_3_1.csv`. Each row is one form of a lemma: a word's own accent is on the row whose form
 * is its dictionary form (orth = orthBase, kana = kanaBase), in `aType`, which lists the
 * accepted downsteps, most usual first ("3,4"). Conjugated forms are left out. A voiced form
 * (部屋 read ベヤ) is its own base and stays, harmlessly: a row is used only for a word read so.
 */
import type { AccentRow } from './snapshot';

/** lex.csv columns: four MeCab columns (surface, left id, right id, cost), then the features. */
const COLUMN = { orth: 12, orthBase: 14, kana: 24, kanaBase: 25, aType: 28 } as const;

/** One lex.csv line's cells. A cell may be quoted, and then holds commas ("3,4"). */
export function lexCells(line: string): string[] {
    const cells: string[] = [];
    let i = 0;
    while (i <= line.length) {
        if (line[i] === '"') {
            const end = line.indexOf('"', i + 1);
            if (end < 0) throw new Error(`unclosed quote in UniDic line: ${line}`);
            cells.push(line.slice(i + 1, end));
            i = end + 2;
        } else {
            const end = line.indexOf(',', i);
            cells.push(end < 0 ? line.slice(i) : line.slice(i, end));
            if (end < 0) break;
            i = end + 1;
        }
    }
    return cells;
}

/** A lex.csv line as an accent row, or null when it is not a dictionary form or has no accent. */
export function unidicRow(line: string): AccentRow | null {
    const c = lexCells(line.replace(/\r$/, ''));
    if (c.length <= COLUMN.aType) return null;
    const orth = c[COLUMN.orth] ?? '';
    const orthBase = c[COLUMN.orthBase] ?? '';
    const kana = c[COLUMN.kana] ?? '';
    const kanaBase = c[COLUMN.kanaBase] ?? '';
    const accents = (c[COLUMN.aType] ?? '').split(',').filter(a => /^\d+$/.test(a));
    if (orth !== orthBase || kana !== kanaBase || orthBase === '' || kanaBase === '*' || accents.length === 0) return null;
    return { form: orthBase, reading: kanaBase, accents };
}
