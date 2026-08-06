import type { GrammarExampleWord } from '../src/models/grammar.model';

/**
 * Locates a grammar point's literal pattern markers (e.g. が and いちばん for
 * "Noun + が + いちばん + Adjective/Verb") within one tokenized example
 * sentence, by matching the literal Japanese fragments embedded in
 * `formation` against the sentence's words. Runs at build time so the app
 * never needs to do this matching itself - see docs/SCHEMA.md's
 * `patternWordIndices` field and the grammar-pattern-location issue for the
 * full rationale.
 *
 * `formation` is a human-readable template string, not structured data, so
 * this necessarily involves some heuristics. Several are load-bearing enough
 * to document explicitly:
 *
 * 1. Conjugation scaffolding ("Verb-ますstem", "ない form", "い-adjective",
 *    "連用形"...) embeds Japanese grammatical terminology that is NOT literal
 *    pattern text - it describes a conjugation rule. `stripConjugationScaffolding`
 *    recognizes and removes these phrases before extracting literals. A blanket
 *    hiragana blocklist would be wrong here: に/で/と/が/は are genuine literal
 *    pattern text in many OTHER points, so only the specific "X-stem"/"X form"/
 *    "-adjective"/conjugation-form-name scaffolding is stripped, not the
 *    characters themselves.
 *
 * 2. `formation` often lists multiple alternative shapes for the same point
 *    (comma, "or", "/", newline, or ❶❷❸-separated), e.g. "Noun + にせよ +
 *    Noun + にせよ (also works with verbs...)". Each alternative is tried as
 *    its own independent variant; the first one that matches wins.
 *
 * 3. `formation` gives the dictionary/base form of conjugating words (くれる,
 *    される, 思う), but the example sentence naturally conjugates them (くれた,
 *    された, 思います). Matching tries EVERY combination of each span token's
 *    surface vs. baseForm (kuromoji's dictionary form, captured per word) -
 *    not just "all surface" or "all baseform" uniformly - because some
 *    formation literals mix an unconjugated stem with a normalized auxiliary
 *    in the same fragment (来ます: surface "来" + baseForm-normalized "ます"
 *    from a conjugated "まし").
 *
 * 4. Multi-token spans additionally allow substring containment (not just
 *    exact equality) up to 2 tokens, to catch a productive suffix fused onto
 *    a content word's own surface by the tokenizer (大人びた: content word
 *    "大人び" + auxiliary "た" concatenate to "大人びた", which *contains* the
 *    literal "びた" without equaling it). Kept to 2 tokens specifically -
 *    wider substring search on longer spans risks accidental containment.
 *
 * 5. Literals are matched longest-first, so a short, generic literal (a bare
 *    particle like を) can't claim a token index a longer, more distinctive
 *    literal also needs (をめぐって tokenizes as ONE fused token; を alone
 *    would happily "find" it via includes() and block めぐって from the same
 *    position if processed first).
 */

const JP_RUN = /[぀-ゟ゠-ヿ一-鿿]+/g;

function kataToHira(s: string): string {
    return s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function stripParentheticals(s: string): string {
    return s.replace(/\([^)]*\)/g, ' ');
}

function stripConjugationScaffolding(s: string): string {
    return s
        .replace(/[ぁ-ゖ]*(?:ます|ない|た|て|だ|で)\s*[-ー]?\s*(?:stem|form)/gi, ' ')
        .replace(/(?:い|な)[-ー]?adjective/gi, ' ')
        .replace(/[ぁ-ゖ]*(?:形|語幹|連用形|連体形|辞書形|終止形|未然形|意向形|可能形|受身形|使役形)/g, ' ');
}

function variantsOf(formation: string): string[] {
    return stripConjugationScaffolding(stripParentheticals(formation))
        .split(/,|\n|\/| or |❶|❷|❸/i)
        .map(s => s.trim())
        .filter(Boolean);
}

const MAX_SPAN = 8; // longest observed literal needing multi-token concatenation (ともなると = 4 tokens); generous headroom above that.
const SUBSTRING_MAX_SPAN = 2; // see doc comment point 4 - kept narrow to avoid accidental containment on longer spans.

