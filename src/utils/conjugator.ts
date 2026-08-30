/**
 * Forward conjugation: dictionary form -> a named derived form, for both the
 * written form and the reading.
 *
 * Used at build time by scripts/build-conjugations.ts to generate the answer
 * keys for the transformation quiz (gokan-srs#54). Deliberately NOT the inverse
 * of the app's `Deinflector`, which cannot serve this purpose: it is
 * single-level, it is permissive (it returns a candidate for every suffix that
 * matches, without checking the result is a real word), and it does not encode
 * the verb's class.
 *
 * The class comes from kuromoji's `conjugated_type`, which is a better source
 * than any lemma-shape heuristic because it already encodes the て/た euphony
 * subtype - the part that actually makes Japanese conjugation hard:
 *
 *   書く -> 五段・カ行イ音便   (書いて)
 *   行く -> 五段・カ行促音便   (行って, the classic exception)
 *   買う -> 五段・ワ行促音便   (買って)
 *   帰る -> 五段・ラ行         (godan despite ending in る - correctly typed)
 *   走る -> 五段・ラ行
 *
 * Two things kuromoji gets wrong or cannot express, handled explicitly below:
 *   - bare する comes back as 五段・ラ行, colliding with 擦る (a real godan ラ行
 *     verb also read する). Irregulars therefore come from IRREGULARS, never
 *     from the class table.
 *   - な-adjectives are 名詞 with `conjugated_type: '*'` in IPADIC, so they are
 *     detected from pos_detail (形容動詞語幹), not from the class.
 */

/** A derived form this module can produce. */
export type ConjugationForm =
    | 'te'
    | 'tai'
    | 'zu'
    | 'chatta'
    | 'toku'
    | 'causative'
    | 'causative-passive'
    | 'passive'
    | 'potential'
    | 'i-adj-adverbial'
    | 'i-adj-te'
    | 'i-adj-negative-polite'
    | 'na-adj-adverbial';

export interface Conjugation {
    /** The written form, e.g. 飲んで. */
    written: string;
    /** The same form in kana, e.g. のんで - accepted as an alternative answer. */
    reading: string;
    /** Equally correct alternatives (written form), e.g. 書かされる for the causative-passive. */
    alternatives?: { written: string; reading: string }[];
}

export type WordClass =
    | { kind: 'godan'; row: GodanRow; teVoiced: boolean; teKana: string }
    | { kind: 'ichidan' }
    | { kind: 'irregular'; lemma: 'する' | '来る' }
    | { kind: 'i-adjective' }
    | { kind: 'na-adjective' };

type GodanRow = 'ka' | 'ga' | 'sa' | 'ta' | 'na' | 'ba' | 'ma' | 'ra' | 'wa';

/**
 * Per godan row: the a-stem (negative/causative/passive base), the i-stem
 * (ます-stem), the e-stem (potential base), and the て-form ending.
 *
 * The a-row for ワ行 is わ, not あ - 買う -> 買わない. That single irregularity is
 * the most commonly mis-generated form in naive conjugators.
 */
const GODAN_ROWS: Record<GodanRow, { a: string; i: string; e: string; te: string }> = {
    ka: { a: 'か', i: 'き', e: 'け', te: 'いて' },
    ga: { a: 'が', i: 'ぎ', e: 'げ', te: 'いで' },
    sa: { a: 'さ', i: 'し', e: 'せ', te: 'して' },
    ta: { a: 'た', i: 'ち', e: 'て', te: 'って' },
    na: { a: 'な', i: 'に', e: 'ね', te: 'んで' },
    ba: { a: 'ば', i: 'び', e: 'べ', te: 'んで' },
    ma: { a: 'ま', i: 'み', e: 'め', te: 'んで' },
    ra: { a: 'ら', i: 'り', e: 'れ', te: 'って' },
    wa: { a: 'わ', i: 'い', e: 'え', te: 'って' },
};

const ROW_BY_LABEL: Record<string, GodanRow> = {
    'カ行': 'ka', 'ガ行': 'ga', 'サ行': 'sa', 'タ行': 'ta',
    'ナ行': 'na', 'バ行': 'ba', 'マ行': 'ma', 'ラ行': 'ra', 'ワ行': 'wa',
};

