// KANJIDIC2 and KRADFILE entries turned into compiled `Kanji` fields. Pure, so build-kanji.ts only
// reads files and writes them.

import type { Kanjidic2CharacterDTO } from '../models/data.model';
import type { Kanji, KanjiRadical, KanjiSteps } from '../models/kanji.model';

/**
 * The learning orders KANJIDIC2 carries, by the reference type that holds each book's sequence.
 * Lookup dictionaries (Nelson, Halpern, Morohashi, Kodansha Compact) are left out: their numbers
 * follow the radical index, not a teaching order.
 */
export const KANJIDIC_ORDERS = {
    rtk: 'heisig6',
    rtkLegacy: 'heisig',
    kanjiInContext: 'kanji_in_context',
    kanjiKana: 'sh_kk2',
    henshall: 'henshall',
    essentialKanji: 'oneill_kk',
    kanjiFlashcards: 'jf_cards',
    tuttleCards: 'tutt_cards',
    maniette: 'maniette',
} as const satisfies Partial<Record<keyof KanjiSteps, string>>;

export type KanjidicOrder = keyof typeof KANJIDIC_ORDERS;

/**
 * The orders written as `index/kanji-orders/{order}.json`, the kanji in teaching order, so a
 * consumer reads "the first N kanji of RTK" without scanning kanji.json. Essential Kanji is left
 * out: its numbering skips six positions, so a list index would drift from the book.
 */
export const KANJI_ORDER_LISTS = [
    'kklc', 'rtk', 'rtkLegacy', 'kanjiInContext', 'kanjiKana', 'henshall', 'kanjiFlashcards', 'tuttleCards', 'maniette',
    'jlpt', 'frequency',
] as const;

export type KanjiOrderList = typeof KANJI_ORDER_LISTS[number];

/**
 * The kanji of one order, in teaching order. A book order sorts by its position; `jlpt` is N5
 * first and `frequency` is the newspaper rank (JPDB's rank is for the kanji as a word on its own,
 * 学 5839 against 海 722, so it does not say which kanji a reader meets most). Within a JLPT level
 * the most frequent kanji comes first, then code point.
 */
export function orderList(kanjis: readonly Kanji[], order: KanjiOrderList): string[] {
    const byNewspaper = (kanji: Kanji) => kanji.newspaperFrequency ?? Infinity;
    const keyed: { character: string; key: number[] }[] = [];
    for (const kanji of kanjis) {
        if (order === 'jlpt') {
            if (kanji.steps.jlpt !== undefined) keyed.push({ character: kanji.character, key: [-kanji.steps.jlpt, byNewspaper(kanji)] });
        } else if (order === 'frequency') {
            if (kanji.newspaperFrequency !== undefined) keyed.push({ character: kanji.character, key: [kanji.newspaperFrequency] });
        } else {
            const position = kanji.steps[order];
            if (position !== undefined) keyed.push({ character: kanji.character, key: [position] });
        }
    }
    const compare = (a: number[], b: number[]) => {
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0) ? -1 : 1;
        return 0;
    };
    return keyed
        .sort((a, b) => compare(a.key, b.key) || (a.character < b.character ? -1 : a.character > b.character ? 1 : 0))
        .map(entry => entry.character);
}

/**
 * RADKFILE writes a component no character can show as a kanji containing it; these are the real
 * forms, so a consumer never needs to know the convention. 阝 keeps its two sides apart (⻏ right,
 * as in 邦; ⻖ left, as in 阡), as RADKFILE does.
 */
export const COMPONENT_STAND_INS: Record<string, string> = {
    化: '亻', 个: '𠆢', 并: '丷', 刈: '刂', 乞: '𠂉', 込: '辶', 尚: '⺌', 忙: '忄', 扎: '扌', 汁: '氵', 犯: '犭',
    艾: '艹', 邦: '⻏', 阡: '⻖', 老: '耂', 杰: '灬', 礼: '礻', 疔: '疒', 禹: '禸', 初: '衤', 買: '罒', 滴: '啇',
};

