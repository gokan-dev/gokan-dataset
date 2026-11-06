// A grammar point's title and romaji in the language-neutral core: where hanabira writes an
// English slot word ("Noun", "Verb", "A"), the core writes a slot code (`{noun} にもまして`,
// `{a} うが {b} うが`), and each language names the slots in its own text (docs/MULTILINGUAL.md,
// "Compiled output"). The slot vocabulary is the one hanabira's titles use; a slot word this
// module does not know fails the build rather than staying English in the core.
import type { GrammarSlot } from '../models/grammar.model';
import type { LanguageTag, TextByLanguage } from '../models/text.model';
import { grammarLabel } from './grammarText';
import { addRenderings, labelsOf } from './renderings';

/** Where a slot word is written: a title, or a romanisation, which spells a label's kana in romaji. */
export type SlotContext = 'title' | 'romaji';

interface SlotLabel {
    label: string;
    /** The label inside a romanisation, when it differs: い-Adjective is i-Adjective there. */
    romaji?: string;
}

interface SlotDefinition {
    code: string;
    labels: Record<LanguageTag, SlotLabel>;
}

/** Every slot the titles use, with Gokan's text for it: hanabira's own English spelling. */
export const GRAMMAR_SLOTS: readonly SlotDefinition[] = [
    { code: 'noun', labels: { en: { label: 'Noun' } } },
    { code: 'noun1', labels: { en: { label: 'Noun1' } } },
    { code: 'noun2', labels: { en: { label: 'Noun2' } } },
    { code: 'verb', labels: { en: { label: 'Verb' } } },
    { code: 'i-adjective', labels: { en: { label: 'い-Adjective', romaji: 'i-Adjective' } } },
    { code: 'na-adjective', labels: { en: { label: 'な-Adjective', romaji: 'na-Adjective' } } },
    { code: 'a', labels: { en: { label: 'A' } } },
    { code: 'b', labels: { en: { label: 'B' } } },
];

const SLOT_CODE = /\{([a-z0-9-]+)\}/g;
const KNOWN_CODES = new Set(GRAMMAR_SLOTS.map(s => s.code));

