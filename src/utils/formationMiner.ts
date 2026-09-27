/**
 * Morphology-aware grammar-formation miner (gokan-srs#73).
 *
 * Decides whether an ARBITRARY corpus sentence actually uses a grammar point's
 * construction - a different job from `scripts/grammar-pattern-matcher.ts`'s
 * `locatePattern`, which locates the pattern in a sentence already KNOWN to
 * contain it (its precision over unrelated text was never a concern). Over
 * 227k arbitrary sentences, precision is everything: a purely literal matcher
 * floods (てある's ある matches である/がある; てから's から matches 駅から).
 *
 * The fix is morphology. One matcher engine walks an ordered `Element[]` rule
 * where an element is either a plain surface LITERAL (the degenerate case, =
 * the old structural matcher) or a MORPHOLOGICAL constraint expressed over
 * kuromoji's POS / conjugation-form / dependency (自立 vs 非自立) / base-form
 * tags. The te-auxiliary family is the motivating class: it is precisely
 * "a 非自立 verb (base = the aux) preceded by a 接続助詞 て/で preceded by a 動詞",
 * which no literal string can express but these tags pin down exactly.
 *
 * Pure and dependency-free: it consumes already-tokenized `MorphToken[]`, so the
 * kuromoji dependency stays in the build script, and the rules/matcher are unit
 * testable without a tokenizer.
 */

/** The subset of kuromoji's IpadicFeatures the miner reads, renamed for clarity. */
export interface MorphToken {
    surface: string;
    /** part of speech, e.g. 動詞 / 名詞 / 形容詞 / 助詞 / 助動詞 */
    pos: string;
    /** first POS sub-category, e.g. 接続助詞 / 格助詞 / 自立 / 非自立 */
    posDetail1: string;
    /** conjugation form, e.g. 連用タ接続 / 連用形 / 命令ｅ */
    conj: string;
    /** dictionary/base form, e.g. 置く for 置い, ある for ある */
    base: string;
}

/** Adapts a raw kuromoji token (any shape with the ipadic fields) into a MorphToken. */
export function toMorphToken(t: {
    surface_form: string; pos: string; pos_detail_1: string; conjugated_form: string; basic_form: string;
}): MorphToken {
    return { surface: t.surface_form, pos: t.pos, posDetail1: t.pos_detail_1, conj: t.conjugated_form, base: t.basic_form };
}

export type Element =
    /** A contiguous surface literal: any of `forms` as an exact multi-token join, or a >=2-char suffix of one token (a glued marker). */
    | { kind: 'lit'; forms: string[] }
    /** A te-auxiliary: [動詞][て|で 接続助詞][非自立 verb, base ∈ `bases`]. Spans 3 tokens. Rejects である/がある. */
    | { kind: 'teAux'; bases: string[] }
    /** A te-form + immediately-following particle: [動詞][て|で 接続助詞][surface ∈ `forms`]. Spans 3 CONTIGUOUS tokens. Rejects 駅から / それでも. */
    | { kind: 'teParticle'; forms: string[] };

export interface MiningRule {
    /** Ordered elements. Adjacency is required WITHIN a `lit`/`te`/`teAux` span; gaps are allowed BETWEEN elements. */
    elements: Element[];
    /** The most distinctive literal/aux in the rule, used only for a cheap pre-filter (sentence must include it). */
    anchor: string;
}

const kataToHira = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** te/で as a connective particle (接続助詞) - NOT the copula で (助動詞) nor 格助詞 から's source. */
const isTeConnective = (t: MorphToken) => t.pos === '助詞' && t.posDetail1 === '接続助詞' && (t.surface === 'て' || t.surface === 'で');

/**
 * Tries to match one element starting at or after `from`, returning the index
 * just past the matched span, or -1. Gaps before the element are allowed (the
 * scan walks forward), so callers thread the returned cursor into the next call.
 */
function matchElementFrom(tokens: MorphToken[], element: Element, from: number): number {
    switch (element.kind) {
        case 'teAux':
            for (let i = from; i + 2 < tokens.length; i++) {
                if (tokens[i].pos !== '動詞') continue;
                if (!isTeConnective(tokens[i + 1])) continue;
                const aux = tokens[i + 2];
                if (aux.posDetail1 === '非自立' && element.bases.includes(aux.base)) return i + 3;
            }
            return -1;
        case 'teParticle':
            for (let i = from; i + 2 < tokens.length; i++) {
                if (tokens[i].pos !== '動詞') continue;
                if (!isTeConnective(tokens[i + 1])) continue;
                // The particle must sit IMMEDIATELY after て - a gap here is what let
                // てから match 彼から and ては match a stray は elsewhere in the sentence.
                if (element.forms.includes(kataToHira(tokens[i + 2].surface))) return i + 3;
            }
            return -1;
        case 'lit': {
            for (let i = from; i < tokens.length; i++) {
                for (const form of element.forms) {
                    // exact contiguous multi-token join
                    let join = '';
                    for (let j = i; j < tokens.length && join.length < form.length; j++) {
                        join += kataToHira(tokens[j].surface);
                        if (join === kataToHira(form)) return j + 1;
                        if (!kataToHira(form).startsWith(join)) break;
                    }
                    // or a >=2-char suffix of a single token (glued marker, e.g. てある fused)
                    if (form.length >= 2 && kataToHira(tokens[i].surface).endsWith(kataToHira(form))) return i + 1;
                }
            }
            return -1;
        }
    }
}

