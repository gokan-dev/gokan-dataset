// Chinese Wiktionary's Japanese entries (kaikki.org extraction), as records the matcher attaches
// to words: what one page says about one spelling, read as the page reads it, and its senses.
// Two of the source's conventions are followed, not worked around (docs/MULTILINGUAL.md,
// "Matching"): a native word's meanings sit on its kana page, which lists its kanji spellings
// (のむ for 飲む, 呑む, 喫む; the kanji pages only redirect), and a sense may name the spellings it
// applies to (`飲む，呑む： 喝，饮`).
import { hiraganaReading, isAllKana, kaikkiRef, rubyReading, spellingReading, type KaikkiEntry, type KaikkiSense } from './kaikki';

/** Entries that define nothing: a character, a romanisation, a redirect. */
const NOT_DEFINITIONS = new Set(['character', 'romanization', 'soft-redirect']);

/**
 * A bot entry (decision D5, excluded): created in 2010 by Wjcdbot ("自动创建条目") with no
 * source named. The benchmark's test, kept as it was: no part of speech, and the first gloss
 * opens with the headword and its reading in 【】 (`汚泥処理【おでいしょり】污泥处理`).
 */
export function isBotEntry(entry: KaikkiEntry): boolean {
    const firstGloss = entry.senses[0]?.glosses[0] ?? '';
    return entry.pos === 'unknown' && firstGloss.startsWith(`${entry.word}【`);
}

export interface ZhWiktionarySense {
    glosses: string[];
    tags: string[];
    /** The spellings the sense names, when it names some. */
    spellings?: string[];
}

/** What one page says about one spelling: the page's own word, or a kanji spelling its kana page lists. */
export interface ZhWiktionaryRecord {
    ref: string;
    pos: string;
    spelling: string;
    /** In hiragana; undefined when the page gives none (the record then matches nothing). */
    reading?: string;
    senses: ZhWiktionarySense[];
}

const SPELLING = /^(?=.*\p{Script=Han})[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ヶ]{1,10}$/u;

/** A gloss's spelling prefix (`飲む，呑む： 喝，饮`): the spellings it names, and the text after it. */
export function spellingPrefix(text: string): { spellings: string[]; rest: string } | undefined {
    const m = /^([^：]{1,40})：\s*/.exec(text);
    if (!m?.[1]) return undefined;
    const spellings = m[1].split(/[，,、]/).map(x => x.trim());
    if (!spellings.every(p => SPELLING.test(p))) return undefined;
    return { spellings, rest: text.slice(m[0].length).trim() };
}

const normalised = (gloss: string): string => gloss.replace(/\s+/g, ' ').trim();

/**
 * A sense as the reader keeps it, or undefined when it defines nothing (a form-of pointer, no
 * gloss). A prefix may stand alone as the first gloss of a nested sense (`騒ぐ：`, then its meaning).
 */
export function readSense(sense: KaikkiSense): ZhWiktionarySense | undefined {
    if (sense.pointer) return undefined;
    let glosses = sense.glosses.map(normalised).filter(Boolean);
    let spellings: string[] | undefined;
    const prefix = glosses[0] !== undefined ? spellingPrefix(glosses[0]) : undefined;
    if (prefix) {
        spellings = prefix.spellings;
        glosses = prefix.rest ? [prefix.rest, ...glosses.slice(1)] : glosses.slice(1);
    }
    if (glosses.length === 0) return undefined;
    return { glosses, tags: [...sense.tags, ...sense.rawTags], ...(spellings ? { spellings } : {}) };
}

/** The page's reading: its canonical form's ruby, else the page title when it is kana. */
function pageReading(entry: KaikkiEntry): string | undefined {
    const canonical = entry.forms.find(f => f.tags.includes('canonical'));
    const reading = canonical && canonical.ruby.length > 0 ? rubyReading(canonical.form, canonical.ruby) : undefined;
    if (reading) return spellingReading(entry.word, hiraganaReading(reading));
    return isAllKana(entry.word) ? hiraganaReading(entry.word) : undefined;
}

/**
 * One entry's records: the page's own, and on a kana page one per kanji spelling it lists, each
 * with the senses that apply to that spelling (those naming it, and those naming none). A bot
 * entry gives none; the caller counts those (decision D5).
 */
export function zhWiktionaryRecords(entry: KaikkiEntry): ZhWiktionaryRecord[] {
    if (NOT_DEFINITIONS.has(entry.pos) || isBotEntry(entry)) return [];
    const senses = entry.senses.map(readSense).filter((s): s is ZhWiktionarySense => s !== undefined);
    if (senses.length === 0) return [];
    const ref = kaikkiRef(entry);
    const reading = pageReading(entry);
    const records: ZhWiktionaryRecord[] = [{ ref, pos: entry.pos, spelling: entry.word, ...(reading ? { reading } : {}), senses }];
    if (!isAllKana(entry.word)) return records;
    const kanji = new Set(entry.forms.filter(f => f.tags.includes('kanji') && !isAllKana(f.form)).map(f => f.form));
    for (const s of senses) for (const p of s.spellings ?? []) if (!isAllKana(p)) kanji.add(p);
    for (const spelling of kanji) {
        const own = senses.filter(s => !s.spellings || s.spellings.includes(spelling));
        if (own.length > 0) records.push({ ref, pos: entry.pos, spelling, reading: hiraganaReading(entry.word), senses: own });
    }
    return records;
}
