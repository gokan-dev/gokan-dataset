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
 * A formation is more than its literals: its SLOTS carry meaning too. Each rule
 * therefore also records what the formation requires around its literals:
 * - a LEADING slot ("Verb-casual + から", "Sentence A + しかし"): something must
 *   precede the marker, and when the slot names a part of speech, the token
 *   right before it must be one. Without this, a sentence-initial しかし (its A
 *   clause lives in a sentence we do not show) and the adverb 後で ("later")
 *   both passed as `Verb-た + あとで`.
 * - an INTERIOR slot between two literal groups ("Noun1 + を + Noun2 + として"):
 *   content must sit between them, and every group, 1-char particles included,
 *   must match in order. Dropping を let a bare として match inside しようとしている.
 * - a TRAILING slot ("+ Sentence B", or a title ending in ～): a clause must
 *   follow in the same sentence, which rejects sentence-final …んだから。
 * Every variant of a formation ("Verb-casual + から / … / Noun + だから") compiles
 * to its own rule. Keeping only the longest literal silently mined the rare
 * form (だから) and never the common one (plain から) for 178 points.
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

/**
 * What a slot requires. `any` means "some content", with no part of speech
 * (Sentence A, Clause, Phrase...); the others constrain the adjacent token.
 *
 * Only two verb FORMS are distinguished, because only they are both written
 * reliably in the formations and discriminating: て-form (`Verb-て form + まで`
 * is not 帰るまで, "until") and volitional (行こうにも, not あるにも). Every other
 * form reads as a plain verb: the formation texts describe those loosely
 * ("Verb-ない form (drop ない) + ざるを得ない" is really the 未然形), and treating
 * them literally threw away whole correct pools.
 */
export type SlotKind = 'any' | 'noun' | 'iAdjective' | 'naAdjective' | 'adjective' | 'verb' | 'teForm' | 'volitional';

const VERB_SLOTS = new Set<SlotKind>(['verb', 'teForm', 'volitional']);
const ADJECTIVE_SLOTS = new Set<SlotKind>(['iAdjective', 'naAdjective', 'adjective']);
/** A slot that pins the word before the marker to a verb or adjective (what makes a 2-char marker precise). */
export const isPredicateSlot = (kind: SlotKind | null) => !!kind && (VERB_SLOTS.has(kind) || ADJECTIVE_SLOTS.has(kind));

export interface MiningRule {
    /** Ordered elements. Adjacency is required WITHIN an element; BETWEEN elements, see `interior`. */
    elements: Element[];
    /** The most distinctive literal/aux in the rule, used only for a cheap pre-filter (sentence must include it). */
    anchor: string;
    /** Slot before the first element, or null when the formation starts with the marker itself. */
    leading: SlotKind | null;
    /** Whether a clause must follow the last element in the same sentence. */
    trailing: boolean;
}

const kataToHira = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** te/で as a connective particle (接続助詞) - NOT the copula で (助動詞) nor 格助詞 から's source. */
const isTeConnective = (t: MorphToken) => t.pos === '助詞' && t.posDetail1 === '接続助詞' && (t.surface === 'て' || t.surface === 'で');

/** Punctuation and whitespace carry no content. */
const isPunct = (t: MorphToken) => t.pos === '記号';
/** A sentence terminator: the boundary a trailing slot must not cross. */
const isTerminator = (t: MorphToken) => /^[。！？!?.．]+$/.test(t.surface);
/** Content a slot can be filled with: not punctuation, not a sentence-final particle (ね / な / よ). */
const isContent = (t: MorphToken) => !isPunct(t) && !(t.pos === '助詞' && t.posDetail1 === '終助詞');

/** Verb-like auxiliaries a verb slot may end in (食べ[た], 行か[ない], 来[ます]); NOT the copula だ/です. */
const VERB_AUX_BASES = new Set(['た', 'ない', 'ぬ', 'ん', 'ます', 'れる', 'られる', 'せる', 'させる', 'たい', 'う', 'よう', 'まい', 'たがる']);

