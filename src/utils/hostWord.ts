/**
 * The host of a grammar pattern: the conjugated word the marker attaches to
 * (し in してから, 食べさせ in 食べさせてください). A formation such as
 * "Verb-て form + から" teaches two things, the marker and the form before it,
 * and a blank over the marker alone only ever asks for the first. Recording the
 * host lets an exercise give its dictionary form and ask for the whole
 * attachment.
 *
 * Pure: it reads already-tokenized MorphTokens, like the miner.
 */
import type { MorphToken } from './formationMiner';

/**
 * A formation that names a form the host must take. The dictionary and plain
 * forms are left out on purpose: there the host is written as the learner
 * already knows it, so asking for it adds a question about tense, not about
 * the point.
 */
const DEMANDED_FORMS: RegExp[] = [
    /て\s*[-ー]?\s*(?:form|形)|\bte[- ]?form|verb\s*[-ー]?\s*て/i,
    /た\s*[-ー]?\s*(?:form|形)|\bta[- ]?form|verb\s*[-ー]?\s*た|verb[- ]past|past (?:tense|form)/i,
    /ない\s*[-ー]?\s*(?:form|形)|\bnai[- ]?form|verb\s*[-ー]?\s*ない|negative form|verb[- ]negative/i,
    /stem|ます\s*[-ー]?\s*(?:form|形)|連用形/i,
    /volitional|意向形/i,
    /ば\s*[-ー]?\s*(?:form|形)|\bba[- ]?form|conditional form/i,
    /potential|causative|passive|可能形|使役形|受身形/i,
];

export function demandsHostForm(formation: string): boolean {
    return DEMANDED_FORMS.some(re => re.test(formation));
}

const isTeConnective = (t: MorphToken) => t.pos === '助詞' && t.posDetail1 === '接続助詞' && (t.surface === 'て' || t.surface === 'で');

/** What sits between a conjugated word and the marker and belongs to the word: its auxiliaries, a connective て, a bound verb (させ, られ). */
function continuesHost(t: MorphToken): boolean {
    if (t.pos === '助動詞') return true;
    if (isTeConnective(t)) return true;
    return t.pos === '動詞' && (t.posDetail1 === '接尾' || t.posDetail1 === '非自立');
}

/** A word that conjugates on its own: an independent verb or い-adjective. */
const isHead = (t: MorphToken) => (t.pos === '動詞' || t.pos === '形容詞') && t.posDetail1 === '自立';

/**
 * The index of the host's head token, when a conjugating word sits right before
 * the marker starting at `markerStart` (its auxiliaries included, walking back
 * over them). Null when the marker attaches to anything else: a noun, a
 * particle, the start of the sentence.
 */
export function hostHead(tokens: MorphToken[], markerStart: number): number | null {
    let i = markerStart - 1;
    while (i >= 0 && !isHead(tokens[i]) && continuesHost(tokens[i])) i--;
    return i >= 0 && isHead(tokens[i]) ? i : null;
}
