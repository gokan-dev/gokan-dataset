import type { Sentence } from '../models/sentence.model';

/**
 * The sentences a quiz shows for a word, approximated for a learner who knows none of the
 * words around it. The app ranks with the learner's own words (gokan-srs
 * `utils/sentenceRanking.ts`), which the dataset cannot know, so audio is made for the
 * first few a new learner sees, not only the first.
 *
 * Unknown weight first (a word written with a kanji counts 1, one in kana 0.5, an
 * unmatched kanji run 1, an unmatched katakana run 0.5), then length in bands of 10.
 */
const LENGTH_BAND = 10;
const KANJI_RE = /[一-鿿々]/;
const KANJI_RUN_RE = /[一-鿿々]+/g;
const KATAKANA_RUN_RE = /[ァ-ヺー]{2,}/g;

/** The ranker's unknown weight for a learner who knows no word but the target. */
export function unknownWeight(sentence: Sentence, target: string): number {
    let weight = 0;
    const covered: [number, number][] = [];
    for (const vocabId of sentence.vocabIds) {
        const spans = sentence.matches?.[vocabId] ?? [];
        for (const span of spans) covered.push([span.start, span.start + span.length]);
        if (vocabId === target) continue;
        const withKanji = spans.length === 0 || spans.some(s => KANJI_RE.test(sentence.original.slice(s.start, s.start + s.length)));
        weight += withKanji ? 1 : 0.5;
    }
    covered.sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    const uncovered: string[] = [];
    for (const [start, end] of covered) {
        if (start > cursor) uncovered.push(sentence.original.slice(cursor, start));
        cursor = Math.max(cursor, end);
    }
    uncovered.push(sentence.original.slice(cursor));
    for (const text of uncovered) {
        weight += (text.match(KANJI_RUN_RE)?.length ?? 0) + (text.match(KATAKANA_RUN_RE)?.length ?? 0) * 0.5;
    }
    return weight;
}

/** A word's sentences in the order a new learner meets them. Ties break on the id, so the order is stable. */
export function rankForNewLearner(target: string, sentences: readonly Sentence[]): Sentence[] {
    const scored = sentences.map(s => ({ s, weight: unknownWeight(s, target), band: Math.ceil(s.original.length / LENGTH_BAND) }));
    scored.sort((a, b) => a.weight - b.weight || a.band - b.band || a.s.id.localeCompare(b.s.id));
    return scored.map(x => x.s);
}
