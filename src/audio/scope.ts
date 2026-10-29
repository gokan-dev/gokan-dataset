import type { GrammarExample } from '../models/grammar.model';
import type { Sentence } from '../models/sentence.model';
import type { Vocabulary } from '../models/vocabulary.model';
import { canonicalJson, sha256Hex } from './config';
import { rankForNewLearner } from './ranking';

/** Our reading of one word in an item's text: what the clip must say there. */
export interface ReadingSpan {
    start: number;
    length: number;
    reading: string;
}

/**
 * Something read aloud. Its id says where the clip is attached:
 * - `w:{vocabId}`: a word's reading;
 * - `s:{sentenceId}`: a Tatoeba sentence, in every word's file it appears in, and as any
 *   grammar example with the same text;
 * - `g:{hash}`: a grammar example that is not one of our sentences, by its text.
 */
export interface AudioItem {
    id: string;
    text: string;
    /** Non-overlapping, in order of `start`. */
    readings: ReadingSpan[];
}

export type WordForAudio = Pick<Vocabulary, 'id' | 'writtenForm' | 'reading' | 'usuallyKana'>;

/** A word is read from its written form, its reading checked against ours; a word learned in kana, or with no kanji form, from its kana. */
export function wordItem(vocab: WordForAudio): AudioItem {
    const kanaOnly = vocab.usuallyKana === true || vocab.writtenForm.kanji === '' || vocab.writtenForm.kanji === vocab.reading.primary;
    const text = kanaOnly ? vocab.reading.primary : vocab.writtenForm.kanji;
    return {
        id: `w:${vocab.id}`,
        text,
        readings: kanaOnly ? [] : [{ start: 0, length: text.length, reading: vocab.reading.primary }],
    };
}

/** Keeps the longest of overlapping spans (a compound over the words inside it), in text order. */
function nonOverlapping(spans: ReadingSpan[]): ReadingSpan[] {
    const sorted = [...spans].sort((a, b) => a.start - b.start || b.length - a.length);
    const kept: ReadingSpan[] = [];
    let end = 0;
    for (const span of sorted) {
        if (span.length === 0 || span.start < end) continue;
        kept.push(span);
        end = span.start + span.length;
    }
    return kept;
}

/**
 * A character outside the Basic Multilingual Plane (𝑥, 𠮟) is two UTF-16 units, and the
 * match offsets after one are not reliable (s:5058891: 実数's span starts inside the 𝑥).
 * Such a text is read as written: putting kana at a wrong offset would cut a character
 * in half or replace the wrong word.
 */
const ASTRAL = /[\uD800-\uDFFF]/;

export function sentenceItem(sentence: Pick<Sentence, 'id' | 'original' | 'matches'>): AudioItem {
    const spans: ReadingSpan[] = [];
    for (const matches of Object.values(sentence.matches ?? {})) {
        for (const m of matches) {
            if (m.reading) spans.push({ start: m.start, length: m.length, reading: m.reading });
        }
    }
    const readings = ASTRAL.test(sentence.original) ? [] : nonOverlapping(spans);
    return { id: `s:${sentence.id}`, text: sentence.original, readings };
}

/**
 * A grammar example that is not one of our sentences. Only uninflected words carry a
 * reading: an example word's `reading` is its dictionary form's (住ん is given すん, from
 * 住む), so an inflected one is left to the engine.
 */
export function grammarItem(example: Pick<GrammarExample, 'jp' | 'words'>): AudioItem {
    const spans: ReadingSpan[] = [];
    let offset = 0;
    for (const word of example.words) {
        if (word.vocabId && word.reading && word.baseForm === undefined) {
            spans.push({ start: offset, length: word.surface.length, reading: word.reading });
        }
        offset += word.surface.length;
    }
    return { id: grammarItemId(example.jp), text: example.jp, readings: ASTRAL.test(example.jp) ? [] : nonOverlapping(spans) };
}

export function grammarItemId(text: string): string {
    return `g:${sha256Hex(text).slice(0, 16)}`;
}

/**
 * What an item's clip was made from, on our side: its text and our readings. The clips
 * manifest records it, so a clip whose sentence was edited since is not attached to it.
 */
export function sourceHash(item: AudioItem): string {
    return sha256Hex(canonicalJson({ text: item.text, readings: item.readings })).slice(0, 16);
}

export interface ScopeInput {
    vocab: readonly WordForAudio[];
    /** Each word's sentences, as in `compiled/sentences/{vocabId}.json`. */
    sentencesByVocab: ReadonlyMap<string, readonly Sentence[]>;
    grammarExamples: readonly Pick<GrammarExample, 'jp' | 'words'>[];
    /** How many of each word's sentences, in the order a new learner meets them. */
    topSentences: number;
}

/**
 * The order to make clips in: a word's reading and its sentences together, the most
 * frequent words first, grammar examples last. A fill that stops halfway has then voiced
 * the words a learner meets first.
 */
export function generationOrder(scope: readonly AudioItem[], input: ScopeInput, rankOf: (vocabId: string) => number): AudioItem[] {
    const priority = new Map<string, number>();
    const lower = (id: string, rank: number) => priority.set(id, Math.min(priority.get(id) ?? Infinity, rank));
    for (const vocab of input.vocab) lower(`w:${vocab.id}`, rankOf(vocab.id));
    for (const [vocabId, sentences] of input.sentencesByVocab) {
        for (const s of rankForNewLearner(vocabId, sentences).slice(0, input.topSentences)) lower(`s:${s.id}`, rankOf(vocabId));
    }
    const p = (item: AudioItem) => priority.get(item.id) ?? Infinity;
    return [...scope].sort((a, b) => p(a) - p(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The first build's scope (gokan-srs#164): every word's reading, each word's first
 * `topSentences` sentences for a new learner, and every grammar example. A grammar example
 * that is one of our sentences is that sentence's item, so one clip serves both. Sorted by
 * id, so the order is stable from run to run.
 */
export function selectScope(input: ScopeInput): AudioItem[] {
    const items = new Map<string, AudioItem>();
    const sentenceByText = new Map<string, Sentence>();
    for (const vocab of input.vocab) items.set(`w:${vocab.id}`, wordItem(vocab));
    for (const [vocabId, sentences] of input.sentencesByVocab) {
        for (const s of sentences) sentenceByText.set(s.original, s);
        for (const s of rankForNewLearner(vocabId, sentences).slice(0, input.topSentences)) {
            items.set(`s:${s.id}`, sentenceItem(s));
        }
    }
    for (const example of input.grammarExamples) {
        const sentence = sentenceByText.get(example.jp);
        const item = sentence ? sentenceItem(sentence) : grammarItem(example);
        items.set(item.id, item);
    }
    return [...items.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