/** Does the token right before a marker fill a slot of this kind? */
function fillsSlot(t: MorphToken, kind: SlotKind): boolean {
    const verbLike = t.pos === '動詞' || (t.pos === '助動詞' && VERB_AUX_BASES.has(t.base));
    switch (kind) {
        case 'any': return isContent(t);
        // A plain verb slot does not end in て: that is the teForm slot, and
        // accepting it here let "Verb-ます stem + 上げる" match 貸して上げる.
        case 'verb': return verbLike;
        case 'teForm': return isTeConnective(t);
        case 'volitional': return t.pos === '助動詞' && ['う', 'よう', 'まい'].includes(t.base);
        case 'iAdjective':
            return t.pos === '形容詞' || (t.pos === '助動詞' && (t.base === 'ない' || t.base === 'たい'));
        case 'naAdjective':
            return t.pos === '名詞'; // 形容動詞語幹 is tagged 名詞
        case 'adjective':
            return fillsSlot(t, 'iAdjective') || fillsSlot(t, 'naAdjective');
        case 'noun':
            return t.pos === '名詞';
    }
}

/**
 * Matches one element exactly at token `i`, returning the index just past the
 * matched span (or -1), and whether the match was a suffix glued onto a longer
 * token (早[かれ]) - in which case the leading slot is filled by that same token.
 */
function matchElementAt(tokens: MorphToken[], element: Element, i: number): { end: number; glued: boolean } | null {
    switch (element.kind) {
        case 'teAux': {
            if (i + 2 >= tokens.length || tokens[i].pos !== '動詞' || !isTeConnective(tokens[i + 1])) return null;
            const aux = tokens[i + 2];
            return aux.posDetail1 === '非自立' && element.bases.includes(aux.base) ? { end: i + 3, glued: false } : null;
        }
        case 'teParticle':
            // The particle must sit IMMEDIATELY after て - a gap here is what let
            // てから match 彼から and ては match a stray は elsewhere in the sentence.
            if (i + 2 >= tokens.length || tokens[i].pos !== '動詞' || !isTeConnective(tokens[i + 1])) return null;
            return element.forms.includes(kataToHira(tokens[i + 2].surface)) ? { end: i + 3, glued: false } : null;
        case 'lit': {
            for (const raw of element.forms) {
                const form = kataToHira(raw);
                // exact contiguous multi-token join
                let join = '';
                for (let j = i; j < tokens.length && join.length < form.length; j++) {
                    join += kataToHira(tokens[j].surface);
                    if (join === form) return { end: j + 1, glued: false };
                    if (!form.startsWith(join)) break;
                }
                // or a >=2-char suffix of a single token (glued marker, e.g. てある fused)
                const surface = kataToHira(tokens[i].surface);
                if (form.length >= 2 && surface.length > form.length && surface.endsWith(form)) return { end: i + 1, glued: true };
            }
            return null;
        }
    }
}

/** Morphological elements encode their own leading verb; only literal rules check a leading slot. */
function leadingOk(tokens: MorphToken[], start: number, glued: boolean, rule: MiningRule): boolean {
    if (!rule.leading || rule.elements[0].kind !== 'lit') return true;
    // A glued match carries its slot inside the token (早[かれ]), so only its own
    // part of speech can be checked: a conjugating word, never an adverb or a
    // noun that merely ends in the marker (かなり, ことごとく, まちがい). And only
    // a CONJUGATED form: a word in its dictionary form that happens to end in
    // the marker is a different word (うまい is not う+まい, かわいい not か+いい).
    // A verb is further vetted against the curated examples (fitsMarkerLexicon).
    if (glued) {
        const t = tokens[start];
        return ['動詞', '形容詞', '助動詞'].includes(t.pos) && t.surface !== t.base;
    }
    if (rule.leading === 'any') return tokens.slice(0, start).some(isContent);
    return start > 0 && fillsSlot(tokens[start - 1], rule.leading);
}

function trailingOk(tokens: MorphToken[], end: number, rule: MiningRule): boolean {
    if (!rule.trailing) return true;
    for (let j = end; j < tokens.length; j++) {
        if (isTerminator(tokens[j])) return false;
        if (isContent(tokens[j])) return true;
    }
    return false;
}

/** An interior slot is content, not a whole paragraph: the second group must follow within this many tokens. */
const MAX_INTERIOR_GAP = 10;

