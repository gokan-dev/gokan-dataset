import type { IpadicFeatures } from 'kuromoji';

/**
 * A word's common patterns (gokan-srs#177): the frequent forms it takes in our own sentences
 * (不思議に思う, 気がする, 年を取る), counted at build time from kuromoji's tokens, with no model.
 *
 * A pattern is the word with what follows it, up to three tokens (a particle, the copula, ない,
 * then a verb ends it), or, for a verb, the word and particle before it (年を取る): what follows a
 * verb is its own inflection, and what a learner needs is which nouns it takes. An inflected token
 * counts in its dictionary form (思った as 思う, 不思議だった as 不思議だ, です as だ), so one
 * pattern is one entry however the sentences conjugate it; a verb keeps its causative and passive,
 * which make another verb (目を輝かせた is 目を輝かせる, never 目を輝く).
 *
 * Two rules drop what the page already says: a word followed only by する (描写する: Meanings
 * says it is a する noun) is no pattern, and に and へ before 行く or 来る are one pattern
 * (学校に行く), written with the particle most of its sentences use.
 *
 * Words are kept as ids until the pattern is written (patternText), so a pattern names each word
 * by its headword, kana for a word learned in kana, decided after the sentences are scanned.
 */

/**
 * A verb derived into another by a causative or passive (輝か|せる), as the pattern writes it: its
 * headword's ending `basicTail` (く) becomes `tail` (かせる), or, for a headword that does not
 * end so, the sentence's own spelling `written` (輝かせる).
 */
export interface Derived {
    basicTail: string;
    tail: string;
    written: string;
}

/**
 * A word, named by its headword when the pattern is written (`ku`: its adverbial く form, 早く;
 * `derived`: its causative or passive, 輝かせる), or a literal.
 */
export type PatternPart = { id: string; ku?: true; derived?: Derived } | string;

/**
 * How a word's patterns are read: a verb by what comes before it, an i-adjective from its く form,
 * a na-adjective also by its copula (不思議な〜, 不思議だ: for a noun, 人だ says nothing).
 */
export type PatternKind = 'verb' | 'i-adjective' | 'na-adjective' | 'other';

/** Where a word occurs in a sentence (an accepted match). */
export interface Occurrence {
    id: string;
    start: number;
    length: number;
}

export const PATTERN_LIMITS = {
    /** A pattern is kept when this many of the word's sentences use it... */
    minSentences: 3,
    /** ...and at least this share of them (tuned on 不思議, 取る, 気 and 手: MODIFICATION_LOG). */
    minShare: 0.02,
    /** At most this many patterns a word, the most frequent first. */
    max: 5,
} as const;

/** JMdict's verb classes; vs alone is a noun taking する (勉強), whose patterns follow it. */
const VERB_POS = /^(v1|v2|v4|v5|vk|vn|vr|vs-i|vs-s|vz)/;

export function patternKind(pos: readonly string[]): PatternKind {
    if (pos.some(p => VERB_POS.test(p))) return 'verb';
    if (pos.includes('adj-i') || pos.includes('adj-ix')) return 'i-adjective';
    if (pos.includes('adj-na')) return 'na-adjective';
    return 'other';
}

/** Verbs that can follow a word directly (勉強する, 静かになる); after a particle any verb can (気を失う). */
const LIGHT_VERBS = new Set(['する', 'なる', 'ある', 'いる', 'できる', '思う', '言う', '見える', '感じる']);
/** Auxiliaries that only inflect what comes before them (past, polite, volitional): folded into its dictionary form. */
const INFLECTING = new Set(['た', 'ます', 'う']);
const MAX_FOLLOWING = 3;
/** Auxiliary verbs that derive another verb (causative, passive): kept in a verb's pattern. */
const DERIVING = new Set(['せる', 'させる', 'れる', 'られる']);
/** Before these, に and へ say the same (学校に行く, 学校へ行く): one pattern. */
const GO_COME = new Set(['行く', '来る', 'いく', 'くる']);

const startOf = (t: IpadicFeatures): number => t.word_position - 1;
const isParticle = (t: IpadicFeatures): boolean => t.pos === '助詞' && t.pos_detail_1 !== '終助詞';
const isNai = (t: IpadicFeatures): boolean => t.basic_form === 'ない' && (t.pos === '助動詞' || t.pos === '形容詞');
const isCopula = (t: IpadicFeatures): boolean => t.pos === '助動詞' && (t.basic_form === 'だ' || t.basic_form === 'です');

