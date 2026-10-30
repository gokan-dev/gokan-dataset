const HIRAGANA_START = 0x3041;
const HIRAGANA_END = 0x3096;
const KANA_OFFSET = 0x60;

export function toKatakana(text: string): string {
    let out = '';
    for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0;
        out += code >= HIRAGANA_START && code <= HIRAGANA_END ? String.fromCodePoint(code + KANA_OFFSET) : ch;
    }
    return out;
}

/** The vowel each katakana mora ends in, for spelling a long-vowel mark (ー) out. */
const VOWEL_OF: Record<string, string> = {};
for (const [vowel, kana] of Object.entries({
    ア: 'アカガサザタダナハバパマヤャラワァ',
    イ: 'イキギシジチヂニヒビピミリィ',
    ウ: 'ウクグスズツヅヌフブプムユュルゥヴ',
    エ: 'エケゲセゼテデネヘベペメレェ',
    オ: 'オコゴソゾトドノホボポモヨョロヲォ',
})) {
    for (const k of kana) VOWEL_OF[k] = vowel;
}

/**
 * A kana string as it is pronounced, so the engine's reading of a written word and of the
 * same word in kana compare equal: 先生 comes back as センセー and せんせい as センセイ,
 * both said the same. Long vowels are spelled out (ー as the vowel before it, エイ as エエ,
 * オウ as オオ), ヲ is オ and ヂ ヅ are ジ ズ. Anything that is not kana is dropped.
 */
export function pronunciationKey(text: string): string {
    let out = '';
    for (const ch of toKatakana(text)) {
        if (ch === 'ー') {
            out += VOWEL_OF[out[out.length - 1] ?? ''] ?? '';
            continue;
        }
        if (!/[ァ-ヶ]/.test(ch)) continue;
        out += ch === 'ヲ' ? 'オ' : ch === 'ヂ' ? 'ジ' : ch === 'ヅ' ? 'ズ' : ch;
    }
    return out.replace(/(?<=[エケゲセゼテデネヘベペメレ])イ/g, 'エ').replace(/(?<=[オコゴソゾトドノホボポモヨョロ])ウ/g, 'オ');
}
