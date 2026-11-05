// Wikimedia's two sources, one community (decision D6): Wikidata's Japanese lexemes whose sense
// links a concept, with that concept's Chinese labels (equivalents), and the Chinese Wikipedia
// article a Japanese article links to (a check only, never displayed). Both snapshots are written
// by this repository's fetch scripts (scripts/fetch-wikidata-lexemes.ts, fetch-wikipedia-links.ts)
// and narrowed here, at the boundary.
import { hiraganaReading, isAllKana } from './kaikki';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface WikidataLexeme {
    id: string;
    /** By language code: `ja`, and its kana or kanji forms (`ja-hira`, `ja-kana`, `ja-hrkt`, `ja-hani`). */
    lemmas: Record<string, string>;
    /** The linked concepts' Chinese labels, in any Chinese variant: their script is told by their characters. */
    zh: string[];
}

export function parseLexemes(value: unknown): WikidataLexeme[] {
    if (!Array.isArray(value)) throw new Error('Wikidata snapshot: expected a list of lexemes');
    return value.flatMap((item): WikidataLexeme[] => {
        if (!isRecord(item) || typeof item.id !== 'string' || !isRecord(item.lemmas) || !Array.isArray(item.zh)) return [];
        const lemmas: Record<string, string> = {};
        for (const [code, lemma] of Object.entries(item.lemmas)) if (typeof lemma === 'string') lemmas[code] = lemma;
        return [{ id: item.id, lemmas, zh: item.zh.filter((z): z is string => typeof z === 'string') }];
    });
}

export interface WikidataRecord {
    ref: string;
    spelling: string;
    readings: string[];
    equivalents: string[];
}

const KANA_LEMMAS = ['ja-hira', 'ja-kana', 'ja-hrkt'];

/** A lexeme as a record: its Japanese lemma, read by its kana lemmas, as the benchmark read it. */
export function wikidataRecord(lexeme: WikidataLexeme): WikidataRecord | undefined {
    const spelling = lexeme.lemmas.ja;
    const equivalents = [...new Set(lexeme.zh.map(z => z.trim()).filter(Boolean))];
    if (!spelling || equivalents.length === 0) return undefined;
    const readings = KANA_LEMMAS.map(k => lexeme.lemmas[k]).filter((r): r is string => r !== undefined).map(hiraganaReading);
    if (isAllKana(spelling)) readings.push(hiraganaReading(spelling));
    return { ref: lexeme.id, spelling, readings: [...new Set(readings)], equivalents };
}

/**
 * Japanese article title to Chinese article title, for the articles that link one: missing
 * articles and disambiguation pages left out, a trailing qualifier dropped (`證據 (法律)` is 證據).
 */
export function parseSitelinks(value: unknown): Map<string, string> {
    if (!isRecord(value)) throw new Error('Wikipedia snapshot: expected an object of titles');
    const links = new Map<string, string>();
    for (const [title, page] of Object.entries(value)) {
        if (!isRecord(page) || typeof page.zh !== 'string' || page.disambiguation === true || page.missing === true) continue;
        const zh = page.zh.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
        if (zh) links.set(title, zh);
    }
    return links;
}
