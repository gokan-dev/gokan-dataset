/**
 * Reading-aware disambiguation of homograph vocab that share a written form.
 *
 * A single written form can belong to several differently-read entries: 遊ぶ is
 * both あそぶ ("to play") and the rare すさぶ ("to grow wild"); 進む is both すすむ
 * and the rare すさむ. The sentence matcher (SentenceTokenizer) keys its matches by
 * the written surface/dictionary form, so an occurrence of 遊んでる (read あそんでる)
 * is found under the term "遊ぶ" and, without this, assigned to BOTH vocab ids -
 * which makes the すさぶ entry claim a sentence about playing, so its production
 * cloze blanks 遊んでる and grades it correct against a "to grow wild" prompt
 * (gokan-srs production-quiz bug). The reading tells the two apart; this module is
 * the one place that comparison lives.
 */

/** The minimal vocab shape needed to tell homographs apart by reading. */
export interface ReadingVocab {
    id: string;
    writtenForm: { kanji: string; alternatives: string[] };
    reading: { primary: string; alternatives: string[] };
    senses: { pos: string[] }[];
    /** Homographs merged into this entry, by JMdict id. */
    mergedVocabs?: { id: string }[];
}

/** Katakana -> hiragana, so a loanword's hiragana sentence reading (こーひー) compares
 * equal to its katakana dictionary reading (コーヒー). */
