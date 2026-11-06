// Tatoeba's Mandarin translations of Japanese sentences, first hand only (docs/MULTILINGUAL.md,
// "What counts as first hand"): a Japanese-Mandarin link is kept only when sentences_base records
// that one sentence was translated from the other, never when the Mandarin was translated from
// a third sentence (most often an English one).

/** A Tatoeba export's rows: tab-separated, one per line. */
export function tsvRows(text: string): string[][] {
    return text.split('\n').filter(line => line.trim()).map(line => line.replace(/\r$/, '').split('\t'));
}

/**
 * One line of sentences_base.csv: a sentence's id and what it was translated from (a sentence id,
 * `0` when written as an original, `\N` when unknown).
 */
export function sentenceBase(line: string): [string, string] | undefined {
    const tab = line.indexOf('\t');
    return tab < 0 ? undefined : [line.slice(0, tab), line.slice(tab + 1).replace(/\r$/, '').trim()];
}

/** How a link came about, the benchmark's categories: only the first two are first hand. */
export type LinkKind = 'zhFromJa' | 'jaFromZh' | 'zhFromOtherJa' | 'zhFromOtherLang' | 'zhOriginalJaFromOther' | 'bothOriginal' | 'unknown';

const UNKNOWN = '\\N';

export function linkKind(ja: string, zh: string, base: ReadonlyMap<string, string>, japanese: ReadonlySet<string>): LinkKind {
    const zhBase = base.get(zh) ?? UNKNOWN;
    const jaBase = base.get(ja) ?? UNKNOWN;
    if (zhBase === ja) return 'zhFromJa';
    if (jaBase === zh) return 'jaFromZh';
    if (zhBase === UNKNOWN) return 'unknown';
    if (zhBase !== '0') return japanese.has(zhBase) ? 'zhFromOtherJa' : 'zhFromOtherLang';
    if (jaBase === UNKNOWN) return 'unknown';
    return jaBase === '0' ? 'bothOriginal' : 'zhOriginalJaFromOther';
}

/** A translation's direction as the rendering records it, for a first-hand link only. */
export function directionOf(kind: LinkKind): 'fromJapanese' | 'toJapanese' | undefined {
    return kind === 'zhFromJa' ? 'fromJapanese' : kind === 'jaFromZh' ? 'toJapanese' : undefined;
}
