import { kataToHira, readingFitsReading, type ReadingVocab, type SpanAnnotation } from './readingDisambiguation';

/**
 * The furigana of a word as it occurs in a sentence, so every card shows a reading
 * that is either the one the learner learned or one the sentence justifies.
 *
 * The tokenizer reads each span out of context with its own dictionary: 日本 as
 * にっぽん, 一人 as いちにん, 他 as た, 間 as ま in 眠っている間に, and a compound it
 * built from several tokens as their readings glued together (一週間 いちしゅうかん,
 * １０時 いちぜろじ). Measured over the vocab sentences, the furigana of the matched
 * word differed from its learned reading 3.6% of the time. So, in order:
 *
 *  1. Tatoeba's own annotation of the sentence (`indices`, written by hand): a
 *     reading it gives for the word is justified by the sentence (日米間 is かん,
 *     一羽 is わ, スミス家 is け). Where it disagreed with the tokenizer, Tatoeba was
 *     right in the samples checked (他 ほか, 家 いえ, 間 あいだ).
 *  2. Otherwise the tokenizer's reading, when it agrees with the learned reading,
 *     conjugation included (来た is きた).
 *  3. Otherwise the learned reading, with the sentence's own okurigana: 日本 にほん,
 *     一週間 いっしゅうかん, 開いて ひらいて.
 */

const KANA = /[぀-ヿー]/;

/** The kana after a written form's last non-kana character: 食べる -> べる, 一週間 -> "". */
function kanaTail(written: string): string {
    let i = written.length;
    while (i > 0 && KANA.test(written[i - 1])) i--;
    return written.slice(i);
}

/**
 * `dictReading` of `dictWritten`, re-inflected onto `surface`: the reading of the part
 * before the okurigana, plus the surface's own okurigana. Undefined when the reading
 * does not end in the written form's okurigana, so no split can be trusted.
 */
export function inflectReading(dictWritten: string, dictReading: string, surface: string): string | undefined {
    const tail = kataToHira(kanaTail(dictWritten));
    const reading = kataToHira(dictReading);
    if (!reading.endsWith(tail) || reading.length === tail.length) return undefined;
    return reading.slice(0, reading.length - tail.length) + kataToHira(kanaTail(surface));
}

/** One word of a Tatoeba `indices` line: 私(わたし), 眠る{眠ら}, 物[01]{物}~, 妻(#1294330). */
export interface IndexedWord {
    headword: string;
    reading?: string;
    /** The exact JMdict entry, which Tatoeba writes in the reading's place: (#1294330). */
    entryId?: string;
    surface?: string;
}