/**
 * Irregulars, spelled out rather than derived. する's potential is でき
 * (a different verb entirely), so it is deliberately absent - see
 * build-conjugations.ts, which excludes する from the potential drill rather
 * than teaching できる as a conjugation of する.
 */
const IRREGULARS: Record<'する' | '来る', Partial<Record<ConjugationForm, Conjugation>>> = {
    'する': {
        te: { written: 'して', reading: 'して' },
        tai: { written: 'したい', reading: 'したい' },
        zu: { written: 'せず', reading: 'せず' },
        chatta: { written: 'しちゃった', reading: 'しちゃった' },
        toku: { written: 'しとく', reading: 'しとく' },
        causative: { written: 'させる', reading: 'させる' },
        'causative-passive': { written: 'させられる', reading: 'させられる' },
        passive: { written: 'される', reading: 'される' },
    },
    '来る': {
        te: { written: '来て', reading: 'きて' },
        tai: { written: '来たい', reading: 'きたい' },
        zu: { written: '来ず', reading: 'こず' },
        chatta: { written: '来ちゃった', reading: 'きちゃった' },
        toku: { written: '来とく', reading: 'きとく' },
        causative: { written: '来させる', reading: 'こさせる' },
        'causative-passive': { written: '来させられる', reading: 'こさせられる' },
        passive: { written: '来られる', reading: 'こられる' },
        potential: { written: '来られる', reading: 'こられる' },
    },
};

/** い-adjectives whose adverbial/て forms are not stem + く. */
const IRREGULAR_I_ADJECTIVES: Record<string, { stemWritten: string; stemReading: string }> = {
    'いい': { stemWritten: 'よ', stemReading: 'よ' },
    '良い': { stemWritten: '良', stemReading: 'よ' },
};

/**
 * Classifies a word from kuromoji's own features. Returns null for anything this
 * module will not conjugate, which the caller must treat as "not drillable"
 * rather than guessing.
 */
export function classify(
    lemma: string,
    pos: string,
    posDetail1: string,
    conjugatedType: string
): WordClass | null {
    // Irregulars first: kuromoji mis-types bare する as 五段・ラ行.
    if (lemma === 'する') return { kind: 'irregular', lemma: 'する' };
    if (lemma === '来る' || lemma === 'くる') return { kind: 'irregular', lemma: '来る' };

    if (pos === '動詞') {
        if (conjugatedType.startsWith('一段')) return { kind: 'ichidan' };
        if (conjugatedType.startsWith('五段')) {
            // "五段・カ行イ音便" -> row label "カ行", euphony "イ音便"
            const parts = conjugatedType.split('・');
            const rowLabel = parts[1]?.slice(0, 2) ?? '';
            const row = ROW_BY_LABEL[rowLabel];
            if (!row) return null;
            // 行く is 五段・カ行促音便: same row as 書く but て-form って, not いて.
            const sokuon = conjugatedType.includes('促音便');
            const teKana = sokuon && row === 'ka' ? 'って' : GODAN_ROWS[row].te;
            return { kind: 'godan', row, teVoiced: teKana.startsWith('ん') || teKana === 'いで', teKana };
        }
        // サ変/カ変 compounds (勉強する) and anything else: out of scope for v1.
        return null;
    }

    if (pos === '形容詞' && conjugatedType.startsWith('形容詞')) return { kind: 'i-adjective' };
    // な-adjectives are nouns in IPADIC; only pos_detail identifies them.
    if (pos === '名詞' && posDetail1 === '形容動詞語幹') return { kind: 'na-adjective' };

    return null;
}

/** Splits off the final kana of both forms - the shared stem operation. */
function stems(written: string, reading: string): { written: string; reading: string } {
    return { written: written.slice(0, -1), reading: reading.slice(0, -1) };
}

/**
 * Produces `form` for `lemma`, or null when the pairing is not valid (an
 * adjective form asked of a verb, a verb form asked of an adjective, or an
 * irregular that deliberately has no entry for this form).
 */
