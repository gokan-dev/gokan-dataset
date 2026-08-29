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
 * 4. When no token span IS the literal, the literal is looked for in the
 *    sentence's CHARACTER string, and the blank snaps to every token that
 *    character range touches. The tokenizer regularly puts a marker inside a
 *    token rather than on a boundary - 大人びた fuses the productive suffix
 *    びた onto 大人び, 先生ともあろう者 glues 者 onto ろう, and 遅れるべきで
 *    swallows べき whole - and no amount of span searching over whole tokens
 *    reaches those.
 *
 * 5. That snapping is bounded by how far it would OVERSHOOT the marker, in
 *    characters: `MAX_CONTAINMENT_RESIDUE`. A token count cannot express this
 *    bound, which is why the old 2-token cap both blocked ともあろう (three
 *    tokens, one character of overshoot) and would have allowed っけ to claim
 *    面白かったっけ (one token, five characters of overshoot). Measured, raising
 *    that cap gained 6 anchors and spoiled 3; the character bound gains the
 *    same 6 and spoils none.
 *
 * 6. A pattern whose marker REPEATS (`A にしろ B にしろ`) must have every
 *    occurrence blanked, or the sentence hands over its own answer: with only
 *    the first にしろ blanked, 行く[__]行かないにしろ leaves the second one in
 *    plain sight. The occurrence count cannot come from `formation`, which
 *    lists the marker once per slot alternative
 *    ("Verb + にしろ, い-Adjective + にしろ, ...") and is then split into
 *    single-occurrence variants by `variantsOf`. It comes from the TITLE, which
 *    is where the repetition is actually stated - 30 of 755 points repeat a
 *    literal in their title, and every one is a genuine repeating pattern.
 *
 *    The literal being searched only counts as the repeated one if it contains
 *    the title's repeated literal or is contained by it (だし contains し for
 *    "〜し、〜し、〜"; と is contained by うと for "A うと B うと"). That test is
 *    what keeps `文A。そのうえ 文B。` out of it: 文 repeats, but the marker
 *    そのうえ is unrelated to it and stays single-occurrence.
 *
 * 8. A marker is also looked for in its politeness and voicing forms
 *    (`markerAlternates`). `formation` writes ものではない while the sentence says
 *    ものではありません, and nothing in the formation then appears at all. Each
 *    generated form is matched EXACTLY, so this widens what is looked for
 *    rather than loosening how it is compared.
 *
 * 7. Literals are matched longest-first, so a short, generic literal (a bare
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

/**
 * The Japanese literals a title states more than once - see doc comment point 6.
 * Scaffolding like A / B / 〜 is not Japanese so it never lands here, but 文
 * ("sentence A ... sentence B") does, which is why callers must also check that
 * the literal they are matching is related to it.
 */
export function repeatedTitleLiterals(title: string): Set<string> {
    const counts = new Map<string, number>();
    for (const run of title.matchAll(JP_RUN)) counts.set(run[0], (counts.get(run[0]) ?? 0) + 1);
    return new Set([...counts].filter(([, n]) => n > 1).map(([run]) => run));
}

/**
 * Politeness and voicing alternates for a marker's TAIL, keyed by what
 * `formation` writes. Each generated candidate is still matched EXACTLY - this
 * expands the set of strings looked for rather than loosening the comparison,
 * which matters because every loosening this file has tried produced false
 * anchors (#16, #21, #23).
 *
 * `formation` names the marker in plain dictionary form, but a sentence is free
 * to politen or voice it, and then no literal in the formation appears anywhere:
 *
 *   ものではない   ->  そんなことを言うものではありません。
 *   つもりだ     ->  明日は早く起きるつもりです。
 *   たらいい     ->  雨が止んだらいいな。
 *
 * Applied to the tail ONLY, and only when the marker actually ends in one of
 * these. Substituting anywhere inside a marker would be a false-anchor
 * generator: ない occurs inside plenty of markers that are not negated.
 */
const TAIL_ALTERNATES: [string, string[]][] = [
    ['ない', ['ありません', 'ません', 'ないです']],
    ['である', ['です']],
    ['だ', ['です', 'でしょう', 'だった', 'でした', 'の']],
];

/**
 * Initial-mora voicing, the euphony `conjugator.ts` applies in the other
 * direction. Only for markers of 2+ characters: a bare て or た expanding to で
 * or だ puts two of the commonest particles in the language into the candidate
 * set, and measured, it cost n5-046 its て-form anchor to a stray で.
 */
const VOICED_HEADS: [string, string][] = [['て', 'で'], ['た', 'だ']];
const MIN_VOICED_MARKER = 2;

/**
 * The marker, plus every politeness/voicing form a sentence might use instead.
 * The marker itself always comes first, so an exact hit still wins.
 */
export function markerAlternates(marker: string): string[] {
    const out = [marker];
    for (const [tail, alternates] of TAIL_ALTERNATES) {
        if (!marker.endsWith(tail) || marker === tail) continue;
        const stem = marker.slice(0, marker.length - tail.length);
        for (const alternate of alternates) out.push(stem + alternate);
    }
    if (marker.length >= MIN_VOICED_MARKER) {
        for (const [plain, voiced] of VOICED_HEADS) {
            if (marker.startsWith(plain)) out.push(voiced + marker.slice(plain.length));
        }
    }
    return Array.from(new Set(out));
}

const MAX_SPAN = 8; // longest observed literal needing multi-token concatenation (ともなると = 4 tokens); generous headroom above that.
/**
 * A containment match must cover at least this fraction of the token it was
 * found inside - see doc comment point 5.
 */
const MAX_CONTAINMENT_RESIDUE = 3;

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

function matchVariant(
    words: GrammarExampleWord[],
    variant: string,
    repeatedInTitle: Set<string>
): VariantMatch | null {
    const occurrences = [...variant.matchAll(JP_RUN)].map(m => m[0]);
    if (occurrences.length === 0) return null;

    const requiredLiterals = new Set(occurrences);
    const counts = new Map<string, number>();
    for (const lit of occurrences) counts.set(lit, (counts.get(lit) ?? 0) + 1);

    // Longest first (point 7): a more specific literal gets first claim on a
    // token span before a shorter, more generic one can steal it.
    const orderedLiterals = Array.from(requiredLiterals).sort((a, b) => b.length - a.length);

    const usedIndices = new Set<number>();
    const allMatched: number[] = [];
    const foundLiterals = new Set<string>();

    // Character offsets of every token, and the sentence they reconstruct.
    // `words` concatenates back to the original sentence exactly - an invariant
    // build-grammar.words.test.ts asserts - so these offsets are exact.
    const offsets: [number, number][] = [];
    let cursor = 0;
    for (const w of words) {
        offsets.push([cursor, cursor + w.surface.length]);
        cursor += w.surface.length;
    }
    const text = words.map(w => w.surface).join('');

    for (const lit of orderedLiterals) {
        const litHira = kataToHira(lit);
        // A repeating marker takes every occurrence the sentence offers, not the
        // one the split-up variant happens to name - see doc comment point 6.
        const repeats = [...repeatedInTitle].some(t => lit.includes(t) || t.includes(lit));
        const need = repeats ? Number.POSITIVE_INFINITY : (counts.get(lit) ?? 1);
        let foundCount = 0;

        const claim = (indices: number[]) => {
            indices.forEach(i => { usedIndices.add(i); allMatched.push(i); });
            foundCount++;
        };

        // Round 1, exact: a token span whose surface/baseForm combination - or
        // whose reading - IS the literal. Every exact match is taken before any
        // character-level one is considered. Mixing the two let a one-character
        // literal claim a bystander that merely contains that kana: の matched
        // この before reaching the real の, and が matched 思いますが.
        //
        // Reading matching is exact only, and stays that way. Containment on a
        // reading is how a bare particle sneaks into a content word: ご飯's
        // reading is ごはん, which contains は, so は "matched" 晩ご飯.
        for (let spanLen = 1; spanLen <= MAX_SPAN && foundCount < need; spanLen++) {
            for (let start = 0; start + spanLen <= words.length && foundCount < need; start++) {
                const span = words.slice(start, start + spanLen);
                if (span.some((_, k) => usedIndices.has(start + k))) continue;

                const readJoin = span.map(w => (w.reading ? kataToHira(w.reading) : '')).join('');
                const isMatch = spanFormCombinations(span).some(c => c === lit)
                    || (readJoin.length > 0 && readJoin === litHira);

                if (isMatch) claim(Array.from({ length: spanLen }, (_, k) => start + k));
            }
        }

        // Round 2, one token, surface OR baseForm. Kept separate from the
        // character search below because that search only ever sees surfaces,
        // and a productive suffix is often only visible in the DICTIONARY form:
        // 大人びている carries baseForm 大人びる, which is the only place the
        // literal びる appears at all.
        for (let i = 0; i < words.length && foundCount < need; i++) {
            if (usedIndices.has(i)) continue;
            const hit = spanFormCombinations([words[i]]).some(c =>
                c !== lit
                && c.includes(lit)
                && c.length - lit.length <= MAX_CONTAINMENT_RESIDUE
                && (!repeats || c.endsWith(lit)));
            if (hit) claim([i]);
        }

        // Round 3, character offsets - see doc comment point 4 - over the marker
        // and its politeness/voicing alternates (point 8).
        const candidates = markerAlternates(lit);
        for (const candidate of candidates) {
        if (foundCount >= need) break;
        for (let at = text.indexOf(candidate); at >= 0 && foundCount < need; at = text.indexOf(candidate, at + 1)) {
            const litEnd = at + candidate.length;
            const touched: number[] = [];
            for (let i = 0; i < offsets.length; i++) {
                if (offsets[i][0] < litEnd && offsets[i][1] > at) touched.push(i);
            }
            if (touched.length === 0 || touched.some(i => usedIndices.has(i))) continue;

            // The residue is what the blank would cover BEYOND the marker,
            // measured in characters. A token count cannot express this: ともあろう
            // needs three tokens (とも|あ|ろう者) and overshoots by one character,
            // while っけ needs one token (面白かったっけ) and overshoots by five.
            const spanStart = offsets[touched[0]][0];
            const spanEnd = offsets[touched[touched.length - 1]][1];
            if (spanEnd - spanStart - candidate.length > MAX_CONTAINMENT_RESIDUE) continue;

            // A repeating marker must END a single token - see doc comment
            // point 6. り inside たり passes; し inside 美味しい does not.
            if (repeats && !(touched.length === 1 && spanEnd === litEnd)) continue;

            claim(touched);
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
export function locatePattern(
    formation: string,
    words: GrammarExampleWord[],
    title = ''
): number[] | null {
    let bestFull: VariantMatch | null = null;
    let bestPartial: VariantMatch | null = null;
    const repeatedInTitle = repeatedTitleLiterals(title);

    for (const variant of variantsOf(formation)) {
        const match = matchVariant(words, variant, repeatedInTitle);
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
