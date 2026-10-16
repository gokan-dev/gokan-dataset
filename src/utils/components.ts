import type { TokenSpan } from './tokenizer';

/** What component matching needs of a word. */
export interface ComponentWord {
    id: string;
    /** Written form (writtenForm.kanji): what other words are searched in. */
    written: string;
    /** Whether the written form has a kanji (writtenForm.containedKanji is not empty). */
    hasKanji: boolean;
    /** A word learned in kana: its kana spelling (reading.primary) and its senses' JMdict parts of speech. */
    kana?: { spelling: string; pos: readonly string[] };
}

/** The JMdict parts of speech an IPADIC token's part of speech can stand for. */
const JMDICT_POS: Record<string, (tag: string) => boolean> = {
    動詞: tag => tag.startsWith('v') && tag !== 'vs',
    形容詞: tag => tag.startsWith('adj-i') || tag === 'adj-ku' || tag === 'adj-shiku',
    名詞: tag => tag === 'n' || tag.startsWith('n-') || ['pn', 'adj-na', 'adj-no', 'vs', 'ctr', 'num', 'suf'].includes(tag),
    助詞: tag => tag === 'prt' || tag === 'conj',
    助動詞: tag => tag.startsWith('aux') || tag === 'cop',
    連体詞: tag => tag === 'adj-pn',
    副詞: tag => tag.startsWith('adv'),
    接頭詞: tag => tag === 'pref',
    接続詞: tag => tag === 'conj',
    感動詞: tag => tag === 'int',
    フィラー: tag => tag === 'int',
};

const KANA = /[぀-ヿ]/;
const INFLECTED = new Set(['動詞', '形容詞', '助動詞']);

/**
 * The words each word is built from (Vocabulary.components), by id. A word with a kanji is
 * found wherever its written form appears in another's (気 in 気がする). A word learned in kana
 * is also found by its kana spelling (する in 気がする, spelled 為る), but only where that kana
 * covers whole tokens of the other word's written form (ない is not in 少ない, nor なる in
 * 重なる), and only when its first token's part of speech is one of the word's (or, over several
 * tokens, the word is an expression): kana names a spelling, not an entry (the あり in 価値あり is
 * 有り, not 蟻; the もし in 見向きもしない is も + し). A lone particle links nothing: の or が
 * is in thousands of words, and listing them all under it says nothing (のように, over several
 * tokens, still links). No span starts on an inflection ending, a span two words fit links
 * neither, and the kana spelling never matches a whole word (that is a homograph, not a
 * component).
 */
export function wordComponents(words: readonly ComponentWord[], tokenSpans: (text: string) => TokenSpan[]): Map<string, string[]> {
    // Only words with a kanji are matched by spelling; index them by first character.
    const byFirstChar = new Map<string, ComponentWord[]>();
    const byKana = new Map<string, ComponentWord[]>();
    for (const word of words) {
        if (word.hasKanji) {
            const first = word.written[0];
            if (!byFirstChar.has(first)) byFirstChar.set(first, []);
            byFirstChar.get(first)!.push(word);
        }
        if (word.kana) {
            if (!byKana.has(word.kana.spelling)) byKana.set(word.kana.spelling, []);
            byKana.get(word.kana.spelling)!.push(word);
        }
    }

    const result = new Map<string, string[]>();
    for (const word of words) {
        const target = word.written;
        const components = new Set<string>();

        const checked = new Set<string>();
        for (const char of target) {
            for (const candidate of byFirstChar.get(char) ?? []) {
                if (checked.has(candidate.id)) continue;
                checked.add(candidate.id);
                if (candidate.id !== word.id && target.includes(candidate.written)) components.add(candidate.id);
            }
        }

        if (byKana.size > 0 && KANA.test(target)) {
            const tokens = tokenSpans(target);
            for (let i = 0; i < tokens.length; i++) {
                // An auxiliary after a verb, an adjective or another auxiliary is an inflection
                // ending, never the start of a word: the まし of どう致しまして, the ない of 変わらない.
                if (tokens[i].pos === '助動詞' && i > 0 && INFLECTED.has(tokens[i - 1].pos)) continue;
                for (let j = i; j < tokens.length; j++) {
                    const [start, end] = [tokens[i].start, tokens[j].end];
                    if (start === 0 && end === target.length) continue;
                    if (i === j && tokens[i].pos === '助詞') continue;
                    const fits = JMDICT_POS[tokens[i].pos];
                    const matches = (byKana.get(target.slice(start, end)) ?? []).filter(candidate =>
                        candidate.id !== word.id &&
                        ((fits !== undefined && candidate.kana!.pos.some(fits)) || (i < j && candidate.kana!.pos.includes('exp'))));
                    // Two words of one spelling and part of speech (居る, 要る on the いる of ている): nothing tells them apart.
                    if (matches.length === 1) components.add(matches[0].id);
                }
            }
        }

        if (components.size > 0) result.set(word.id, [...components]);
    }
    return result;
}
