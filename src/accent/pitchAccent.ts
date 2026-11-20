/**
 * A word's pitch accents (gokan-srs issue 176): for each of its readings, the downsteps the
 * sources accept, 0 for heiban (no drop) and n for a drop after mora n. Wiktionary is read
 * first, UniDic fills what it lacks; both are committed snapshots (data/raw/accents/), so the
 * build is offline. A word neither source gives an accent has no field.
 */
import type { PitchAccent, PitchAccentSource, Vocabulary } from '../models/vocabulary.model';
import type { AccentRow } from './snapshot';

const SMALL_KANA = new Set([...'ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ']);

/** Katakana as hiragana; the long-vowel mark and everything else unchanged. */
export function toHiragana(text: string): string {
    return text.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** A reading's morae: a small ゃゅょ (and ぁぃぅぇぉゎ) joins the kana before it; っ, ん and ー are morae of their own. */
export function morae(reading: string): string[] {
    const out: string[] = [];
    for (const ch of reading) {
        const last = out.length - 1;
        if (SMALL_KANA.has(ch) && last >= 0) out[last] += ch;
        else out.push(ch);
    }
    return out;
}

/**
 * Wiktionary's accents for a reading as downsteps, in its order: a number as it is, `h` heiban
 * (0), `a` atamadaka (1), `o` odaka (the mora count). A per-part accent (`3+0`, for a compound
 * or a phrase), an unnumbered nakadaka (`n`) and a number beyond the reading's morae are left
 * out, since none says where the word drops; what is left may be empty.
 */
export function wiktionaryDownsteps(accents: string[], reading: string): number[] {
    const count = morae(reading).length;
    const out: number[] = [];
    for (const accent of accents) {
        const value = /^\d+$/.test(accent) ? Number(accent)
            : accent === 'h' ? 0
            : accent === 'a' ? 1
            : accent === 'o' ? count
            : null;
        if (value !== null && value <= count && !out.includes(value)) out.push(value);
    }
    return out;
}

/** UniDic's accents (already numbers) for a reading, those beyond its morae left out. */
export function unidicDownsteps(accents: string[], reading: string): number[] {
    const count = morae(reading).length;
    const out: number[] = [];
    for (const accent of accents) {
        const value = Number(accent);
        if (/^\d+$/.test(accent) && value <= count && !out.includes(value)) out.push(value);
    }
    return out;
}

/** A source's rows by (written form, reading in hiragana): the first row of each pair is kept. */
export type AccentIndex = Map<string, string[]>;

const key = (form: string, reading: string) => `${form}\t${toHiragana(reading)}`;

export function accentIndex(rows: AccentRow[]): AccentIndex {
    const index: AccentIndex = new Map();
    for (const row of rows) {
        const k = key(row.form, row.reading);
        if (!index.has(k)) index.set(k, row.accents);
    }
    return index;
}

export interface AccentSources {
    wiktionary: AccentIndex;
    unidic: AccentIndex;
}

type AccentWord = Pick<Vocabulary, 'writtenForm' | 'reading' | 'usuallyKana'>;

/** A word's readings, primary first, each once. */
function readingsOf(word: AccentWord): string[] {
    return [...new Set([word.reading.primary, ...word.reading.alternatives])];
}

/**
 * The written forms a source may list the word under: its spellings, primary first; and its
 * reading itself for a word without kanji or learned in kana. A kanji word is never looked up
 * by its reading alone: a kana page (はし) can hold another word's accent (箸, 橋, 端).
 */
function formsOf(word: AccentWord, reading: string): string[] {
    const spellings = [word.writtenForm.kanji, ...word.writtenForm.alternatives].filter(f => f !== '');
    return spellings.length === 0 || word.usuallyKana ? [...spellings, reading] : spellings;
}

/** The first downsteps a source gives the reading under any of the word's forms. */
function lookup(index: AccentIndex, forms: string[], reading: string, read: (accents: string[], reading: string) => number[]): number[] {
    for (const form of forms) {
        const accents = index.get(key(form, reading));
        if (!accents) continue;
        const downsteps = read(accents, reading);
        if (downsteps.length > 0) return downsteps;
    }
    return [];
}

/** The word's pitch accents, one per reading a source covers, in the word's reading order. */
export function pitchAccentOf(word: AccentWord, sources: AccentSources): PitchAccent[] {
    const out: PitchAccent[] = [];
    for (const reading of readingsOf(word)) {
        const forms = formsOf(word, reading);
        const found: [PitchAccentSource, number[]][] = [
            ['wiktionary', lookup(sources.wiktionary, forms, reading, wiktionaryDownsteps)],
            ['unidic', lookup(sources.unidic, forms, reading, unidicDownsteps)],
        ];
        const hit = found.find(([, downsteps]) => downsteps.length > 0);
        if (hit) out.push({ reading, downsteps: hit[1], source: hit[0] });
    }
    return out;
}

/**
 * Fails on an accent the app could not draw: a reading the word does not have, no downstep,
 * or a downstep beyond the reading's morae.
 */
export function assertPitchAccent(word: Pick<Vocabulary, 'id' | 'reading'>, accents: PitchAccent[]): void {
    const readings = new Set([word.reading.primary, ...word.reading.alternatives]);
    for (const accent of accents) {
        const count = morae(accent.reading).length;
        if (!readings.has(accent.reading)) throw new Error(`word ${word.id}: pitch accent for ${accent.reading}, a reading it does not have`);
        if (accent.downsteps.length === 0) throw new Error(`word ${word.id}: pitch accent for ${accent.reading} without a downstep`);
        for (const d of accent.downsteps) {
            if (!Number.isInteger(d) || d < 0 || d > count) throw new Error(`word ${word.id}: pitch accent ${d} for ${accent.reading}, which has ${count} morae`);
        }
    }
}
