// Assembles the Chinese text of a word or a sentence from what the matcher attached to it
// (docs/MULTILINGUAL.md, "Pipeline": assemble, then assess). Each source's text stays its own
// rendering; corroboration across communities sets its status and evidence; each value is filed
// under the language its characters show, converted to Simplified where the transform allows.
import type {
    Definition, DefinitionSense, Equivalent, LanguageTag, MatchEvidence, SourceId, SourceRef, TextByLanguage, TextStatus, Translation, Value,
} from '../models/text.model';
import { corroborations, type Claim } from './corroborate';
import { serveChinese, type HanVariants, type Served, type ServedText } from './hanScript';
import type { ChineseLanguage } from './jawiktionary';
import { addRenderings, definitionsOf, equivalentsOf, rendering, valueText } from './renderings';

/** The two files Mandarin is served in. */
export const MANDARIN_FILES = ['zh-hans', 'zh-hant'] as const;

/** One definition a source gives a word: its senses, as the source wrote them. */
export interface DefinitionInput {
    source: SourceId;
    ref: string;
    match: MatchEvidence;
    senses: {
        glosses: string[];
        tags: string[];
        spellings?: string[];
        pos?: string;
        /** The reading the source defines, when the word has several. */
        reading?: string;
    }[];
}

/** One equivalent a source gives a word. */
export interface EquivalentInput {
    source: SourceId;
    ref: string;
    match: MatchEvidence;
    value: string;
    lang: ChineseLanguage;
}

/** A text that may corroborate others but is never shown (Wikipedia's article titles). */
export interface CheckInput {
    source: SourceId;
    ref: string;
    text: string;
}

export interface WordInputs {
    definitions: DefinitionInput[];
    equivalents: EquivalentInput[];
    checks: CheckInput[];
}

/** What serving did, for the build log and the report: how many values the transform wrote, and what it could not. */
export interface ServeStats {
    converted: number;
    /** Renderings left out of zh-hans: a Traditional-only character with no single Simplified variant. */
    unconvertible: number;
    /** Renderings left out of zh-hant: written with Simplified-only characters. */
    simplifiedOnly: number;
}

export function serveStats(): ServeStats {
    return { converted: 0, unconvertible: 0, simplifiedOnly: 0 };
}

/** Counts what serving left out; `converted` counts the values written, which a caller dropping duplicates counts itself. */
function count(stats: ServeStats, served: Served, written = true): void {
    if (written) stats.converted += served.converted;
    if (served.unconvertible) stats.unconvertible++;
    if (!served['zh-hant']) stats.simplifiedOnly++;
}

function assessed(evidence: SourceRef[]): { status: TextStatus; evidence?: SourceRef[] } {
    return evidence.length > 0 ? { status: 'corroborated', evidence } : { status: 'imported' };
}

/** Each Mandarin file a value set goes to, with what it holds there. */
function servedFiles(served: Served): [LanguageTag, ServedText][] {
    return MANDARIN_FILES.flatMap(lang => {
        const text = served[lang];
        return text ? [[lang, text] as [LanguageTag, ServedText]] : [];
    });
}

/**
 * A word's Chinese text: each definition and equivalent a rendering of its own source, corroborated
 * by the other communities' texts (and the checks'), in the files its characters allow. Equivalents
 * repeating one already in the file from the same source and item are left out (書 and 书 both
 * become 书 in zh-hans).
 */
