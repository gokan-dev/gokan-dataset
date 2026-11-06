// Which Chinese texts a learner is shown (the acceptance rule, decision D13 in
// docs/MULTILINGUAL.md, provisional, 2026-11-06). Set from the gold set's review: a text two
// independent communities agree on was right 97.4% of the time, a single source's imported
// equivalent 63 to 65% (Japanese Wiktionary, Wikidata), Chinese Wiktionary's own definitions
// 98.9% even without a second source. So: shown when reviewed or corroborated, or imported from
// a source reliable on its own; never when rejected. Every consumer (the search gloss here, the
// apps later) decides through this function, so the rule changes in one place.
import type { Rendering, SourceId } from '../models/text.model';

/**
 * Sources whose imported text is shown without a second source: Chinese Wiktionary's
 * definitions (98.9% right on the gold set), Tatoeba's Mandarin (first hand by construction: only
 * a translation made from the Japanese is kept) and Unihan (facts about a character, not
 * translations). Gokan's AI-drafted notes are not, until a person reviews them (decision D4).
 */
export const SHOWN_WHEN_IMPORTED: ReadonlySet<SourceId> = new Set(['zhwiktionary', 'tatoeba-cmn', 'unihan']);

export function isShown(rendering: Pick<Rendering, 'status' | 'source'>): boolean {
    switch (rendering.status) {
        case 'reviewed':
        case 'corroborated':
            return true;
        case 'rejected':
            return false;
        case 'imported':
            return SHOWN_WHEN_IMPORTED.has(rendering.source.source);
    }
}
