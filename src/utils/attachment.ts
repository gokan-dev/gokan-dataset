/**
 * Which sibling points cannot stand in a sentence, on the ground of connection
 * alone: the word before the blank is in a form they never attach to (にしろ
 * after a volitional, a dictionary-form marker after a verb stem). That is what
 * makes a sibling a fair wrong answer in a choice exercise: the learner can rule
 * it out by the form in front of the blank.
 *
 * Deliberately narrow, because a wrong exclusion tells a learner that a valid
 * sentence is wrong. Formation texts are loose about ordinary attachment
 * ("Noun + にせよ" also follows a plain verb, and the mined pools only repeat
 * what the formation says), so nothing is concluded from a noun, a plain form or
 * an adjective in front of the blank, in either direction. Nor from a stem:
 * a verb stem is also a noun (買い物をしに帰る, 帰りに), so a marker never seen
 * after one may still follow it. Only two forms are marked enough to conclude
 * from, the て-form and the volitional: a marker that follows one says so, in
 * its formation or in its own examples. So a sibling is ruled out only when:
 *  - the word before the blank is a て-form or a volitional, and neither the
 *    sibling's formation nor any of its examples shows that form; or
 *  - the sibling attaches to marked forms only (a て-form, a volitional or a
 *    stem), and the word before the blank is an ordinary one.
 *
 * Whether a sibling that does attach means the wrong thing is a claim about
 * meaning, and is not decided here.
 */
import type { MorphToken } from './formationMiner';

/** The form of the word before a marker: a て-form, a volitional, a continuative stem, or anything else. */
export type HostForm = 'te' | 'volitional' | 'stem' | 'other';
type MarkedForm = Exclude<HostForm, 'other'>;

const MARKED_FORMS: MarkedForm[] = ['te', 'volitional', 'stem'];

export function hostFormOf(token: MorphToken): HostForm {
    if (token.pos === '助詞' && token.posDetail1 === '接続助詞' && (token.surface === 'て' || token.surface === 'で')) return 'te';
    if (token.pos === '助動詞' && ['う', 'よう', 'まい'].includes(token.base)) return 'volitional';
    // Any continuative: the ます-stem (読み), a godan verb's て-stem (立っ), a negative's (なく).
    // They are not told apart, so a marker seen after one is never ruled out after another.
    if (token.conj.startsWith('連用')) return 'stem';
    return 'other';
}

const FORM_IN_FORMATION: Record<MarkedForm, RegExp> = {
    te: /て\s*[-ー]?\s*(?:form|形)|\bte[- ]?form|verb\s*[-ー]?\s*て/i,
    volitional: /volitional|意向形|(?:う|よう)\s*[-ー]?\s*(?:form|形)/i,
    stem: /stem|ます\s*[-ー]?\s*(?:form|形)|連用形/i,
};

/** A formation that names an ordinary attachment too, so the sibling is not limited to marked forms. */
const ORDINARY_ATTACHMENT = /noun|adjective|casual|plain|dictionary|clause|sentence|phrase/i;

/** What is known about what a point attaches to. */
export interface AttachmentEvidence {
    /** The point's formation text. */
    formation: string;
    /** The form before the marker in each of its own examples. */
    observed: Set<HostForm>;
    /** Its marker as its examples write it. */
    markers: string[];
}

const shows = (sibling: AttachmentEvidence, form: MarkedForm) => sibling.observed.has(form) || FORM_IN_FORMATION[form].test(sibling.formation);

/** True when everything known about a point says it follows marked forms only. */
function attachesToMarkedFormsOnly(sibling: AttachmentEvidence): boolean {
    if (sibling.observed.size === 0 || sibling.observed.has('other')) return false;
    if (ORDINARY_ATTACHMENT.test(sibling.formation)) return false;
    return MARKED_FORMS.some(form => FORM_IN_FORMATION[form].test(sibling.formation));
}

/**
 * True when a sibling cannot follow a word in this form (see the file comment).
 * `form` is null when nothing precedes the blank, which rules nothing out.
 */
export function rulesOut(form: HostForm | null, sibling: AttachmentEvidence): boolean {
    if (form === null || sibling.observed.size === 0) return false;
    if (form === 'other') return attachesToMarkedFormsOnly(sibling);
    if (form === 'stem') return false;
    // A marker that itself opens with て after a て-form would only double it
    // (してても is the spoken していても): not a clean wrong answer.
    if (form === 'te' && sibling.markers.some(m => /^[てで]/.test(m))) return false;
    return !shows(sibling, form);
}