/**
 * Where a rule matched: the first element's start token, the end of the last,
 * whether the first was glued, and each element's own token span (the tokens
 * BETWEEN elements are slot content, not marker).
 */
export interface RuleMatch { start: number; end: number; glued: boolean; spans: [number, number][] }

/**
 * surface -> the tags that morpheme carries inside a marker, learned from a
 * point's CURATED examples. Comparing a mined marker against it is what rejects
 * a homograph: the verb やら (やる) for the particle, もの+の in 甘いものの量.
 */
export interface MarkerLexicon {
    /** morpheme surface -> the tags it carries inside a curated marker */
    tags: Map<string, Set<string>>;
    /** each curated marker's token surfaces, in order */
    markers: string[][];
}

export const emptyMarkerLexicon = (): MarkerLexicon => ({ tags: new Map(), markers: [] });

/**
 * The main part of speech, plus the sub-tag for particles only. A content
 * word's sub-tag varies with context (あまり is 副詞可能 or 一般), and 3-5
 * curated examples cannot cover every variant. A particle's sub-tag is the
 * distinction itself: conjunctive と (であろうと、…) vs quotative と
 * (であろうとは思わなかった).
 */
const tagOf = (t: MorphToken) => (t.pos === '助詞' ? `${t.pos}|${t.posDetail1}` : t.pos);
const markerTokens = (tokens: MorphToken[], match: RuleMatch) => match.spans.flatMap(([a, b]) => tokens.slice(a, b));

/** Does `morpheme` occur in this token sequence cut across a token boundary? */
function cutAcrossTokens(surfaces: string[], morpheme: string): boolean {
    const boundaries: number[] = [];
    let offset = 0;
    for (const s of surfaces.slice(0, -1)) { offset += s.length; boundaries.push(offset); }
    const text = surfaces.join('');
    for (let at = text.indexOf(morpheme); at >= 0; at = text.indexOf(morpheme, at + 1)) {
        if (boundaries.some(b => b > at && b < at + morpheme.length)) return true;
    }
    return false;
}

/** Records how the marker's morphemes are tokenized and tagged in one curated match. */
export function learnMarker(lexicon: MarkerLexicon, tokens: MorphToken[], match: RuleMatch): void {
    const marker = markerTokens(tokens, match);
    for (const t of marker) {
        const key = kataToHira(t.surface);
        if (!lexicon.tags.has(key)) lexicon.tags.set(key, new Set());
        lexicon.tags.get(key)!.add(tagOf(t));
    }
    lexicon.markers.push(marker.map(t => kataToHira(t.surface)));
}

/**
 * Is a mined marker tokenized and tagged the way the point's curated examples
 * tag it? Rejects:
 * - a known morpheme carrying a different tag (the verb やら vs the particle);
 * - a morpheme cut across tokens here that no curated example ever cuts
 *   (率直なものの言い方 is な+もの+の, not the concessive ものの). The curated
 *   examples are not self-consistent (それとも is both one token and それ+と+も),
 *   so only a cut they never make counts;
 * - a match glued onto a verb (見かけ, 出かけ) unless curated examples glue it too.
 * An empty lexicon (no curated example matched any variant) accepts everything.
 */
export function fitsMarkerLexicon(lexicon: MarkerLexicon, tokens: MorphToken[], match: RuleMatch): boolean {
    if (lexicon.tags.size === 0) return true;
    const marker = markerTokens(tokens, match);
    for (const t of marker) {
        const tags = lexicon.tags.get(kataToHira(t.surface));
        if (tags && !tags.has(tagOf(t))) return false;
    }
    const surfaces = marker.map(t => kataToHira(t.surface));
    for (const morpheme of lexicon.tags.keys()) {
        if (morpheme.length < 2 || !cutAcrossTokens(surfaces, morpheme)) continue;
        if (!lexicon.markers.some(m => cutAcrossTokens(m, morpheme))) return false;
    }
    if (match.glued && tokens[match.start].pos === '動詞') {
        const tags = lexicon.tags.get(kataToHira(tokens[match.start].surface));
        if (!tags || !tags.has(tagOf(tokens[match.start]))) return false;
    }
    return true;
}