function allowed(t: IpadicFeatures, position: number): boolean {
    if (isParticle(t) || t.pos === '助動詞' || isNai(t)) return true;
    if (t.pos === '動詞') return position === 0 ? LIGHT_VERBS.has(t.basic_form) : t.pos_detail_1 === '自立';
    return false;
}

/** A following token as the pattern writes it: a verb by its word (or dictionary form), the copula as だ, な〜 or で. */
function partOf(t: IpadicFeatures, spans: readonly Occurrence[], self: string): PatternPart {
    if (t.pos === '動詞') {
        const word = spans.find(s => s.id !== self && s.start === startOf(t));
        return word ? { id: word.id } : t.basic_form;
    }
    if (isNai(t)) return 'ない';
    if (isCopula(t)) {
        if (t.surface_form === 'な') return 'な〜';
        if (t.surface_form === 'で') return 'で';
        return 'だ';
    }
    if (t.pos === '助動詞') return t.conjugated_form.startsWith('連用タ') ? t.basic_form : t.surface_form;
    return t.surface_form;
}

/**
 * A pattern may end on a verb, ない, an adverbial particle (不思議に) or, for a na-adjective, the
 * copula alone (不思議だ, 不思議な〜): never on a bare は or を.
 */
function endsWell(t: IpadicFeatures, part: PatternPart, kind: PatternKind, position: number): boolean {
    if (t.pos === '動詞' || isNai(t)) return true;
    if (part === 'だ' || part === 'な〜') return kind === 'na-adjective' || position > 0;
    return t.pos === '助詞' && t.pos_detail_1 === '副詞化';
}

/** The causative and passive auxiliaries right after the verb at `i` (輝か|せ|られ). */
function derivingAfter(tokens: readonly IpadicFeatures[], i: number): IpadicFeatures[] {
    const found: IpadicFeatures[] = [];
    for (let k = i + 1; k < tokens.length; k++) {
        const t = tokens[k];
        if (t.pos !== '動詞' || t.pos_detail_1 !== '接尾' || !DERIVING.has(t.basic_form)) break;
        found.push(t);
    }
    return found;
}

/** The verb at `i` with its causative or passive, as a pattern writes it (輝か + せ → 輝かせる). */
function derivedOf(tokens: readonly IpadicFeatures[], i: number): Derived | undefined {
    const deriving = derivingAfter(tokens, i);
    if (deriving.length === 0) return undefined;
    const verb = tokens[i];
    let same = 0;
    while (same < verb.basic_form.length && verb.basic_form[same] === verb.surface_form[same]) same++;
    const ending = deriving.slice(0, -1).map(t => t.surface_form).join('') + deriving.at(-1)!.basic_form;
    return { basicTail: verb.basic_form.slice(same), tail: verb.surface_form.slice(same) + ending, written: verb.surface_form + ending };
}

/**
 * The last token of a word's occurrence (明け in 打ち明け, せ in 知らせ): what a causative or passive
 * follows, so a word that is itself one (知らせる) is not read as derived.
 */
function lastTokenOf(tokens: readonly IpadicFeatures[], at: Pick<Occurrence, 'start' | 'length'>): number {
    let last = -1;
    tokens.forEach((t, k) => { if (startOf(t) >= at.start && startOf(t) < at.start + at.length) last = k; });
    return last;
}

/**
 * How the verb at a word's occurrence is derived (せる, or せる+られる; '' when it is not), read from
 * the sentence's tokens: what the head of its pattern must say (headFormProblems).
 */
export function derivationAt(tokens: readonly IpadicFeatures[], at: Pick<Occurrence, 'start' | 'length'>): string {
    const last = lastTokenOf(tokens, at);
    return last < 0 ? '' : derivingAfter(tokens, last).map(t => t.basic_form).join('+');
}

/**
 * The patterns whose verb does not say how most of their sentences use it (目を輝く over sentences
 * of 目を輝かせる): a pattern written with the verb's headword (`headword`, its last part) says it
 * is not derived, any other says it is, compared with each sentence's (`derivationAt`). The build
 * fails on any.
 */
