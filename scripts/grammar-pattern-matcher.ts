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

        // Two rounds: every EXACT match is considered before any containment
        // match is allowed. Taking the first match found regardless of kind let a
        // one-character literal claim a bystander word that merely contains that
        // kana - の matched この (index 0) before reaching the real の, and が
        // matched 思いますが. Exact-first keeps containment available for the
        // fused-suffix case it exists for (大人びた contains びた) without letting
        // it outrank a genuine token.
        for (let round = 0; round < 2 && foundCount < need; round++) {
        const allowSubstringThisRound = round === 1;
        for (let spanLen = 1; spanLen <= MAX_SPAN && foundCount < need; spanLen++) {
            for (let start = 0; start + spanLen <= words.length && foundCount < need; start++) {
                const span = words.slice(start, start + spanLen);
                if (span.some((_, k) => usedIndices.has(start + k))) continue;

                const combos = spanFormCombinations(span);
                const readJoin = span.map(w => (w.reading ? kataToHira(w.reading) : '')).join('');
                const allowSubstring = spanLen <= SUBSTRING_MAX_SPAN && allowSubstringThisRound;

                // Reading matching is EXACT only. Containment on a reading is how
                // a bare particle sneaks into a content word: ご飯's reading is
                // ごはん, which contains は, so the literal は "matched" 晩ご飯's
                // second token. Surface/baseForm containment is still allowed -
                // point 4 above needs it (大人びた contains びた).
                const isMatch =
                    combos.some(c => c === lit || (allowSubstring && c.includes(lit))) ||
                    (readJoin.length > 0 && readJoin === litHira);

                if (isMatch) {
                    const idxs = Array.from({ length: spanLen }, (_, k) => start + k);
                    idxs.forEach(i => { usedIndices.add(i); allMatched.push(i); });
                    foundCount++;
                }
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

/** Length of the longest literal a match actually recovered - its distinctiveness. */
function distinctiveness(match: VariantMatch): number {
    return Array.from(match.foundLiterals).reduce((max, lit) => Math.max(max, lit.length), 0);
}

/**
 * Locates the pattern in one example.
 *
 * Full matches (every distinct literal found) are preferred, and among those the
 * one that recovered the LONGEST literal wins. Taking the first full match
 * instead - as this used to - meant a variant carrying nothing but a bare
 * particle could win outright, because a single-literal variant trivially
 * "fully matches" and so bypassed the bystander-particle guard below.
 *
 * That is what broke n5-096 (`～どうですか`). Its formation reads
 * "Noun + は/が + どうですか / Verb-casual + の + どうですか / ...", and
 * `variantsOf` splits on "/" - producing the variant "Noun + は", whose only
 * literal is は. It fully matched and returned before any variant containing
 * どうですか was tried, anchoring the quiz blank on は (or, via reading
 * containment, on ご飯).
 *
 * Scoring by distinctiveness fixes that without needing to know whether a "/"
 * separates two whole shapes or two alternatives inside one slot: どうですか
 * (5 chars) simply outranks は (1 char). A point whose pattern genuinely IS a
 * bare particle (n5-043 "Noun + を") still anchors, because it is then the only
 * variant available.
 *
 * Falls back to the best partial match, but only if it recovered the single
 * longest required literal - a match that found nothing but bystander particles
 * is rejected rather than accepted as "good enough". Returns null (not an empty
 * array) when nothing qualifies, so callers can distinguish "no literals at all"
 * from "found nothing usable".
 */
export function locatePattern(formation: string, words: GrammarExampleWord[]): number[] | null {
    let bestFull: VariantMatch | null = null;
    let bestPartial: VariantMatch | null = null;

    for (const variant of variantsOf(formation)) {
        const match = matchVariant(words, variant);
        if (!match) continue;

        if (match.foundLiterals.size === match.requiredLiterals.size) {
            // Higher distinctiveness wins; on a tie, the TIGHTER anchor wins.
            // Two variants of the same point often share their most distinctive
            // literal and differ only in an extra particle - for `～どうですか`,
            // both "Verb-casual + の + どうですか" and "い-Adjective + どうですか"
            // recover どうですか, but the first also drags in a bystander when the
            // sentence has no の (matching の inside この). Fewer indices means the
            // blank covers the pattern and nothing else.
            const better = !bestFull
                || distinctiveness(match) > distinctiveness(bestFull)
                || (distinctiveness(match) === distinctiveness(bestFull) && match.indices.length < bestFull.indices.length);
            if (better) bestFull = match;
            continue;
        }

        if (!bestPartial
            || match.foundLiterals.size > bestPartial.foundLiterals.size
            || (match.foundLiterals.size === bestPartial.foundLiterals.size && distinctiveness(match) > distinctiveness(bestPartial))) {
            bestPartial = match;
        }
    }

    // A partial match that recovered the point's distinctive marker is worth more
    // than a FULL match on a bare particle. `variantsOf` splits on "/", and that
    // slash is used both between whole shapes and inside a single slot - the
    // spacing does not distinguish them reliably (n1-075 "のいかんだ/Noun" is
    // unspaced but separates shapes; n1-002 "な-adjective / Noun" is spaced but
    // alternates within a slot). So splitting inevitably produces junk variants
    // like "Noun + は", which fully match on は alone.
    //
    // n5-122 ("Noun + は/が + なんと言いますか") is the case: the sentences have no
    // が, so the variant carrying なんと言いますか can only ever match partially,
    // while the junk "Noun + は" variant matches fully. Ranking both by what they
    // actually recovered puts なんと言いますか (7 chars) ahead of は (1).
    const usablePartial = (() => {
        if (!bestPartial) return null;
        const longestRequired = Array.from(bestPartial.requiredLiterals).sort((a, b) => b.length - a.length)[0];
        // Still rejected if it found nothing but bystander particles rather than
        // the variant's own most distinctive literal.
        return bestPartial.foundLiterals.has(longestRequired) ? bestPartial : null;
    })();

    if (bestFull && usablePartial) {
        return distinctiveness(usablePartial) > distinctiveness(bestFull)
            ? usablePartial.indices
            : bestFull.indices;
    }
    if (bestFull) return bestFull.indices;
    if (usablePartial) return usablePartial.indices;
    return null;
}