/**
 * Finds the rule in the token stream with its slots filled: tried at every
 * start position, since the first occurrence of a marker (a sentence-initial
 * しかし) may fail its slots while a later one passes. `accept` can veto a
 * candidate occurrence (the build script's curated-signature check).
 */
export function findMatch(tokens: MorphToken[], rule: MiningRule, accept?: (m: RuleMatch) => boolean): RuleMatch | null {
    for (let start = 0; start < tokens.length; start++) {
        const first = matchElementAt(tokens, rule.elements[0], start);
        if (!first || !leadingOk(tokens, start, first.glued, rule)) continue;
        let cursor = first.end;
        const spans: [number, number][] = [[start, first.end]];
        let ok = true;
        for (const element of rule.elements.slice(1)) {
            // Groups are only ever split by a slot, so each later group needs
            // content between it and the previous one - or the slot is glued
            // into the matched token itself (早かれ遅[かれ]).
            let next: number | null = null;
            for (let j = cursor; j <= cursor + MAX_INTERIOR_GAP && j < tokens.length; j++) {
                const m = matchElementAt(tokens, element, j);
                if (!m) continue;
                if (m.glued || tokens.slice(cursor, j).some(isContent)) { next = m.end; spans.push([j, m.end]); break; }
            }
            if (next === null) { ok = false; break; }
            cursor = next;
        }
        if (!ok || !trailingOk(tokens, cursor, rule)) continue;
        const match = { start, end: cursor, glued: first.glued, spans };
        if (!accept || accept(match)) return match;
    }
    return null;
}

/** True if the rule occurs in the token stream with its slots filled (see findMatch). */
export function matchRule(tokens: MorphToken[], rule: MiningRule): boolean {
    return findMatch(tokens, rule) !== null;
}

// ---- Formation -> rule compiler -------------------------------------------

/** te-auxiliary surface (as written in `formation`) -> its dictionary base. */
const TE_AUX_BASE: Record<string, string> = {
    'ある': 'ある', 'いる': 'いる', 'います': 'いる', 'いく': 'いく', 'くる': 'くる',
    'おく': 'おく', 'しまう': 'しまう', 'みる': 'みる', 'ください': 'くださる', 'くださる': 'くださる',
};
/** te-form + particle tails whose literal alone over-matches (てから vs 駅から). */
const TE_PARTICLE_TAILS = new Set(['から', 'は', 'も']);

/**
 * A parenthetical standing alone between `+` signs IS a slot ("こそ + (statement) +
 * が"); anything else in parentheses is a note ("(less common)"). Erasing the
 * former glued its neighbours into one literal (こそが).
 */
const stripParentheticals = (s: string) => s
    // "い-Adjective(～かろう) + が": a ～-hint names the literal the slot ENDS in,
    // which belongs to the next group (かろうが), not a bare が.
    .replace(/[(（]\s*[～〜]\s*([぀-ゟ゠-ヿ]+)\s*[)）]\s*\+\s*/g, ' + $1')
    .replace(/\+\s*[(（][^)）]*[)）]\s*(?=\+|$)/g, '+ SLOT ')
    .replace(/[(（][^)）]*[)）]/g, ' ');
/**
 * Replaces slot scaffolding written in Japanese (ます stem, て form, い-Adjective,
 * 語幹...) with a tagged lettered placeholder, so it reads as part of a SLOT
 * rather than as a literal, and keeps which verb form the slot names. Replacing
 * it with a space (the previous behaviour) erased the slot entirely:
 * "い-Adjective + から" looked like a bare から.
 */
const markScaffold = (s: string) => s
    .replace(/い[-ー]?adjective/gi, ' IADJ ')
    .replace(/な[-ー]?adjective/gi, ' NAADJ ')
    .replace(/(?:う|よう)\s*[-ー]?\s*(?:stem|form)|意向形|volitional/gi, ' VOLITIONAL ')
    .replace(/て\s*[-ー]?\s*(?:form|形)|\bte[- ]?form/gi, ' TEFORM ')
    // A conditional form label names a morpheme that IS part of the construction
    // ("Verb-ば form + ～のに" needs its ば), so it stays a literal.
    .replace(/(ば|たら|なら)\s*[-ー]?\s*(?:form|形)/g, ' $1 ')
    // Any other form or stem written in kana (ず form, ます stem, ない form) is a verb slot.
    .replace(/[ぁ-ゖ]+\s*[-ー]?\s*(?:stem|form)/gi, ' VERBFORM ')
    .replace(/[ぁ-ゖ]*(?:形|語幹|連用形|連体形|辞書形|終止形|未然形|可能形|受身形|使役形)/g, ' VERBFORM ');