/** The slot codes a core title or romaji names, in order. */
export function slotCodesOf(pattern: string): string[] {
    return [...pattern.matchAll(SLOT_CODE)].map(m => m[1] ?? '');
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces a source's slot words with slot codes. A word is matched case-insensitively, so an
 * upstream casing slip (な-adjective, verb-ru) is still a slot; a single letter (A, B) only as
 * written, since a lowercase one could be romaji. The exact upstream spelling is kept by the
 * caller where rendering the codes would not give it back (see `neutralTitle`).
 */
export function parseSlots(text: string, lang: LanguageTag, context: SlotContext): string {
    const spellings = GRAMMAR_SLOTS.flatMap(slot => {
        const label = slot.labels[lang];
        if (!label) return [];
        return [{ code: slot.code, spelling: context === 'romaji' ? label.romaji ?? label.label : label.label }];
    }).sort((a, b) => b.spelling.length - a.spelling.length);

    let out = text;
    for (const { code, spelling } of spellings) {
        const flags = spelling.length > 1 ? 'gi' : 'g';
        out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escape(spelling)}(?![A-Za-z0-9])`, flags), `{${code}}`);
    }
    const leftover = out.replace(SLOT_CODE, '').match(/noun|verb|adjective/i);
    if (leftover) throw new Error(`"${text}" names a slot ("${leftover[0]}") that src/text/grammarSlots.ts does not know: add it to GRAMMAR_SLOTS.`);
    return out;
}

/** A core title or romaji with its slots named by `labelOf`; undefined when one has no name there. */
export function renderSlots(pattern: string, labelOf: (code: string) => string | undefined): string | undefined {
    let missing = false;
    const out = pattern.replace(SLOT_CODE, (_, code: string) => {
        const label = labelOf(code);
        if (label === undefined) missing = true;
        return label ?? '';
    });
    return missing ? undefined : out;
}

/** How a language joins a title's name to its pattern ("Polite past: Verb ました"). */
const NAMED_TITLE: Record<LanguageTag, (name: string, pattern: string) => string> = {
    en: (name, pattern) => `${name}: ${pattern}`,
};

/**
 * Splits a parsed title written "name: pattern" (an authored inflection point's "Polite past:
 * {verb} ました") or "pattern: name" (hanabira's "{i-adjective}: Negative Polite Form") into the
 * two. The name is the side that names no slot; a title with slots on both sides, or neither, has
 * no name.
 */
export function splitTitleName(title: string): { name?: string; pattern: string } {
    const at = title.indexOf(': ');
    if (at < 0) return { pattern: title };
    const left = title.slice(0, at).trim();
    const right = title.slice(at + 2).trim();
    const leftSlots = slotCodesOf(left).length > 0;
    const rightSlots = slotCodesOf(right).length > 0;
    if (leftSlots === rightSlots) return { pattern: title };
    return leftSlots ? { name: right, pattern: left } : { name: left, pattern: right };
}

/** The labels a language gives the slots, for rendering titles and romaji in it. */
export interface SlotLabels {
    title(code: string): string | undefined;
    romaji(code: string): string | undefined;
}

/** A language's slot labels, read from the slots' text. */
export function slotLabelsIn(slots: readonly Pick<GrammarSlot, 'code' | 'text'>[], lang: LanguageTag): SlotLabels {
    const byCode = new Map(slots.map(s => [s.code, s.text]));
    const label = (code: string): string | undefined => labelsOf(byCode.get(code), lang)[0];
    return {
        title: label,
        romaji: code => labelsOf(byCode.get(code), lang, { field: 'romaji' })[0] ?? label(code),
    };
}

/** The slots as entities, each with Gokan's labels for it in every language it has some. */
export function grammarSlots(): GrammarSlot[] {
    return GRAMMAR_SLOTS.map(slot => {
        const text: TextByLanguage = {};
        const from = { source: 'gokan', ref: slot.code };
        for (const [lang, { label, romaji }] of Object.entries(slot.labels)) {
            addRenderings(text, lang, [
                grammarLabel('grammarSlot', slot.code, lang, undefined, label, from),
                ...(romaji ? [grammarLabel('grammarSlot', slot.code, lang, 'romaji', romaji, from)] : []),
            ]);
        }
        return { code: slot.code, text };
    });
}

/** A point's title and romaji as a language writes them, from the core and the point's text there. */
export function titleIn(point: { title: string; text: TextByLanguage }, lang: LanguageTag, slots: SlotLabels): string | undefined {
    const own = labelsOf(point.text, lang, { field: 'title' })[0];
    if (own !== undefined) return own;
    const pattern = renderSlots(point.title, code => slots.title(code));
    if (pattern === undefined) return undefined;
    const name = labelsOf(point.text, lang, { field: 'name' })[0];
    return name === undefined ? pattern : joinName(lang, name, pattern);
}

function joinName(lang: LanguageTag, name: string, pattern: string): string | undefined {
    return NAMED_TITLE[lang]?.(name, pattern);
}

export function romajiIn(point: { romaji?: string; text: TextByLanguage }, lang: LanguageTag, slots: SlotLabels): string | undefined {
    if (point.romaji === undefined) return undefined;
    return labelsOf(point.text, lang, { field: 'romaji' })[0] ?? renderSlots(point.romaji, code => slots.romaji(code));
}

/** What a source's title and romaji become: the neutral core, and the text the source wrote around it. */
export interface NeutralTitle {
    title: string;
    romaji?: string;
    /** The title's name, when it has one. */
    name?: string;
    /** The source's title as written, kept only where rendering the core in its language would not give it back. */
    ownTitle?: string;
    ownRomaji?: string;
}

/**
 * A source's title and romaji, in `lang`, as the core and the text the source wrote: slot words
 * become codes, a name is split off, and where the language's own rendering of the result would
 * differ from what the source wrote (hanabira's name after the pattern, a casing slip such as
 * な-adjective), the source's spelling is kept as text, so that language reads exactly what the
 * source wrote.
 */
export function neutralTitle(title: string, romaji: string | undefined, lang: LanguageTag): NeutralTitle {
    const { name, pattern } = splitTitleName(parseSlots(title, lang, 'title'));
    const neutralRomaji = romaji === undefined ? undefined : parseSlots(romaji, lang, 'romaji');
    for (const code of [...slotCodesOf(pattern), ...slotCodesOf(neutralRomaji ?? '')]) {
        if (!KNOWN_CODES.has(code)) throw new Error(`"${title}" names an unknown slot {${code}}.`);
    }

    const labels = slotLabelsIn(grammarSlots(), lang);
    const renderedPattern = renderSlots(pattern, code => labels.title(code));
    const rendered = renderedPattern === undefined || name === undefined ? renderedPattern : joinName(lang, name, renderedPattern);
    const renderedRomaji = neutralRomaji === undefined ? undefined : renderSlots(neutralRomaji, code => labels.romaji(code));
    return {
        title: pattern,
        ...(neutralRomaji !== undefined ? { romaji: neutralRomaji } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(rendered !== title ? { ownTitle: title } : {}),
        ...(romaji !== undefined && renderedRomaji !== romaji ? { ownRomaji: romaji } : {}),
    };
}
