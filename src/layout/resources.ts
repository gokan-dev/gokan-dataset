// Every compiled file type: its path pattern and the type its files have (src/models/
// compiled.model.ts). The datapackage, the schemas and the schema check all read this one table,
// so a file type cannot have a schema that describes another, or none.

/** A pattern names a file relative to compiled/; `{name}` stands for one path segment. */
export interface Resource {
    pattern: string;
    /** The exported type in src/models/compiled.model.ts its files have. */
    type: string;
}

export const RESOURCES: readonly Resource[] = [
    { pattern: 'vocab/{wordId}.json', type: 'CompiledVocab' },
    { pattern: 'kanji/{character}.json', type: 'CompiledKanji' },
    { pattern: 'kanji.json', type: 'CompiledKanjiList' },
    { pattern: 'sentences/{wordId}.json', type: 'CompiledSentences' },
    { pattern: 'grammar/points/{pointId}.json', type: 'CompiledGrammarPoint' },
    { pattern: 'grammar/mined/{pointId}.json', type: 'CompiledGrammarExamples' },
    { pattern: 'grammar/slots.json', type: 'CompiledGrammarSlots' },
    { pattern: 'grammar/conjugations.json', type: 'CompiledGrammarConjugations' },
    { pattern: 'grammar/index/aliases.json', type: 'CompiledGrammarAliases' },
    { pattern: 'grammar/index/browse.json', type: 'CompiledGrammarBrowse' },
    { pattern: 'grammar/index/contrasts.json', type: 'CompiledGrammarContrasts' },
    { pattern: 'grammar/index/families.json', type: 'CompiledGrammarFamilies' },
    { pattern: 'grammar/index/jlpt.json', type: 'CompiledGrammarJlpt' },
    { pattern: 'grammar/index/kinds.json', type: 'CompiledGrammarKinds' },
    { pattern: 'grammar/index/teaching-order.json', type: 'CompiledGrammarTeachingOrder' },
    { pattern: 'grammar/index/variant-groups.json', type: 'CompiledGrammarVariantGroups' },
    { pattern: 'media/index.json', type: 'CompiledMediaIndex' },
    { pattern: 'media/library.json', type: 'CompiledMediaLibrary' },
    { pattern: 'media/{titleId}.json', type: 'CompiledMediaTitle' },
    { pattern: 'index/audio.json', type: 'CompiledAudioIndex' },
    { pattern: 'index/frequency.json', type: 'CompiledFrequencyIndex' },
    { pattern: 'index/jlpt.json', type: 'CompiledJlptIndex' },
    { pattern: 'index/kanji-components.json', type: 'CompiledKanjiComponents' },
    { pattern: 'index/kanji-orders/{order}.json', type: 'CompiledKanjiOrder' },
    { pattern: 'index/kanji-vocab.json', type: 'CompiledKanjiVocabIndex' },
    { pattern: 'index/kklc-kanji.json', type: 'CompiledKklcKanjiIndex' },
    { pattern: 'index/kklc.json', type: 'CompiledKklcIndex' },
    { pattern: 'index/merged-map.json', type: 'CompiledMergedMap' },
    { pattern: 'index/search.json', type: 'CompiledSearchIndex' },
    { pattern: 'text/{lang}/index/entities.json', type: 'CompiledEntitiesIndex' },
    { pattern: 'text/{lang}/index/search.json', type: 'CompiledSearchGlosses' },
    { pattern: 'text/{lang}/grammar/index/browse.json', type: 'CompiledGrammarBrowseTexts' },
    // Every other file under text/{lang}/ is a text file.
    { pattern: 'text/{lang}/**', type: 'CompiledTextFile' },
];

/** The schema file of a type, relative to compiled/. */
export function schemaPath(type: string): string {
    return `schemas/${type}.schema.json`;
}

function regexOf(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^$()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\{[^}]+\}/g, '[^/]+').replace(/\u0000/g, '.+');
    return new RegExp(`^${escaped}$`);
}

const MATCHERS = RESOURCES.map(r => ({ resource: r, regex: regexOf(r.pattern) }));

/** The resource a compiled file belongs to: the first pattern that matches it, the most specific first. */
export function resourceOf(relative: string): Resource | undefined {
    // media/index.json and media/library.json come before media/{titleId}.json in RESOURCES.
    return MATCHERS.find(m => m.regex.test(relative))?.resource;
}