export function conjugate(
    lemma: string,
    lemmaReading: string,
    wordClass: WordClass,
    form: ConjugationForm
): Conjugation | null {
    const isAdjectiveForm = form.startsWith('i-adj-') || form.startsWith('na-adj-');

    if (wordClass.kind === 'na-adjective') {
        if (form !== 'na-adj-adverbial') return null;
        // な-adjective lemmas are stored as the bare stem (静か), so nothing to strip.
        return { written: `${lemma}に`, reading: `${lemmaReading}に` };
    }

    if (wordClass.kind === 'i-adjective') {
        if (!form.startsWith('i-adj-')) return null;
        const irregular = IRREGULAR_I_ADJECTIVES[lemma];
        const stem = irregular
            ? { written: irregular.stemWritten, reading: irregular.stemReading }
            : stems(lemma, lemmaReading);
        if (form === 'i-adj-adverbial') {
            return { written: stem.written + 'く', reading: stem.reading + 'く' };
        }
        if (form === 'i-adj-te') {
            return { written: stem.written + 'くて', reading: stem.reading + 'くて' };
        }
        // The polite negative has TWO standard forms and a learner may produce
        // either: 高くないです and 高くありません. くないです is the more colloquial and
        // is what the drill displays; くありません is the older, slightly more formal
        // one and is equally correct, so it ships as an alternative rather than
        // being graded wrong.
        return {
            written: stem.written + 'くないです',
            reading: stem.reading + 'くないです',
            alternatives: [{
                written: stem.written + 'くありません',
                reading: stem.reading + 'くありません',
            }],
        };
    }

    if (isAdjectiveForm) return null; // adjective form asked of a verb

    if (wordClass.kind === 'irregular') {
        return IRREGULARS[wordClass.lemma][form] ?? null;
    }

    if (wordClass.kind === 'ichidan') {
        const s = stems(lemma, lemmaReading);
        const add = (suffix: string): Conjugation => ({ written: s.written + suffix, reading: s.reading + suffix });
        switch (form) {
            case 'te': return add('て');
            case 'tai': return add('たい');
            case 'zu': return add('ず');
            case 'chatta': return add('ちゃった');
            case 'toku': return add('とく');
            case 'causative': return add('させる');
            case 'causative-passive': return add('させられる');
            case 'passive': return add('られる');
            case 'potential': {
                const formal = add('られる');
                const colloquial = add('れる');
                // 食べられる is BOTH the passive and the potential of an ichidan
                // verb. build-conjugations.ts keeps ichidan out of the passive and
                // potential drills for exactly this reason; the form is still
                // produced here so the module stays complete.
                return { ...formal, alternatives: [{ written: colloquial.written, reading: colloquial.reading }] };
            }
        }
        return null;
    }

    // godan
    const row = GODAN_ROWS[wordClass.row];
    const s = stems(lemma, lemmaReading);
    const add = (suffix: string): Conjugation => ({ written: s.written + suffix, reading: s.reading + suffix });

    switch (form) {
        case 'te': return add(wordClass.teKana);
        case 'tai': return add(row.i + 'たい');
        case 'zu': return add(row.a + 'ず');
        case 'chatta': {
            // Must follow the て/で voicing: 飲んで -> 飲んじゃった, never 飲んちゃった.
            const voiced = wordClass.teKana.endsWith('で');
            const base = wordClass.teKana.slice(0, -1);
            return add(base + (voiced ? 'じゃった' : 'ちゃった'));
        }
        case 'toku': {
            const voiced = wordClass.teKana.endsWith('で');
            const base = wordClass.teKana.slice(0, -1);
            return add(base + (voiced ? 'どく' : 'とく'));
        }
        case 'causative': return add(row.a + 'せる');
        case 'passive': return add(row.a + 'れる');
        case 'potential': return add(row.e + 'る');
        case 'causative-passive': {
            const full = add(row.a + 'せられる');
            const contracted = add(row.a + 'される');
            // Both are standard; the contracted form is more common in speech.
            return { ...full, alternatives: [{ written: contracted.written, reading: contracted.reading }] };
        }
    }
    return null;
}

/** Human-readable name for a form, shown to the learner as the prompt. */
export const FORM_LABELS: Record<ConjugationForm, string> = {
    'te': 'て-form',
    'tai': 'たい (want to)',
    'zu': 'ず (without doing)',
    'chatta': 'ちゃった (casual past)',
    'toku': 'とく (casual ておく)',
    'causative': 'causative (make/let someone do)',
    'causative-passive': 'causative-passive (be made to do)',
    'passive': 'passive',
    'potential': 'potential (can do)',
    'i-adj-adverbial': 'adverbial く',
    'i-adj-te': 'て-form (くて)',
    'i-adj-negative-polite': 'negative polite',
    'na-adj-adverbial': 'adverbial に',
};
