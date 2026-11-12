/**
 * Finds conjugated forms in a tokenized sentence, for the inflection points
 * (the て-form, the polite past, くない...): the sentences they are asked in.
 *
 * A form is never recognised by its morphological tags. The conjugator is the
 * one place that says what a form is (conjugator.ts, tested per form and word
 * class), so a word is conjugated into every form and the sentence is checked
 * for the result. Two rules keep a short form from being read inside a longer
 * one: the match ends on a token boundary (食べた is not found in 食べたい), and
 * the longest form starting at a word wins (高く is not found in 高くない, nor
 * 静かで in 静かではない).
 *
 * Pure: it reads tokens, like the miner.
 */
import { classify, conjugate, FORM_LABELS } from './conjugator';
import type { ConjugationForm, WordClass } from './conjugator';

/** The kuromoji fields the finder reads, with the token's offsets in the sentence. */
export interface FormToken {
    surface: string;
    pos: string;
    posDetail1: string;
    base: string;
    /** kuromoji's conjugated_type (五段・カ行イ音便, 一段, 形容詞・イ段), which names the word's class. */
    conjType: string;
    start: number;
    end: number;
}

export interface FoundForm {
    form: ConjugationForm;
    /** The word's dictionary form. */
    lemma: string;
    wordClass: WordClass['kind'];
    /** Character offsets of the conjugated form in the sentence. */
    start: number;
    end: number;
}

const ALL_FORMS = Object.keys(FORM_LABELS) as ConjugationForm[];

/** kuromoji's tokens as the finder reads them, with their offsets in the sentence. */
export function formTokens(raw: { surface_form: string; pos: string; pos_detail_1: string; basic_form: string; conjugated_type: string }[]): FormToken[] {
    let offset = 0;
    return raw.map(t => {
        const start = offset;
        offset += t.surface_form.length;
        return { surface: t.surface_form, pos: t.pos, posDetail1: t.pos_detail_1, base: t.basic_form, conjType: t.conjugated_type, start, end: offset };
    });
}

/** A word of its own: a bound verb or adjective (れる, せる, the ない after a verb) is part of another word's form. */
const standsAlone = (t: FormToken) => (t.pos !== '動詞' && t.pos !== '形容詞') || t.posDetail1 === '自立';

/** What continues a conjugation past the matched form, making it a different form (食べた + ら, 高く + て). */
function continuesConjugation(t: FormToken | undefined): boolean {
    if (!t) return false;
    if (t.pos === '助動詞') return true;
    if (t.pos === '動詞' && t.posDetail1 === '接尾') return true;
    return t.pos === '助詞' && t.posDetail1 === '接続助詞' && ['て', 'で', 'ば', 'たり', 'だり'].includes(t.surface);
}

/** Every written spelling of every form of one word, memoized per word. */
function formsOfWord(cache: Map<string, { form: ConjugationForm; written: string }[]>, t: FormToken, wordClass: WordClass) {
    const key = `${t.base}|${t.conjType}|${wordClass.kind}`;
    let forms = cache.get(key);
    if (!forms) {
        forms = [];
        for (const form of ALL_FORMS) {
            const conjugation = conjugate(t.base, t.base, wordClass, form);
            if (!conjugation) continue;
            for (const written of [conjugation.written, ...(conjugation.alternatives ?? []).map(a => a.written)]) {
                if (written !== t.base) forms.push({ form, written });
            }
        }
        cache.set(key, forms);
    }
    return forms;
}

/**
 * The conjugated forms in a sentence, at most one per word: the longest that is
 * written there and ends where the conjugation ends. `text` is the sentence the
 * tokens were cut from. A finder keeps its own cache of conjugated words.
 */
export function createFormFinder(): (tokens: FormToken[], text: string) => FoundForm[] {
    const cache = new Map<string, { form: ConjugationForm; written: string }[]>();
    return (tokens, text) => {
        const ends = new Map(tokens.map((t, i) => [t.end, i]));
        const found: FoundForm[] = [];
        for (const t of tokens) {
            const wordClass = standsAlone(t) ? classify(t.base, t.pos, t.posDetail1, t.conjType) : null;
            if (!wordClass) continue;
            let best: { form: ConjugationForm; end: number } | null = null;
            let tied = false;
            for (const { form, written } of formsOfWord(cache, t, wordClass)) {
                if (!text.startsWith(written, t.start)) continue;
                const end = t.start + written.length;
                if (!best || end > best.end) { best = { form, end }; tied = false; }
                // Two forms written alike (the ichidan passive and potential) name nothing.
                else if (end === best.end && form !== best.form) tied = true;
            }
            if (!best || tied) continue;
            const last = ends.get(best.end);
            if (last === undefined || continuesConjugation(tokens[last + 1])) continue;
            found.push({ form: best.form, lemma: t.base, wordClass: wordClass.kind, start: t.start, end: best.end });
        }
        return found;
    };
}