/** True if the ordered rule occurs in the token stream (adjacency within each element, gaps between). */
export function matchRule(tokens: MorphToken[], rule: MiningRule): boolean {
    let cursor = 0;
    for (const element of rule.elements) {
        const next = matchElementFrom(tokens, element, cursor);
        if (next < 0) return false;
        cursor = next;
    }
    return true;
}

// ---- Formation -> rule compiler -------------------------------------------

/** te-auxiliary surface (as written in `formation`) -> its dictionary base. */
const TE_AUX_BASE: Record<string, string> = {
    'ある': 'ある', 'いる': 'いる', 'います': 'いる', 'いく': 'いく', 'くる': 'くる',
    'おく': 'おく', 'しまう': 'しまう', 'みる': 'みる', 'ください': 'くださる', 'くださる': 'くださる',
};
/** te-form + particle tails whose literal alone over-matches (てから vs 駅から). */
const TE_PARTICLE_TAILS = new Set(['から', 'は', 'も']);

const stripParentheticals = (s: string) => s.replace(/\([^)]*\)/g, ' ');
const stripScaffold = (s: string) => s
    .replace(/[ぁ-ゖ]*(?:ます|ない|た|て|だ|で)\s*[-ー]?\s*(?:stem|form)/gi, ' ')
    .replace(/(?:い|な)[-ー]?adjective/gi, ' ')
    .replace(/[ぁ-ゖ]*(?:形|語幹|連用形|連体形|辞書形|終止形|未然形|意向形|可能形|受身形|使役形)/g, ' ');
const variantsOf = (formation: string) => stripParentheticals(formation)
    .split(/,|\n|\/| or |❶|❷|❸/i).map(s => s.trim()).filter(Boolean);

const JP_CLASS = /[぀-ゟ゠-ヿ一-鿿]/;
/** Contiguous kana/kanji literal groups of one variant, split where a latin-lettered slot sits. */
function literalGroups(variant: string): string[] {
    const groups: string[] = []; let cur = '';
    for (const seg of stripScaffold(variant).match(/([぀-ゟ゠-ヿ一-鿿]+)|([^぀-ゟ゠-ヿ一-鿿]+)/g) ?? []) {
        if (JP_CLASS.test(seg[0])) { cur += kataToHira(seg); continue; }
        if (/[a-z]/i.test(seg)) { if (cur) { groups.push(cur); cur = ''; } }
    }
    if (cur) groups.push(cur);
    return groups;
}

/** Does this variant declare a て-form verb slot? (Verb-て form / Verb て-form / Verb-て形 / causative-て) */
const hasTeForm = (variant: string) => /(?:て|de)\s*[-ー]?\s*(?:form|形)/i.test(variant) || /causative\s*form.*ください/i.test(variant);

/**
 * Compiles a point's `formation` into a mining rule, choosing morphology where a
 * literal would over-match and falling back to literal-contiguous otherwise.
 * Returns null when no variant yields a distinctive (>=2-char) anchor.
 */
export function compileFormation(formation: string, title = ''): MiningRule | null {
    void title; // reserved; deliberately NOT merged into candidates - see note below
    const candidates: MiningRule[] = [];
    // Only `formation` drives compilation. Merging `title` in was a net negative:
    // it added a ること variant to n5-057 (title "Verb ること～") that outranked the
    // real こと anchor by length and then almost never matched (dictionary-form る
    // is fused into the verb token). The repeated-literal cases title used to help
    // with (かれ) are already spelled out twice in `formation` itself.
    for (const variant of variantsOf(formation)) {
        const groups = literalGroups(variant);
        const tail = groups[groups.length - 1];

        // te-auxiliary: Verb-て + 非自立 aux. The morphology guard makes the aux
        // list safe to key off directly.
        if (tail && TE_AUX_BASE[tail]) {
            candidates.push({ elements: [{ kind: 'teAux', bases: [TE_AUX_BASE[tail]] }], anchor: tail });
            continue;
        }
        // te-form + over-matching particle (てから/ては/ても): the particle must sit
        // immediately after て, so this is one contiguous 3-token element.
        if (tail && TE_PARTICLE_TAILS.has(tail) && hasTeForm(variant)) {
            candidates.push({ elements: [{ kind: 'teParticle', forms: [tail] }], anchor: tail });
            continue;
        }
        // literal-contiguous fallback (distinctive idioms): ordered groups, each contiguous.
        const distinctive = groups.filter(g => g.length >= 2);
        if (distinctive.length === 0) continue;
        const elements: Element[] = groups
            .filter(g => g.length >= 2)
            .map(g => ({ kind: 'lit', forms: [g] }));
        const anchor = distinctive.slice().sort((a, b) => b.length - a.length)[0];
        candidates.push({ elements, anchor });
    }
    if (candidates.length === 0) return null;
    // Prefer a morphological rule, then the longest anchor (most distinctive).
    candidates.sort((a, b) => {
        const am = a.elements.some(e => e.kind !== 'lit') ? 1 : 0;
        const bm = b.elements.some(e => e.kind !== 'lit') ? 1 : 0;
        return bm - am || b.anchor.length - a.anchor.length;
    });
    return candidates[0];
}