/**
 * Splits a formation into variants. Only a SPACED slash separates variants
 * ("Verb-casual + から / Noun + だから"); an unspaced one is an alternation inside
 * a slot ("Noun/Verb casual") or a literal ("も/ほかのこと"), and splitting on it
 * produced fragments like a bare だの that matched 選んだの.
 */
function variantsOf(formation: string): string[] {
    const parts = stripParentheticals(formation)
        .split(/,|\n|\s\/\s| or |❶|❷|❸/i).map(s => s.trim()).filter(Boolean);
    const variants: string[] = [];
    let pendingSlot = '';
    let lastLeading = '';
    for (const part of parts) {
        if (!JP_CLASS.test(part)) { pendingSlot += `${part} | `; continue; } // "Noun / Verb + X": a slot alternative
        let variant = pendingSlot + part;
        pendingSlot = '';
        // "Noun + を皮切りに / を皮切りにして": a bare continuation reuses the previous slot.
        if (!/[a-z]/i.test(part) && lastLeading) variant = `${lastLeading} + ${part}`;
        const firstJp = variant.search(JP_CLASS);
        lastLeading = /[a-z]/i.test(variant.slice(0, firstJp)) ? variant.slice(0, firstJp).replace(/\+\s*$/, '').trim() : '';
        variants.push(variant);
    }
    return variants;
}

const JP_CLASS = /[぀-ゟ゠-ヿ一-鿿]/;

/** Reads a lettered slot's part of speech. Several different kinds ("Noun | Verb") are just content. */
function slotKind(text: string): SlotKind {
    // A punctuation mark or ～ between slot and marker means the slot is a whole
    // clause, not the adjacent word (…のか、それとも / Verb-ば + ～のに).
    if (/[？?。、！!～〜]/.test(text)) return 'any';
    const kinds = new Set<SlotKind>();
    const tags: [RegExp, SlotKind][] = [
        [/IADJ/, 'iAdjective'], [/NAADJ/, 'naAdjective'], [/VOLITIONAL/, 'volitional'], [/TEFORM/, 'teForm'],
    ];
    for (const [re, kind] of tags) if (re.test(text)) kinds.add(kind);
    const bare = text.replace(/[A-Z]{4,}/g, ' ');
    if (kinds.size === 0 && /verb|VERBFORM/i.test(text)) kinds.add('verb');
    if (/adjective/i.test(bare) && ![...kinds].some(k => ADJECTIVE_SLOTS.has(k))) kinds.add('adjective');
    if (/noun|number|counter/i.test(bare)) kinds.add('noun');
    if (kinds.size === 1) return [...kinds][0];
    if (kinds.size > 1 && [...kinds].every(k => VERB_SLOTS.has(k))) return 'verb';
    if (kinds.size > 1 && [...kinds].every(k => ADJECTIVE_SLOTS.has(k))) return 'adjective';
    return 'any';
}

/**
 * A variant's literal groups (split where a lettered slot sits), each a list of
 * alternative forms, and its leading / trailing slots.
 *
 * An unspaced alternation ("に + する/なる") covers the piece after the last `+`,
 * and expands into one form per alternative (にする, になる). A 1-char
 * alternative beside longer ones is dropped: な/である一方 must not become a
 * bare な, which would match every な-adjective in the corpus.
 */
