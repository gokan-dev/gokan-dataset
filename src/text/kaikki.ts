// kaikki.org's extraction of a Wiktionary (wiktextract JSONL), narrowed at the boundary: both
// Wiktionary readers (zhwiktionary.ts, jawiktionary.ts) take these typed entries, never raw JSON.
// Only the fields the readers use are kept.

export interface KaikkiForm {
    form: string;
    tags: string[];
    /** Each kanji run of the form and its reading (`[["手", "て"], ["紙", "がみ"]]`). */
    ruby: [string, string][];
}

export interface KaikkiSense {
    glosses: string[];
    tags: string[];
    rawTags: string[];
    /** A form-of or alt-of sense points to another entry instead of defining this one. */
    pointer: boolean;
}

export interface KaikkiTranslation {
    langCode: string;
    lang: string;
    word: string;
}

export interface KaikkiEntry {
    /** The page title. */
    word: string;
    /** The section's language as the Wiktionary names it (日語, 日语, 日本語, 中国語): the page's anchor. */
    lang: string;
    pos: string;
    forms: KaikkiForm[];
    senses: KaikkiSense[];
    translations: KaikkiTranslation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);

function rubyPairs(value: unknown): [string, string][] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((pair): [string, string][] => {
        const [base, reading]: unknown[] = Array.isArray(pair) ? pair : [];
        return typeof base === 'string' && typeof reading === 'string' ? [[base, reading]] : [];
    });
}

/** One JSONL line's entry, or undefined when it is not one. */
export function parseKaikkiEntry(value: unknown): KaikkiEntry | undefined {
    if (!isRecord(value) || typeof value.word !== 'string' || typeof value.pos !== 'string') return undefined;
    return {
        word: value.word,
        lang: typeof value.lang === 'string' ? value.lang : '',
        pos: value.pos,
        forms: records(value.forms).flatMap(f => (typeof f.form === 'string' ? [{ form: f.form, tags: strings(f.tags), ruby: rubyPairs(f.ruby) }] : [])),
        senses: records(value.senses).map(s => ({
            glosses: strings(s.glosses),
            tags: strings(s.tags),
            rawTags: strings(s.raw_tags),
            pointer: s.form_of !== undefined || s.alt_of !== undefined,
        })),
        translations: records(value.translations).flatMap(t => (typeof t.word === 'string'
            ? [{ langCode: typeof t.lang_code === 'string' ? t.lang_code : '', lang: typeof t.lang === 'string' ? t.lang : '', word: t.word }]
            : [])),
    };
}

/** An entry's reference in its source: the page and its language section, as the page's anchor writes it. */
export function kaikkiRef(entry: KaikkiEntry): string {
    return `${entry.word}#${entry.lang}`;
}

const KATAKANA = /[ァ-ヶ]/g;

/** A reading as the matcher compares it: hiragana, without the separators sources write (`・`, spaces, `-`). */
export function hiraganaReading(reading: string): string {
    return reading.replace(KATAKANA, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/[・\s-]/g, '');
}

/**
 * The reading of the spelling itself: both Wiktionaries read a verbal noun's page as its verb
 * (検索 as けんさくする), which is the noun's reading and する.
 */
export function spellingReading(spelling: string, reading: string): string {
    return reading.endsWith('する') && !spelling.endsWith('する') && reading.length > 2 ? reading.slice(0, -2) : reading;
}

const isKana = (ch: string): boolean => /[ぁ-ゟ゠-ヿ]/.test(ch);

export function isAllKana(text: string): boolean {
    return text.length > 0 && [...text].every(isKana);
}

/** The reading a form's ruby spells out (each kanji run replaced by its reading); undefined when a kanji has none. */
export function rubyReading(form: string, ruby: [string, string][]): string | undefined {
    let out = '';
    let i = 0;
    let r = 0;
    while (i < form.length) {
        const pair = ruby[r];
        if (pair && form.startsWith(pair[0], i)) { out += pair[1]; i += pair[0].length; r++; continue; }
        const ch = form[i] ?? '';
        if (!isKana(ch)) return undefined;
        out += ch;
        i++;
    }
    return r === ruby.length ? out : undefined;
}