export function headFormProblems(patterns: readonly { text: string }[], heads: readonly { pattern: number; derivation: string }[], headword: string): string[] {
    return patterns.flatMap(({ text }, index) => {
        const derived = !text.endsWith(headword);
        const held = heads.filter(h => h.pattern === index);
        const other = held.filter(h => (h.derivation !== '') !== derived);
        return other.length * 2 > held.length
            ? [`${text}: ${other.length} of its ${held.length} sentences use ${headword} ${derived ? 'not derived' : `derived (${other[0].derivation})`}`]
            : [];
    });
}

/** The word before a verb's particle names what the verb takes (年を取る): a content noun, not 私, それ or こと. */
function namesWhat(t: IpadicFeatures | undefined): boolean {
    return t !== undefined && t.pos === '名詞' && !['代名詞', '非自立', '数', '接尾'].includes(t.pos_detail_1);
}

/**
 * The patterns one occurrence of a word takes, shortest first (不思議に, then 不思議に思う): each
 * prefix that ends well. `spans` are every word found in the sentence, to name a verb by its entry
 * and, for a verb, the word before its particle.
 */
export function patternCandidates(tokens: readonly IpadicFeatures[], at: Occurrence, kind: PatternKind, spans: readonly Occurrence[]): PatternPart[][] {
    const i = tokens.findIndex(t => startOf(t) === at.start);
    if (i < 0) return [];

    if (kind === 'verb') {
        const particle = tokens[i - 1];
        if (!particle || particle.pos !== '助詞' || particle.pos_detail_1 !== '格助詞' || particle.surface_form === 'の') return [];
        if (!namesWhat(tokens[i - 2])) return [];
        const before = spans.find(s => s.id !== at.id && s.start + s.length === startOf(particle));
        if (!before) return [];
        const derived = derivedOf(tokens, lastTokenOf(tokens, at));
        return [[{ id: before.id }, particle.surface_form, derived ? { id: at.id, derived } : { id: at.id }]];
    }

    let head: PatternPart, next: number;
    if (kind === 'i-adjective') {
        const t = tokens[i];
        if (t.pos !== '形容詞' || !t.conjugated_form.startsWith('連用テ接続') || !t.surface_form.endsWith('く')) return [];
        head = { id: at.id, ku: true };
        next = i + 1;
    } else {
        head = { id: at.id };
        next = tokens.findIndex(t => startOf(t) === at.start + at.length);
        if (next < 0) return [];
    }

    const parts: PatternPart[] = [];
    const candidates: PatternPart[][] = [];
    for (let k = next; k < tokens.length && parts.length < MAX_FOLLOWING; k++) {
        const t = tokens[k];
        if (parts.length > 0 && t.pos === '助動詞' && INFLECTING.has(t.basic_form)) continue;
        if (!allowed(t, parts.length)) break;
        // The word and する alone (描写する) only says it is a する noun, which Meanings does.
        if (parts.length === 0 && t.pos === '動詞' && t.basic_form === 'する') break;
        const part = partOf(t, spans, at.id);
        parts.push(part);
        if (endsWell(t, part, kind, parts.length - 1)) candidates.push([head, ...parts]);
        if (t.pos === '動詞' || isNai(t) || part === 'な〜') break;
    }
    return candidates;
}

/** One occurrence's candidates, in one of the word's sentences. */
export interface PatternUse {
    sentence: string;
    candidates: PatternPart[][];
}

export interface WordPatterns {
    /** The kept patterns, the most used first: as written, and how many sentences hold each. */
    patterns: { text: string; sentences: number }[];
    /** Which kept pattern an occurrence is (its longest kept candidate), as an index into `patterns`. */
    indexOf: (candidates: readonly PatternPart[][]) => number | undefined;
}

/**
 * The word's patterns from every occurrence's candidates, counted by how they are written (`text`,
 * patternText with the final headwords), so 勉強する is one pattern whether or not する was found
 * as a word of its own. A pattern is kept when enough sentences use it beyond its kept longer forms
 * (不思議に is dropped when nearly all of it is 不思議に思う), the most used PATTERN_LIMITS.max of
 * them; each occurrence then belongs to its longest kept pattern, and a pattern's count is the
 * sentences that hold it, so the filter it opens shows exactly that many. に and へ before 行く or
 * 来る count as one pattern (`keyOf`), written as most of its sentences spell it.
 */
