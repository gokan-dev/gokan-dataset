// JMdict's text in the text layer. The JMdict reader (scripts/build-data.ts) keeps its senses
// while it merges homographs, then makes them definitions here: one per JMdict entry a word
// holds, in each language the glosses are in, so every entry keeps its own id. Later stages read
// them back as senses with `jmdictSenses`, never from a field of their own.
import type { Definition, DefinitionSense, LanguageTag, TextByLanguage } from '../models/text.model';
import type { Sense } from '../models/vocabulary.model';
import { addRenderings, rendering, valueText } from './renderings';

/**
 * JMdict's gloss languages (ISO 639-2/B) as lowercase BCP 47 tags. An unknown one fails the
 * build rather than being guessed.
 */
const JMDICT_LANGUAGES: Record<string, LanguageTag> = {
    eng: 'en', dut: 'nl', fre: 'fr', ger: 'de', hun: 'hu', rus: 'ru', slv: 'sl', spa: 'es', swe: 'sv',
};

export function jmdictLanguage(code: string): LanguageTag {
    const tag = JMDICT_LANGUAGES[code];
    if (!tag) throw new Error(`JMdict gloss language "${code}" has no BCP 47 tag in src/text/jmdict.ts`);
    return tag;
}

/** A sense as the JMdict reader keeps it: which entry it belongs to, and its glosses' language. */
export interface JmdictSense extends Sense {
    entryId: string;
    lang: LanguageTag;
}

function definitionSense(sense: JmdictSense): DefinitionSense {
    return {
        glosses: sense.glosses,
        pos: sense.pos,
        misc: sense.misc,
        related: sense.related,
        ...(sense.appliesToReadings ? { appliesToReadings: sense.appliesToReadings } : {}),
    };
}

/**
 * A word's JMdict text: for each language, one definition per JMdict entry, in the order the
 * senses come (the word's own entry first, then each homograph merged into it). A merged entry
 * was attached by its spelling, the word's own by its id.
 */
export function jmdictText(wordId: string, senses: JmdictSense[]): TextByLanguage {
    const text: TextByLanguage = {};
    const languages = [...new Set(senses.map(s => s.lang))];
    for (const lang of languages) {
        const entries: { entryId: string; senses: JmdictSense[] }[] = [];
        for (const sense of senses.filter(s => s.lang === lang)) {
            const last = entries.at(-1);
            if (last?.entryId === sense.entryId) last.senses.push(sense);
            else entries.push({ entryId: sense.entryId, senses: [sense] });
        }
        addRenderings(text, lang, entries.map(entry => rendering<Definition>('vocab', wordId, lang, {
            role: 'definition',
            source: { source: 'jmdict', ref: entry.entryId },
            match: entry.entryId === wordId ? 'id' : 'spelling',
            status: 'imported',
            senses: entry.senses.map(definitionSense),
        })));
    }
    return text;
}

/** Every JMdict definition of a word in a language, in order. */
export function jmdictDefinitions(text: TextByLanguage | undefined, lang: LanguageTag = 'en'): Definition[] {
    return (text?.[lang]?.renderings ?? []).filter((r): r is Definition => r.role === 'definition' && r.source.source === 'jmdict');
}

/**
 * A word's JMdict senses in a language, every entry's in order, as plain senses. The build's
 * rules (usually-kana, near-synonyms, reading gates) were written for JMdict's English senses,
 * which is why their callers ask for `en`.
 */
export function jmdictSenses(text: TextByLanguage | undefined, lang: LanguageTag = 'en'): Sense[] {
    return jmdictDefinitions(text, lang).flatMap(d => d.senses.map(s => ({
        pos: s.pos ?? [],
        misc: s.misc ?? { rawTags: [] },
        glosses: s.glosses.map(valueText),
        related: s.related ?? { compounds: [] },
        ...(s.appliesToReadings ? { appliesToReadings: s.appliesToReadings } : {}),
    })));
}