/**
 * Kanji KRADFILE lists only under their common form, drawn the same but for a stroke detail. 𠮟
 * and 剝 are the jouyou's own forms of 叱 and 剥, outside the JIS set KRADFILE covers.
 */
export const KRADFILE_COMMON_FORMS: Record<string, string> = { '𠮟': '叱', 剝: '剥', 俱: '倶', 吞: '呑', 簞: '箪', 蟬: '蝉' };

/**
 * A CJK compatibility ideograph NFC-normalises into another kanji (U+FA45 becomes 海), so as a key
 * or a URL it collides with it. KANJIDIC2 lists 57 of them, all name-only variants.
 */
export function isCompatibilityIdeograph(char: string): boolean {
    const codePoint = char.codePointAt(0) ?? 0;
    return (codePoint >= 0xf900 && codePoint <= 0xfaff) || (codePoint >= 0x2f800 && codePoint <= 0x2fa1f);
}

export type KanjidicFields = Pick<Kanji, 'meanings' | 'readings' | 'strokeCount' | 'grade' | 'radical' | 'newspaperFrequency'> & {
    steps: Pick<KanjiSteps, KanjidicOrder>;
};

/** What KANJIDIC2 says about one kanji, in the compiled shape. */
export function kanjidicFields(entry: Kanjidic2CharacterDTO): KanjidicFields {
    const groups = entry.readingMeaning?.groups ?? [];
    const readingsOf = (type: string) => groups.flatMap(group => group.readings.filter(r => r.type === type).map(r => r.value));
    const classical = entry.radicals.find(r => r.type === 'classical');
    const strokeCount = entry.misc.strokeCounts[0];
    if (strokeCount === undefined) throw new Error(`KANJIDIC2 gives ${entry.literal} no stroke count`);

    return {
        meanings: groups.flatMap(group => group.meanings.filter(m => m.lang === 'en').map(m => m.value)),
        readings: { on: readingsOf('ja_on'), kun: readingsOf('ja_kun'), nanori: entry.readingMeaning?.nanori ?? [] },
        strokeCount,
        ...(entry.misc.grade !== null ? { grade: entry.misc.grade } : {}),
        ...(classical ? { radical: kangxiRadical(classical.value) } : {}),
        ...(entry.misc.frequency !== null ? { newspaperFrequency: entry.misc.frequency } : {}),
        steps: orderPositions(entry),
    };
}

/** The kanji's position in each KANJIDIC2 learning order that teaches it. */
export function orderPositions(entry: Kanjidic2CharacterDTO): Pick<KanjiSteps, KanjidicOrder> {
    const steps: Pick<KanjiSteps, KanjidicOrder> = {};
    for (const [order, type] of Object.entries(KANJIDIC_ORDERS) as [KanjidicOrder, string][]) {
        const ref = entry.dictionaryReferences.find(r => r.type === type);
        if (!ref) continue;
        const position = Number(ref.value);
        if (!Number.isInteger(position) || position < 1) throw new Error(`${entry.literal}: ${type} reference "${ref.value}" is not a position`);
        steps[order] = position;
    }
    return steps;
}

/**
 * Kangxi radical `number` (1-214) and its character. The Unicode Kangxi Radicals block holds them
 * in order; NFKC turns each into the ideograph it is written with (⼦ -> 子).
 */
export function kangxiRadical(number: number): KanjiRadical {
    if (!Number.isInteger(number) || number < 1 || number > 214) throw new Error(`No Kangxi radical ${number}`);
    return { number, character: String.fromCodePoint(0x2f00 + number - 1).normalize('NFKC') };
}

/** KRADFILE components in their real forms, in KRADFILE's order. */
export function componentForms(parts: readonly string[]): string[] {
    return parts.map(part => COMPONENT_STAND_INS[part] ?? part);
}