const INDEXED_WORD = /^([^([{~]+)(?:\(([^)]+)\))?(?:\[\d+\])?(?:\{([^}]+)\})?~?$/;

export function parseIndices(indices: string | undefined): IndexedWord[] {
    if (!indices) return [];
    return indices.split(' ').flatMap(part => {
        const m = INDEXED_WORD.exec(part);
        if (!m) return [];
        const paren = m[2];
        return [{
            headword: m[1],
            ...(paren && !paren.startsWith('#') ? { reading: paren } : {}),
            ...(paren?.startsWith('#') ? { entryId: paren.slice(1) } : {}),
            ...(m[3] ? { surface: m[3] } : {}),
        }];
    });
}

/**
 * The reading Tatoeba gives this word where it occurs as `surface`: an annotated word
 * spelled like the vocab (any of its written forms) whose surface is the span. Only
 * when every such annotation agrees, and only a reading Tatoeba states: an unannotated
 * word says nothing about which reading is meant.
 */
export function curatedReading(words: IndexedWord[], writtenForms: string[], surface: string): { written: string; reading: string } | undefined {
    const hits = words.filter(w => w.reading && writtenForms.includes(w.headword) && (w.surface ?? w.headword) === surface);
    const readings = new Set(hits.map(w => kataToHira(w.reading ?? '')));
    return readings.size === 1 && hits[0].reading ? { written: hits[0].headword, reading: hits[0].reading } : undefined;
}

/**
 * Whether Tatoeba's annotation of a sentence rules out that `surface` is a word with
 * these readings: it reads a word inside the span in a way none of them contains.
 * 誰(だれ) inside 誰が rules out たが; 坊ちゃん(ぼっちゃん) inside お坊ちゃん does not rule
 * out おぼっちゃん. Only stated readings count, compared without their okurigana and
 * through the sound changes compounding makes: voicing (rendaku: 分 ふん in ８分 はっぷん,
 * 漬け つけ in 砂糖漬け づけ) and a final ち/つ/く/き doubling (一 いち in 一週 いっしゅう).
 */
export function annotationContradicts(words: IndexedWord[], surface: string, readings: string[]): boolean {
    const own = readings.map(r => soundless(kataToHira(r)));
    return words.some(w => {
        const written = w.surface ?? w.headword;
        if (!w.reading || !written || written === surface || !surface.includes(written)) return false;
        const tail = kataToHira(kanaTail(w.headword));
        const reading = kataToHira(w.reading);
        const stem = soundless(tail && reading.endsWith(tail) && reading.length > tail.length ? reading.slice(0, reading.length - tail.length) : reading);
        const doubled = /[ちつくき]$/.test(stem) && stem.length > 1 ? stem.slice(0, -1) : null;
        return !own.some(r => r.includes(stem) || (doubled !== null && r.includes(doubled)));
    });
}

const UNVOICED: Record<string, string> = Object.fromEntries(
    [...'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ'].map((c, i) => [c, 'かきくけこさしすせそたちつてとはひふへほはひふへほ'[i]]),
);

/** A reading with voicing marks and small っ removed, so compound sound changes compare equal. */
function soundless(reading: string): string {
    return [...reading].map(c => UNVOICED[c] ?? c).join('').replace(/っ/g, '');
}

/** What a sentence's annotation says about the span `surface` (see resolveSentenceMatch). */
export function annotationFor(words: IndexedWord[], surface: string): SpanAnnotation | undefined {
    if (words.length === 0) return undefined;
    const here = words.filter(w => (w.surface ?? w.headword) === surface);
    const pinned = new Set(here.map(w => w.entryId).filter((id): id is string => Boolean(id)));
    return {
        ...(pinned.size === 1 ? { entryId: [...pinned][0] } : {}),
        lists: (vocab: ReadingVocab) => here.some(w => w.headword === vocab.writtenForm.kanji || vocab.writtenForm.alternatives.includes(w.headword)),
        contradicts: (vocab: ReadingVocab) => annotationContradicts(words, surface, [vocab.reading.primary, ...vocab.reading.alternatives]),
    };
}

export interface OccurrenceInput {
    /** The written form the span matched (headword or alternative spelling, dictionary form). */
    term: string;
    /** The span's text as the sentence writes it. */
    surface: string;
    /** The tokenizer's reading of the span, if any. */
    tokenizerReading?: string;
    /** The word's learned reading. */
    primary: string;
    inflecting: boolean;
    curated?: { written: string; reading: string };
}

export type ReadingSource = 'tatoeba' | 'tokenizer' | 'learned';

export function occurrenceReading(input: OccurrenceInput): { reading?: string; source: ReadingSource } {
    const { term, surface, tokenizerReading, primary, inflecting, curated } = input;
    const tokenizer = tokenizerReading ? kataToHira(tokenizerReading) : undefined;
    if (curated) {
        if (tokenizer && readingFitsReading(tokenizer, curated.reading, inflecting)) return { reading: tokenizer, source: 'tatoeba' };
        const rebuilt = inflectReading(curated.written, curated.reading, surface);
        if (rebuilt) return { reading: rebuilt, source: 'tatoeba' };
    }
    if (tokenizer && readingFitsReading(tokenizer, primary, inflecting)) return { reading: tokenizer, source: 'tokenizer' };
    const rebuilt = inflectReading(term, primary, surface);
    return rebuilt ? { reading: rebuilt, source: 'learned' } : { reading: tokenizer, source: 'tokenizer' };
}
