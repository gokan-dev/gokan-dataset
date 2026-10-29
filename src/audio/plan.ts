import { toKatakana, pronunciationKey } from './kana';
import type { InputVariant } from './config';
import type { AudioItem, ReadingSpan } from './scope';

/** The engine's pronunciation of a text, in kana (VOICEVOX: the morae of its audio query). */
export type Pronounce = (text: string) => Promise<string>;

export interface InputPlan {
    written: string;
    /** The text with each misread word in kana; the written text when nothing is misread. */
    forced: string;
    /** Our readings the engine does not say from the written text. */
    misread: ReadingSpan[];
}

function withKana(text: string, spans: readonly ReadingSpan[]): string {
    let out = '';
    let cursor = 0;
    for (const span of spans) {
        out += text.slice(cursor, span.start) + span.reading;
        cursor = span.start + span.length;
    }
    return out + text.slice(cursor);
}

/**
 * Finds the words the engine reads differently from us. A word is compared in place: the
 * sentence is pronounced once as written and once with that word in kana, and the two
 * compared as pronounced (pronunciationKey), so the rest of the sentence, read the same
 * both times, cancels out. A word item is one span over its whole text.
 */
export async function planInput(item: AudioItem, pronounce: Pronounce): Promise<InputPlan> {
    if (item.readings.length === 0) return { written: item.text, forced: item.text, misread: [] };
    const base = pronunciationKey(await pronounce(item.text));
    const misread: ReadingSpan[] = [];
    for (const span of item.readings) {
        // A span already in kana says what it shows.
        if (toKatakana(item.text.slice(span.start, span.start + span.length)) === toKatakana(span.reading)) continue;
        const substituted = pronunciationKey(await pronounce(withKana(item.text, [span])));
        if (substituted !== base) misread.push(span);
    }
    return { written: item.text, forced: withKana(item.text, misread), misread };
}

export function inputFor(plan: InputPlan, variant: InputVariant): string {
    switch (variant) {
        case 'written': return plan.written;
        case 'forced': return plan.forced;
    }
}