export function kataToHira(s: string): string {
    return s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function inflects(vocab: Pick<ReadingVocab, 'senses'>): boolean {
    return vocab.senses.some(s =>
        s.pos.some(p => p.startsWith('v') || p === 'adj-i' || p === 'adj-ix' || p === 'adj-na'));
}

/**
 * The invariant prefix(es) any conjugation of `reading` must begin with. For a
 * regular verb / i-adjective the stem is the reading minus its final kana (every
 * form of すすむ starts すす, of いえる starts いえ). する and 来る are irregular -
 * their stem shifts between し/す/せ/さ and こ/き/く - so each contributes several
 * prefixes, which is what keeps 来た (くる) from being dropped in favour of a
 * same-written-form sibling 来る (きたる).
 */
function readingStems(reading: string): string[] {
    if (reading === 'する' || reading.endsWith('する')) {
        const base = reading.slice(0, -2);
        return [base + 'し', base + 'す', base + 'せ', base + 'さ'];
    }
    if (reading === 'くる' || reading.endsWith('くる')) {
        const base = reading.slice(0, -2);
        return [base + 'こ', base + 'き', base + 'く'];
    }
    return reading.length >= 2 ? [reading.slice(0, -1)] : [reading];
}

/**
 * True when a sentence span read `matchReading` (hiragana, possibly inflected and
 * extended with auxiliaries, e.g. あそんでる / いえるでしょう) plausibly belongs to
 * `vocab`. A non-inflecting word must match a reading exactly; an inflecting word
 * fits when the reading begins with the dictionary reading's stem (trailing
 * auxiliaries and particles the stem does not enumerate are irrelevant).
 */
/** readingFitsVocab against one dictionary reading: equal, or for an inflecting word sharing its stem. */
export function readingFitsReading(matchReading: string, reading: string, inflecting: boolean): boolean {
    const r = kataToHira(matchReading);
    const rd = kataToHira(reading);
    if (r === rd) return true;
    return inflecting && readingStems(rd).some(st => st.length >= 1 && r.startsWith(st));
}

export function readingFitsVocab(matchReading: string, vocab: ReadingVocab): boolean {
    const r = kataToHira(matchReading);
    if (!r) return true; // no reading to judge by -> never exclude on this basis
    const readings = [vocab.reading.primary, ...vocab.reading.alternatives].filter(Boolean).map(kataToHira);
    if (readings.includes(r)) return true;
    // Kana-only written forms are themselves "readings" for this comparison.
    const written = [vocab.writtenForm.kanji, ...vocab.writtenForm.alternatives].filter(Boolean).map(kataToHira);
    if (written.includes(r)) return true;
    if (!inflects(vocab)) return false;
    return readings.some(rd => readingStems(rd).some(st => st.length >= 1 && r.startsWith(st)));
}

/**
 * Narrows a term's candidate vocab ids to those whose reading fits the matched
 * span, so a written form shared by homographs (遊ぶ) sends each occurrence only to
 * the entry actually read that way. Falls back to the full list when no candidate
 * fits (an unforeseen reading form, or a true homophone the stem test cannot split)
 * so a match is never dropped outright: this only ever REMOVES a candidate when a
 * better-fitting sibling for the same term exists.
 */
export function disambiguateByReading(
    candidateIds: string[],
    matchReading: string | undefined,
    vocabById: Map<string, ReadingVocab>,
): string[] {
    if (candidateIds.length <= 1 || !matchReading) return candidateIds;
    const fitting = candidateIds.filter(id => {
        const v = vocabById.get(id);
        return v ? readingFitsVocab(matchReading, v) : false;
    });
    return fitting.length > 0 ? fitting : candidateIds;
}

/**
 * What a sentence's own annotation says about one span (Tatoeba's `indices`, written
 * by hand; see annotationFor in sentenceReading.ts). Absent for sentences without one,
 * such as the grammar examples.
 */
export interface SpanAnnotation {
    /** The exact JMdict entry Tatoeba assigns to the span, when it names one: 妻(#1294330). */
    entryId?: string;
    /** Tatoeba lists this word, under any of its spellings, at the span. */
    lists(vocab: ReadingVocab): boolean;
    /** Tatoeba reads part of the span in a way none of the word's readings contains. */
    contradicts(vocab: ReadingVocab): boolean;
}

/**
 * Which vocab a sentence span matched under `term` (a written form, headword or
 * alternative spelling) belongs to. Every rule only removes candidates:
 *
 *  1. Tatoeba names the exact JMdict entry: only the word holding it (as its own id or
 *     a merged homograph) keeps the span. Tatoeba does so on ambiguous words, about
 *     21,000 times, which are the cases the rules below can only approximate.
 *  2. Homographs are told apart by reading (disambiguateByReading).
 *  3. A written form means the word it is the headword of: 妻 is "wife", not 端/つま
 *     "edge", which JMdict also lets be written 妻, though both read つま.
 *  4. A word matched through one of its other spellings needs the reading to agree,
 *     or Tatoeba to list it there: 外に read そとに is not 他に (ほかに), 説明し read
 *     せつめいし is not 説き明かし, but 一戸建 misread いちこけん is 一戸建て, which
 *     Tatoeba lists in that sentence.
 *  5. A word matched by its headword but misread is dropped only when Tatoeba's
 *     reading of part of the span contradicts it. A misreading alone is no evidence:
 *     the tokenizer misreads compounds (数日間 as すうにちかん), and dropping on that
 *     alone lost 1,459 real words.
 *  6. Except a word whose headword is another word plus a particle (`spelledAsParts`,
 *     see particleSpelledIds): the tokenizer reads such a span plainly, so a misread
 *     is evidence, as for another spelling. 誰が read だれが is 誰 + が, not たが "whose";
 *     彼の read かれの is 彼 + の, not あの.
 *
 * Returns no id when none survives; the caller then lets a shorter match take the span.
 */
export function resolveSentenceMatch(
    term: string,
    candidateIds: string[],
    matchReading: string | undefined,
    vocabById: Map<string, ReadingVocab>,
    annotation?: SpanAnnotation,
    spelledAsParts?: ReadonlySet<string>,
): string[] {
    const entryId = annotation?.entryId;
    if (entryId) {
        return candidateIds.filter(id => id === entryId || (vocabById.get(id)?.mergedVocabs ?? []).some(m => m.id === entryId));
    }
    let ids = disambiguateByReading(candidateIds, matchReading, vocabById);
    const owners = ids.filter(id => vocabById.get(id)?.writtenForm.kanji === term);
    if (owners.length > 0) ids = owners;
    if (!matchReading) return ids;
    return ids.filter(id => {
        const vocab = vocabById.get(id);
        if (!vocab || readingFitsVocab(matchReading, vocab)) return true;
        if (vocab.writtenForm.kanji !== term || spelledAsParts?.has(id)) return annotation?.lists(vocab) ?? false;
        return !annotation?.contradicts(vocab);
    });
}

const PARTICLES = ['が', 'に', 'は', 'を', 'も', 'で', 'と', 'の', 'へ', 'や', 'か'];

/**
 * Words whose headword is another word's headword plus one particle, but which are not
 * read as those parts: 誰が (たが, not だれ + が), 彼の (あの, not かれ + の). Over the
 * compiled dataset this is 11 words (彼の twice, 誰が, 最も, 何の, 愚か, 密か, 暖か, 如何に,
 * 此の, 正面に); the rule only bites where the tokenizer's reading does not fit, so 最も
 * read もっとも and 愚か read おろか keep their sentences.
 */
export function particleSpelledIds(vocabs: Iterable<ReadingVocab>): Set<string> {
    const readingsByHeadword = new Map<string, string[]>();
    const all = [...vocabs];
    for (const v of all) {
        const list = readingsByHeadword.get(v.writtenForm.kanji) ?? [];
        list.push(v.reading.primary, ...v.reading.alternatives);
        readingsByHeadword.set(v.writtenForm.kanji, list);
    }
    const ids = new Set<string>();
    for (const v of all) {
        const w = v.writtenForm.kanji;
        const particle = w.slice(-1);
        if (w.length < 2 || !PARTICLES.includes(particle)) continue;
        const partReadings = readingsByHeadword.get(w.slice(0, -1));
        if (!partReadings) continue;
        const own = [v.reading.primary, ...v.reading.alternatives];
        if (!own.some(r => partReadings.some(p => r === p + particle))) ids.add(v.id);
    }
    return ids;
}