export function selectPatterns(uses: readonly PatternUse[], sentenceCount: number, text: (parts: readonly PatternPart[]) => string): WordPatterns {
    const min = Math.max(PATTERN_LIMITS.minSentences, Math.ceil(sentenceCount * PATTERN_LIMITS.minShare));
    const keyOf = (parts: readonly PatternPart[]): string => {
        const n = parts.length;
        const goCome = n >= 2 && parts[n - 2] === 'へ' && GO_COME.has(text(parts.slice(n - 1)));
        return text(goCome ? [...parts.slice(0, n - 2), 'に', parts[n - 1]] : parts);
    };
    const found = new Map<string, { length: number; prefixes: Set<string>; sentences: Set<string>; spellings: Map<string, Set<string>> }>();
    for (const { sentence, candidates } of uses) {
        for (const parts of candidates) {
            const key = keyOf(parts);
            const entry = found.get(key) ?? { length: parts.length, prefixes: new Set<string>(), sentences: new Set<string>(), spellings: new Map<string, Set<string>>() };
            for (let n = 1; n < parts.length; n++) entry.prefixes.add(keyOf(parts.slice(0, n)));
            entry.sentences.add(sentence);
            const spelling = text(parts);
            entry.spellings.set(spelling, (entry.spellings.get(spelling) ?? new Set()).add(sentence));
            found.set(key, entry);
        }
    }
    /** A merged pattern as most of its sentences spell it (学校に行く over 学校へ行く), the key on a tie. */
    const written = (key: string): string => {
        const spellings = [...found.get(key)!.spellings.entries()];
        return spellings.sort(([ka, a], [kb, b]) => b.size - a.size || (ka === key ? -1 : kb === key ? 1 : ka < kb ? -1 : 1))[0][0];
    };

    const longestFirst = [...found.entries()].sort(([ka, a], [kb, b]) =>
        b.length - a.length || b.sentences.size - a.sentences.size || (ka < kb ? -1 : 1));
    const kept: { key: string; residual: number }[] = [];
    for (const [key, { sentences }] of longestFirst) {
        const covered = new Set(kept.filter(k => found.get(k.key)!.prefixes.has(key)).flatMap(k => [...found.get(k.key)!.sentences]));
        const residual = [...sentences].filter(s => !covered.has(s)).length;
        if (residual >= min) kept.push({ key, residual });
    }
    const chosen = new Set(kept.sort((a, b) => b.residual - a.residual || (a.key < b.key ? -1 : 1)).slice(0, PATTERN_LIMITS.max).map(k => k.key));

    const longestChosen = (candidates: readonly PatternPart[][]): string | undefined =>
        candidates.map(keyOf).filter(key => chosen.has(key)).at(-1);
    const holding = new Map<string, Set<string>>();
    for (const { sentence, candidates } of uses) {
        const key = longestChosen(candidates);
        if (key) holding.set(key, (holding.get(key) ?? new Set()).add(sentence));
    }
    const ordered = [...holding.entries()].sort(([ka, a], [kb, b]) => b.size - a.size || (ka < kb ? -1 : 1));
    const index = new Map(ordered.map(([key], i) => [key, i]));
    return {
        patterns: ordered.map(([key, sentences]) => ({ text: written(key), sentences: sentences.size })),
        indexOf: candidates => {
            const key = longestChosen(candidates);
            return key === undefined ? undefined : index.get(key);
        },
    };
}

/**
 * A pattern as a learner reads it: each word by its headword (an i-adjective in its く form, a
 * derived verb with its causative or passive), then the literals.
 */
export function patternText(parts: readonly PatternPart[], headword: (id: string) => string): string {
    return parts.map(part => {
        if (typeof part === 'string') return part;
        const word = headword(part.id);
        if (part.derived) {
            const { basicTail, tail, written } = part.derived;
            return word.endsWith(basicTail) ? word.slice(0, word.length - basicTail.length) + tail : written;
        }
        return part.ku ? word.replace(/い$/, 'く') : word;
    }).join('');
}