export function variantShape(variant: string): { groups: string[][]; leading: SlotKind | null; trailing: boolean } {
    const groups: string[][] = [];
    let base: string[] = [''];   // forms of the current group before its current piece
    let piece: string[] = [''];  // alternatives of the current piece (after the last "+")
    let leadingText = '';
    let trailing = false;
    const closePiece = () => {
        const alts = piece.some(a => a.length >= 2) ? piece.filter(a => a.length >= 2) : piece;
        base = base.flatMap(b => alts.map(a => b + a));
        piece = [''];
    };
    const closeGroup = () => {
        closePiece();
        const forms = [...new Set(base)].filter(Boolean);
        if (forms.length > 0) groups.push(forms);
        base = [''];
    };
    for (const seg of markScaffold(variant).match(/([぀-ゟ゠-ヿ一-鿿]+)|([^぀-ゟ゠-ヿ一-鿿]+)/g) ?? []) {
        if (JP_CLASS.test(seg[0])) { piece[piece.length - 1] += kataToHira(seg); trailing = false; continue; }
        // "etc." / "e.g." are prose, not a slot.
        if (!/[a-z]/i.test(seg.replace(/\b(?:etc|e\.g|i\.e)\b\.?/gi, ''))) {
            // "～" is content between literals ("ば + ～のに"), exactly like a lettered slot.
            if (/[～〜]/.test(seg)) {
                closeGroup();
                if (groups.length === 0) leadingText += seg;
                else trailing = true;
                continue;
            }
            if (seg.includes('+')) closePiece();
            if (seg.includes('/') && piece[piece.length - 1]) piece.push('');
            continue;
        }
        closeGroup();
        if (groups.length === 0) leadingText += seg;
        else trailing = true;
    }
    closeGroup();
    return { groups, leading: /[a-z～〜]/i.test(leadingText) ? slotKind(leadingText) : null, trailing };
}

/** Does this variant declare a て-form verb slot? (Verb-て form / Verb て-form / Verb-て形 / causative-て) */
const hasTeForm = (variant: string) => /(?:て|de)\s*[-ー]?\s*(?:form|形)/i.test(variant) || /causative\s*form.*ください/i.test(variant);

/** A title ending in ～ (～から、～ / A。しかし、～B。) declares a following clause the formation text often omits. */
const titleRequiresTrailing = (title: string) => /[～〜][A-ZＡ-Ｚ]?[。.]?\s*$/.test(title.trim());

/** Every combination of one form per group (にする / になる). */
const combinations = (groups: string[][]): string[][] =>
    groups.reduce<string[][]>((acc, forms) => acc.flatMap(c => forms.map(f => [...c, f])), [[]]);

/**
 * Compiles one variant, choosing morphology where a literal would over-match.
 * An alternation yields one rule per combination, so each rule keeps a single
 * anchor that every sentence it matches must contain (the scan's pre-filter).
 */
function compileVariant(variant: string, trailingFromTitle: boolean): MiningRule[] {
    const shape = variantShape(variant);
    const needsTrailing = shape.trailing || trailingFromTitle;
    return combinations(shape.groups).flatMap((groups): MiningRule[] => {
        const tail = groups[groups.length - 1];
        // te-auxiliary: Verb-て + 非自立 aux. The morphology guard makes the aux
        // list safe to key off directly; the element encodes its own leading verb.
        if (tail && TE_AUX_BASE[tail]) {
            return [{ elements: [{ kind: 'teAux', bases: [TE_AUX_BASE[tail]] }], anchor: tail, leading: null, trailing: needsTrailing }];
        }
        // te-form + over-matching particle (てから/ては/ても): the particle must sit
        // immediately after て, so this is one contiguous 3-token element.
        if (tail && TE_PARTICLE_TAILS.has(tail) && hasTeForm(variant)) {
            return [{ elements: [{ kind: 'teParticle', forms: [tail] }], anchor: tail, leading: null, trailing: needsTrailing }];
        }
        // literal fallback: every group, in order (1-char particles like を included,
        // as ordering constraints), anchored on the longest one.
        const distinctive = groups.filter(g => g.length >= 2);
        if (distinctive.length === 0) return [];
        return [{
            elements: groups.map(g => ({ kind: 'lit' as const, forms: [g] })),
            anchor: distinctive.slice().sort((a, b) => b.length - a.length)[0],
            leading: shape.leading,
            trailing: needsTrailing,
        }];
    });
}