export function chineseWordText(wordId: string, inputs: WordInputs, communities: ReadonlyMap<SourceId, string>, v: HanVariants, stats: ServeStats): TextByLanguage {
    const community = (source: SourceId): string => {
        const c = communities.get(source);
        if (!c) throw new Error(`source ${source} has no community in data/sources/${source}/source.json`);
        return c;
    };
    const claims: Claim[] = [
        ...inputs.definitions.map(d => ({ community: community(d.source), language: 'zh', ref: { source: d.source, ref: d.ref }, texts: d.senses.flatMap(s => s.glosses) })),
        ...inputs.equivalents.map(e => ({ community: community(e.source), language: e.lang, ref: { source: e.source, ref: e.ref }, texts: [e.value] })),
        ...inputs.checks.map(c => ({ community: community(c.source), language: 'zh', ref: { source: c.source, ref: c.ref }, texts: [c.text] })),
    ];
    const evidence = corroborations(claims, v);
    const text: TextByLanguage = {};

    inputs.definitions.forEach((d, i) => {
        const served = serveChinese(d.senses.flatMap(s => s.glosses), v);
        count(stats, served);
        for (const [lang, { lang: valueLang, values }] of servedFiles(served)) {
            let at = 0;
            const senses: DefinitionSense[] = d.senses.map(s => {
                const glosses: Value[] = values.slice(at, at + s.glosses.length);
                at += s.glosses.length;
                return {
                    glosses,
                    ...(s.pos ? { pos: [s.pos] } : {}),
                    ...(s.reading ? { appliesToReadings: [s.reading] } : {}),
                    ...(s.spellings ? { appliesToSpellings: s.spellings } : {}),
                    ...(s.tags.length > 0 ? { tags: s.tags } : {}),
                };
            });
            addRenderings(text, lang, [rendering<Definition>('vocab', wordId, lang, {
                ...(valueLang ? { lang: valueLang } : {}),
                role: 'definition',
                source: { source: d.source, ref: d.ref },
                match: d.match,
                ...assessed(evidence[i] ?? []),
                senses,
            })]);
        }
    });

    const seen = new Set<string>();
    const addEquivalent = (lang: LanguageTag, e: EquivalentInput, value: Value, valueLang: LanguageTag | undefined, ev: SourceRef[]): void => {
        const key = `${lang}\u0000${e.source}\u0000${e.ref}\u0000${valueText(value)}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (typeof value !== 'string') stats.converted++;
        addRenderings(text, lang, [rendering<Equivalent>('vocab', wordId, lang, {
            ...(valueLang ? { lang: valueLang } : {}),
            role: 'equivalent',
            source: { source: e.source, ref: e.ref },
            match: e.match,
            ...assessed(ev),
            value,
        })]);
    };
    // Plain values first, so a converted one repeating a value the source also wrote is the one left out.
    const order = inputs.equivalents.map((e, i) => ({ e, i, served: e.lang === 'zh' ? serveChinese([e.value], v) : undefined }));
    for (const { served } of order) if (served) count(stats, served, false);
    for (const pass of ['plain', 'derived'] as const) {
        for (const { e, i, served } of order) {
            const ev = evidence[inputs.definitions.length + i] ?? [];
            if (!served) {
                if (pass === 'plain') addEquivalent(e.lang, e, e.value, undefined, ev);
                continue;
            }
            for (const [lang, { lang: valueLang, values }] of servedFiles(served)) {
                const [value] = values;
                if (value === undefined || (typeof value === 'string') !== (pass === 'plain')) continue;
                addEquivalent(lang, e, value, valueLang, ev);
            }
        }
    }
    return text;
}

/** One first-hand translation of a sentence. */
export interface TranslationInput {
    ref: string;
    text: string;
    direction: 'fromJapanese' | 'toJapanese';
}

/** A sentence's Chinese translations, each in the files its characters allow. */
export function chineseSentenceText(sentenceId: string, source: SourceId, translations: TranslationInput[], v: HanVariants, stats: ServeStats): TextByLanguage {
    const text: TextByLanguage = {};
    for (const t of translations) {
        const served = serveChinese([t.text], v);
        count(stats, served);
        for (const [lang, { lang: valueLang, values }] of servedFiles(served)) {
            const [value] = values;
            if (value === undefined) continue;
            addRenderings(text, lang, [rendering<Translation>('sentence', sentenceId, lang, {
                ...(valueLang ? { lang: valueLang } : {}),
                role: 'translation',
                source: { source, ref: t.ref },
                match: 'id',
                status: 'imported',
                value,
                direction: t.direction,
            })]);
        }
    }
    return text;
}

/**
 * A word's short gloss for search in one language: its first two corroborated equivalents, else
 * the first gloss of its first definition, else its first two equivalents. Equivalents are what a
 * reader types; a corroborated one is the likeliest to be right.
 */
export function searchGloss(text: TextByLanguage, lang: LanguageTag): string | undefined {
    const equivalents = equivalentsOf(text, lang);
    const distinct = (list: Equivalent[]): string[] => [...new Set(list.map(e => valueText(e.value)))].slice(0, 2);
    const corroborated = distinct(equivalents.filter(e => e.status === 'corroborated'));
    if (corroborated.length > 0) return corroborated.join('，');
    const first = definitionsOf(text, lang)[0]?.senses[0]?.glosses[0];
    if (first !== undefined) return valueText(first);
    const any = distinct(equivalents);
    return any.length > 0 ? any.join('，') : undefined;
}