/** Every surface/baseForm combination for a token span, e.g. [来(baseForm none), まし(baseForm ます)] -> ["来まし", "来ます"]. */
function spanFormCombinations(span: GrammarExampleWord[]): string[] {
    let combos = [''];
    for (const w of span) {
        const forms = w.baseForm && w.baseForm !== w.surface ? [w.surface, w.baseForm] : [w.surface];
        combos = combos.flatMap(prefix => forms.map(f => prefix + f));
    }
    return Array.from(new Set(combos));
}

interface VariantMatch {
    indices: number[];
    /** Every distinct literal in the variant that was found (for quality scoring). */
    foundLiterals: Set<string>;
    /** Every distinct literal required by the variant. */
    requiredLiterals: Set<string>;
}

function matchVariant(words: GrammarExampleWord[], variant: string): VariantMatch | null {
    const occurrences = [...variant.matchAll(JP_RUN)].map(m => m[0]);
    if (occurrences.length === 0) return null;

    const requiredLiterals = new Set(occurrences);
    const counts = new Map<string, number>();
    for (const lit of occurrences) counts.set(lit, (counts.get(lit) ?? 0) + 1);

    // Longest first (point 5): a more specific literal gets first claim on a
    // token span before a shorter, more generic one can steal it.
    const orderedLiterals = Array.from(requiredLiterals).sort((a, b) => b.length - a.length);

    const usedIndices = new Set<number>();
    const allMatched: number[] = [];
    const foundLiterals = new Set<string>();

    for (const lit of orderedLiterals) {
        const litHira = kataToHira(lit);
        const need = counts.get(lit) ?? 1;
        let foundCount = 0;

        for (let spanLen = 1; spanLen <= MAX_SPAN && foundCount < need; spanLen++) {
            for (let start = 0; start + spanLen <= words.length && foundCount < need; start++) {
                const span = words.slice(start, start + spanLen);
                if (span.some((_, k) => usedIndices.has(start + k))) continue;

                const combos = spanFormCombinations(span);
                const readJoin = span.map(w => (w.reading ? kataToHira(w.reading) : '')).join('');
                const allowSubstring = spanLen <= SUBSTRING_MAX_SPAN;

                const isMatch =
                    combos.some(c => c === lit || (allowSubstring && c.includes(lit))) ||
                    (readJoin.length > 0 && (readJoin === litHira || (allowSubstring && readJoin.includes(litHira))));

                if (isMatch) {
                    const idxs = Array.from({ length: spanLen }, (_, k) => start + k);
                    idxs.forEach(i => { usedIndices.add(i); allMatched.push(i); });
                    foundCount++;
                }
            }
        }

        if (foundCount > 0) foundLiterals.add(lit);
    }

    if (allMatched.length === 0) return null;
    return {
        indices: Array.from(new Set(allMatched)).sort((a, b) => a - b),
        foundLiterals,
        requiredLiterals,
    };
}

/**
 * Locates the pattern in one example. Prefers a variant where every distinct
 * literal is found (a full match); if no variant achieves that, falls back to
 * the best partial match, but ONLY if it recovered the single longest (most
 * distinctive) literal - a match that recovered nothing but a bare particle
 * like が or に would be barely more useful than the frequency-fallback bug
 * this whole mechanism replaces, so it's rejected rather than accepted as
 * "good enough". Returns null (not an empty array) when nothing qualifies, so
 * callers can distinguish "no literals at all" from "found nothing usable".
 */
export function locatePattern(formation: string, words: GrammarExampleWord[]): number[] | null {
    let bestPartial: VariantMatch | null = null;

    for (const variant of variantsOf(formation)) {
        const match = matchVariant(words, variant);
        if (!match) continue;

        if (match.foundLiterals.size === match.requiredLiterals.size) {
            return match.indices; // full match - take it immediately, first variant to fully match wins
        }

        if (!bestPartial || match.foundLiterals.size > bestPartial.foundLiterals.size) {
            bestPartial = match;
        }
    }

    if (!bestPartial) return null;

    const longestRequired = Array.from(bestPartial.requiredLiterals).sort((a, b) => b.length - a.length)[0];
    if (!bestPartial.foundLiterals.has(longestRequired)) return null; // rejected: only found bystander particles, not the distinctive marker

    return bestPartial.indices;
}
