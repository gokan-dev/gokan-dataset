// Unihan's facts about a kanji for a Chinese reader, as labels: its Simplified form where Simplified
// Chinese writes it differently (電 is 电), its Traditional form where Traditional Chinese does,
// and its Mandarin reading. A kanji is its own Unihan entry, so every label is matched by id.
import type { Label, TextByLanguage } from '../models/text.model';
import { isSimplifiedOnly, isTraditionalOnly, type HanVariants } from './hanScript';
import { addRenderings, rendering } from './renderings';

/** Pinyin is Mandarin in Latin letters, the same in either script's file. */
export const PINYIN = 'zh-latn-pinyin';

/** Unihan_Readings.txt's kMandarin field, by character: its readings, the most frequent first. */
export function parseMandarinReadings(lines: Iterable<string>): Map<string, string[]> {
    const readings = new Map<string, string[]>();
    for (const line of lines) {
        const [char, field, values] = line.split('\t');
        const m = char ? /^U\+([0-9A-F]{4,6})$/.exec(char) : null;
        if (field !== 'kMandarin' || !m?.[1] || !values) continue;
        readings.set(String.fromCodePoint(Number.parseInt(m[1], 16)), values.trim().split(/\s+/));
    }
    return readings;
}

/** A kanji's Unihan labels, in zh-hans and zh-hant: each one's variant form, both its Mandarin readings. */
export function unihanText(kanji: string, variants: HanVariants, mandarin: ReadonlyMap<string, string[]>): TextByLanguage {
    const text: TextByLanguage = {};
    const label = (lang: string, field: string, value: string, valueLang?: string): Label => rendering<Label>('kanji', kanji, lang, {
        ...(valueLang ? { lang: valueLang } : {}),
        role: 'label',
        field,
        source: { source: 'unihan', ref: kanji },
        match: 'id',
        status: 'imported',
        value,
    });
    const simplified = isTraditionalOnly(kanji, variants) ? variants.simplified.get(kanji) ?? [] : [];
    const traditional = isSimplifiedOnly(kanji, variants) ? variants.traditional.get(kanji) ?? [] : [];
    const readings = mandarin.get(kanji) ?? [];
    addRenderings(text, 'zh-hans', [
        ...simplified.map(s => label('zh-hans', 'simplifiedForm', s)),
        ...readings.map(r => label('zh-hans', 'mandarinReading', r, PINYIN)),
    ]);
    addRenderings(text, 'zh-hant', [
        ...traditional.map(t => label('zh-hant', 'traditionalForm', t)),
        ...readings.map(r => label('zh-hant', 'mandarinReading', r, PINYIN)),
    ]);
    return text;
}
