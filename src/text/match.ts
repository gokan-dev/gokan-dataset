// The matcher (docs/MULTILINGUAL.md, "Matching"): a source's record to the one word it is about,
// with the evidence for it, or no word at all. A record that matches nothing, or more than one
// word, is counted with the reason and never attached by guess.
import type { MatchEvidence } from '../models/text.model';
import { hiraganaReading } from './kaikki';

/** What the matcher knows of a word: how it is written and how it is read. */
export interface MatchWord {
    id: string;
    headword: string;
    /** Its headword, its other spellings and, for a word learned in kana, that kana spelling. */
    spellings: string[];
    readings: string[];
}

export interface WordIndex {
    bySpelling: Map<string, MatchWord[]>;
    byHeadword: Map<string, MatchWord[]>;
    readings: Map<string, Set<string>>;
}

export function wordIndex(words: Iterable<MatchWord>): WordIndex {
    const index: WordIndex = { bySpelling: new Map(), byHeadword: new Map(), readings: new Map() };
    for (const word of words) {
        for (const spelling of new Set(word.spellings)) index.bySpelling.set(spelling, [...(index.bySpelling.get(spelling) ?? []), word]);
        index.byHeadword.set(word.headword, [...(index.byHeadword.get(word.headword) ?? []), word]);
        index.readings.set(word.id, new Set(word.readings.map(hiraganaReading)));
    }
    return index;
}

export type MatchFailure = 'no word' | 'no reading' | 'reading differs' | 'several words';
export type MatchResult = { id: string; match: MatchEvidence } | { failure: MatchFailure };

function single(candidates: MatchWord[], match: MatchEvidence): MatchResult {
    if (candidates.length === 0) return { failure: 'no word' };
    const [only, ...others] = candidates;
    return only && others.length === 0 ? { id: only.id, match } : { failure: 'several words' };
}

/** A record giving a spelling and its readings (Wiktionary, Wikidata): the one word written and read so. */
export function matchSpellingAndReading(index: WordIndex, spelling: string, readings: string[]): MatchResult {
    const written = index.bySpelling.get(spelling) ?? [];
    if (written.length === 0) return { failure: 'no word' };
    if (readings.length === 0) return { failure: 'no reading' };
    const read = new Set(readings.map(hiraganaReading));
    const both = written.filter(w => [...(index.readings.get(w.id) ?? [])].some(r => read.has(r)));
    return both.length === 0 ? { failure: 'reading differs' } : single(both, 'spelling+reading');
}

/** A record giving only a spelling (a reverse entry's gloss): the one word written so. */
export function matchSpelling(index: WordIndex, spelling: string): MatchResult {
    return single(index.bySpelling.get(spelling) ?? [], 'spelling');
}

/** A record naming a headword (a Wikipedia title): the one word whose headword it is. */
export function matchHeadword(index: WordIndex, headword: string): MatchResult {
    return single(index.byHeadword.get(headword) ?? [], 'spelling');
}

/** What each source's records matched, and why the others did not, for the build log. */
export class MatchLog {
    private readonly counts = new Map<string, Map<string, number>>();
    private readonly samples = new Map<string, string[]>();

    record(source: string, result: MatchResult | 'excluded', sample: string): void {
        const outcome = result === 'excluded' ? 'excluded' : 'failure' in result ? result.failure : 'matched';
        const bySource = this.counts.get(source) ?? new Map<string, number>();
        bySource.set(outcome, (bySource.get(outcome) ?? 0) + 1);
        this.counts.set(source, bySource);
        const key = `${source}\u0000${outcome}`;
        const samples = this.samples.get(key) ?? [];
        if (outcome !== 'matched' && samples.length < 20) samples.push(sample);
        this.samples.set(key, samples);
    }

    count(source: string, outcome: string): number {
        return this.counts.get(source)?.get(outcome) ?? 0;
    }

    /** One line per source, outcomes in a fixed order. */
    summary(): string[] {
        return [...this.counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([source, outcomes]) =>
            `${source}: ${[...outcomes].sort(([a], [b]) => (a < b ? -1 : 1)).map(([o, n]) => `${o} ${n}`).join(', ')}`);
    }

    /** The summary, then each failure's samples, for build/assembled/text_matching.log. */
    report(): string {
        const lines = [...this.summary(), ''];
        for (const [key, samples] of [...this.samples].sort(([a], [b]) => (a < b ? -1 : 1))) {
            if (samples.length === 0) continue;
            lines.push(`## ${key.replace('\u0000', ': ')}`, ...samples, '');
        }
        return lines.join('\n');
    }
}