/**
 * Compiles a point's `formation` into one mining rule per variant (deduplicated),
 * morphological rules first. A sentence uses the construction when it matches
 * ANY of them. Returns [] when no variant yields a distinctive (>=2-char) anchor.
 *
 * `title` contributes only one thing: whether a trailing clause is required
 * (see titleRequiresTrailing). Merging its literals in was a net negative: it
 * added a ること variant to n5-057 (title "Verb ること～") that outranked the
 * real こと anchor by length and then almost never matched.
 */
export function compileFormation(formation: string, title = ''): MiningRule[] {
    const trailingFromTitle = titleRequiresTrailing(title);
    const rules = new Map<string, MiningRule>();
    for (const variant of variantsOf(formation)) {
        for (const rule of compileVariant(variant, trailingFromTitle)) rules.set(JSON.stringify(rule), rule);
    }
    return [...rules.values()].sort((a, b) => {
        const am = a.elements.some(e => e.kind !== 'lit') ? 1 : 0;
        const bm = b.elements.some(e => e.kind !== 'lit') ? 1 : 0;
        return bm - am || b.anchor.length - a.anchor.length;
    });
}

// ---- Post-location checks on a finished example ------------------------------

/** Minimal word shape shared with GrammarExample, so these checks stay dependency-free. */
export interface LocatedExample {
    jp: string;
    words: { surface: string }[];
    patternWordIndices: number[];
}

const PUNCT_SURFACE = /^[\s。、，,．.！!？?「」『』（）()…・]+$/;
const TERMINATOR_SURFACE = /[。！？!?]/;
/** Longest mined example kept: curated examples top out near 80 chars (99% are under 40). */
export const MAX_MINED_LENGTH = 60;
/** At most two sentences: a connective like しかし needs `A。しかし B。`, but a whole paragraph is not an example. */
export const MAX_MINED_SENTENCES = 2;

/**
 * Checks the BLANK placed by `locatePattern` against the rule that matched: the
 * miner and the locator run separately, so the locator can pick a different
 * occurrence (the sentence-initial だから rather than the mid-sentence one).
 */
export function blankFitsRule(example: LocatedExample, rule: MiningRule): boolean {
    const p = [...example.patternWordIndices].sort((a, b) => a - b);
    if (p.length === 0) return false;
    const content = (i: number) => !PUNCT_SURFACE.test(example.words[i].surface);
    const first = rule.elements[0];
    if (rule.leading && first.kind === 'lit') {
        // A merged word longer than the marker carries its own slot (早かろうが).
        const slotInsideWord = example.words[p[0]].surface.length > Math.min(...first.forms.map(f => f.length));
        const before = example.words.slice(0, p[0]).some((_, i) => content(i));
        if (!before && !slotInsideWord) return false;
    }
    if (rule.trailing) {
        let found = false;
        for (let j = p[p.length - 1] + 1; j < example.words.length; j++) {
            if (TERMINATOR_SURFACE.test(example.words[j].surface)) break;
            if (content(j) && !/^[ねなよわぞさ]$/.test(example.words[j].surface)) { found = true; break; }
        }
        if (!found) return false;
    }
    return true;
}

/** The blanked marker (each contiguous run of pattern words) also appears unblanked, which gives the answer away. */
export function leaksAnswer(example: LocatedExample): boolean {
    const p = [...example.patternWordIndices].sort((a, b) => a - b);
    const blanked = new Set(p);
    const runs: string[] = [];
    let cur = '';
    p.forEach((w, k) => {
        cur = k > 0 && w === p[k - 1] + 1 ? cur + example.words[w].surface : example.words[w].surface;
        if (k === p.length - 1 || p[k + 1] !== w + 1) runs.push(cur);
    });
    const unblanked = example.words.map((w, i) => (blanked.has(i) ? '\u0000' : w.surface)).join('');
    return runs.some(r => r.length >= 2 && unblanked.includes(r));
}

/** Short and at most two sentences: a readable example, not a transcript. */
export function isExampleSized(jp: string): boolean {
    if (jp.length > MAX_MINED_LENGTH) return false;
    const sentences = jp.split(/[。！？!?]+/).filter(s => s.trim().length > 0);
    return sentences.length <= MAX_MINED_SENTENCES;
}
