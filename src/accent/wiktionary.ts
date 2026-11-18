/**
 * Wiktionary's Japanese pitch accents, read from the wikitext of an entry: every `{{ja-pron}}`
 * in its Japanese section gives a reading (its first positional parameter) and its Tokyo
 * accents (`acc=`, `acc2=` ... `acc5=`), kept here as written. Turning them into downsteps is
 * `wiktionaryDownsteps` (src/accent/pitchAccent.ts), so the snapshot stays the source's own words.
 */

import type { AccentRow } from './snapshot';

const ACCENT_KEYS = ['acc', 'acc2', 'acc3', 'acc4', 'acc5'];

/** The Japanese section of a page's wikitext, or '' when it has none. */
export function japaneseSection(wikitext: string): string {
    const start = wikitext.indexOf('==Japanese==');
    if (start < 0) return '';
    const rest = wikitext.slice(start + '==Japanese=='.length);
    const next = rest.search(/\n==[^=]/);
    return next < 0 ? wikitext.slice(start) : wikitext.slice(start, start + '==Japanese=='.length + next);
}

/** The bodies of every `{{name|...}}` in a text, nested templates included in their body. */
export function templateBodies(text: string, name: string): string[] {
    const out: string[] = [];
    const open = `{{${name}|`;
    let i = text.indexOf(open);
    while (i >= 0) {
        let depth = 0;
        let j = i;
        for (; j < text.length - 1; j++) {
            if (text[j] === '{' && text[j + 1] === '{') { depth++; j++; }
            else if (text[j] === '}' && text[j + 1] === '}') { depth--; j++; if (depth === 0) break; }
        }
        out.push(text.slice(i + 2, j - 1));
        i = text.indexOf(open, j);
    }
    return out;
}

/** One `{{ja-pron}}` body as a row, or null when it gives no reading or no accent. */
export function parseJaPron(title: string, body: string): AccentRow | null {
    const positional: string[] = [];
    const named = new Map<string, string>();
    for (const part of body.split('|').slice(1)) {
        const eq = part.indexOf('=');
        if (eq > 0) named.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
        else positional.push(part.trim());
    }
    const accents = ACCENT_KEYS.map(k => named.get(k)).filter((v): v is string => v !== undefined && v !== '');
    const reading = (positional[0] ?? '').replace(/[\s.^\-'%]/g, '');
    if (reading === '' || accents.length === 0) return null;
    return { form: title, reading, accents };
}

/** Every accented `{{ja-pron}}` of a page's Japanese section. */
export function accentRowsOf(title: string, wikitext: string): AccentRow[] {
    return templateBodies(japaneseSection(wikitext), 'ja-pron')
        .map(body => parseJaPron(title, body))
        .filter((row): row is AccentRow => row !== null);
}
