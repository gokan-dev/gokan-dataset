// Which script a Chinese text is written in, and the one transform between scripts the dataset
// allows (decision D3), both from Unihan's kSimplifiedVariant and kTraditionalVariant, character
// by character, so the result is the same on every machine. A text is tagged as its characters
// show it (decision D2): `zh-hant` or `zh-hans`, or bare `zh` when no character tells the two apart.
import type { DerivedValue, LanguageTag, Value } from '../models/text.model';

/** Each character's Simplified and Traditional variants, as Unihan lists them. */
export interface HanVariants {
    simplified: Map<string, string[]>;
    traditional: Map<string, string[]>;
}

function codePoint(token: string): string | undefined {
    // A value is `U+XXXX`, sometimes followed by `<source` (kSemanticVariant): only the code point counts.
    const m = /^U\+([0-9A-F]{4,6})/.exec(token);
    return m?.[1] ? String.fromCodePoint(Number.parseInt(m[1], 16)) : undefined;
}

/** Unihan_Variants.txt's lines (`U+96FB<TAB>kSimplifiedVariant<TAB>U+7535`), read for the two fields that matter here. */
export function parseUnihanVariants(lines: Iterable<string>): HanVariants {
    const variants: HanVariants = { simplified: new Map(), traditional: new Map() };
    for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        const [char, field, values] = line.split('\t');
        const target = field === 'kSimplifiedVariant' ? variants.simplified : field === 'kTraditionalVariant' ? variants.traditional : undefined;
        const from = char ? codePoint(char) : undefined;
        if (!target || !from || !values) continue;
        target.set(from, values.split(' ').map(codePoint).filter((c): c is string => c !== undefined));
    }
    return variants;
}

/** A character Simplified Chinese does not write: it has a Simplified variant, and it is not one of them (電, 機). */
export function isTraditionalOnly(char: string, v: HanVariants): boolean {
    const simplified = v.simplified.get(char);
    return simplified !== undefined && !simplified.includes(char);
}

/** A character Traditional Chinese does not write (电, 饮). 机 and 后 are written in both, so neither is. */
export function isSimplifiedOnly(char: string, v: HanVariants): boolean {
    const traditional = v.traditional.get(char);
    return traditional !== undefined && !traditional.includes(char);
}

/** `neutral`: no character tells the scripts apart (信, 函件); `mixed`: both scripts' own characters (飲/饮). */
export type HanScript = 'hans' | 'hant' | 'neutral' | 'mixed';

export function hanScriptOf(text: string, v: HanVariants): HanScript {
    let traditional = false;
    let simplified = false;
    for (const char of text) {
        if (isTraditionalOnly(char, v)) traditional = true;
        else if (isSimplifiedOnly(char, v)) simplified = true;
    }
    if (traditional && simplified) return 'mixed';
    return traditional ? 'hant' : simplified ? 'hans' : 'neutral';
}

/**
 * The text in Simplified characters (transform `script:hant-to-hans`): each Traditional-only
 * character replaced by its Simplified variant, every other character kept. Undefined when a
 * Traditional-only character has no single Simplified variant (鍾 is 钟 or 锺): the transform
 * never chooses.
 */
export function toSimplified(text: string, v: HanVariants): string | undefined {
    let out = '';
    for (const char of text) {
        if (!isTraditionalOnly(char, v)) { out += char; continue; }
        const simplified = v.simplified.get(char) ?? [];
        if (simplified.length !== 1 || simplified[0] === undefined) return undefined;
        out += simplified[0];
    }
    return out;
}

/** As toSimplified, keeping a character it cannot convert: for comparing two texts, never for showing one. */
export function simplifiedForComparison(text: string, v: HanVariants): string {
    let out = '';
    for (const char of text) {
        const simplified = isTraditionalOnly(char, v) ? v.simplified.get(char) ?? [] : [];
        out += simplified.length === 1 && simplified[0] !== undefined ? simplified[0] : char;
    }
    return out;
}

/** What one language's file holds of a text: its values, and the rendering's language when it is not the file's. */
export interface ServedText {
    lang?: LanguageTag;
    values: Value[];
}

export interface Served {
    'zh-hans'?: ServedText;
    'zh-hant'?: ServedText;
    /** Values written in Simplified characters by the transform. */
    converted: number;
    /** Set when a Traditional-only character had no single Simplified variant, so nothing was served in zh-hans. */
    unconvertible: boolean;
}

/**
 * Where the values of one rendering (a word, a sentence, a definition's glosses) go, as their
 * characters show (decision D2). Written the same in both scripts: both files, tagged `zh`.
 * Otherwise zh-hant only when no value uses a Simplified-only character, since Simplified to
 * Traditional is one-to-many and not allowed; zh-hans when every value is Simplified already or
 * converts, each converted value naming its original (decision D3).
 */
export function serveChinese(values: string[], v: HanVariants): Served {
    const scripts = values.map(value => hanScriptOf(value, v));
    if (scripts.every(s => s === 'neutral')) {
        return { 'zh-hans': { lang: 'zh', values }, 'zh-hant': { lang: 'zh', values }, converted: 0, unconvertible: false };
    }
    const served: Served = { converted: 0, unconvertible: false };
    if (scripts.every(s => s === 'hant' || s === 'neutral')) served['zh-hant'] = { values };
    const hans: Value[] = [];
    for (const [i, value] of values.entries()) {
        const script = scripts[i];
        if (script !== 'hant' && script !== 'mixed') { hans.push(value); continue; }
        const simplified = toSimplified(value, v);
        if (simplified === undefined) return { ...served, converted: 0, unconvertible: true };
        const derived: DerivedValue = { value: simplified, derivedFrom: { value, lang: script === 'hant' ? 'zh-hant' : 'zh', transform: 'script:hant-to-hans' } };
        hans.push(derived);
    }
    served['zh-hans'] = { values: hans };
    served.converted = hans.filter(h => typeof h !== 'string').length;
    return served;
}
