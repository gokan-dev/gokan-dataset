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
}

/** Katakana -> hiragana, so a loanword's hiragana sentence reading (こーひー) compares
 * equal to its katakana dictionary reading (コーヒー). */
function kataToHira(s: string): string {
    return s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function inflects(vocab: ReadingVocab): boolean {
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
