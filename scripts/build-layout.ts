#!/usr/bin/env bun
// The last build stage (docs/MULTILINGUAL.md, "Compiled output"). Every earlier stage writes
// the dataset as it assembles it to build/assembled/ (not committed), each entity carrying its
// explanation-language text in `text`, by language. This one writes compiled/: each entity file
// as its language-neutral core, at its usual path, and for every language present a text file
// under compiled/text/<lang>/ at the same path, plus the list of files that have text in each
// language. No language is named here: whatever languages the sources gave come out.
//
// Files with no text (media, the other indexes) are copied as they are.
//
// Run: bun run build:layout (the last step of bun run build).
import fs from 'node:fs';
import path from 'node:path';
import { TEXT_HOLDERS, splitText, type HolderSpec } from '../src/layout/textHolders';
import type { AssembledGrammarBrowseRow, GrammarBrowseIndex, GrammarBrowseRow, GrammarBrowseTexts } from '../src/models/grammar.model';
import type { AssembledSearchIndexEntry, SearchGlosses, SearchIndexEntry } from '../src/models/index.model';
import type { Kanji } from '../src/models/kanji.model';
import type { Sentence } from '../src/models/sentence.model';
import type { EntityKind, EntityText, LanguageTag, TextByLanguage, TextFile } from '../src/models/text.model';
import type { Vocabulary } from '../src/models/vocabulary.model';

const ASSEMBLED_DIR = './build/assembled';
const COMPILED_DIR = './compiled';
const TEXT_DIR = path.join(COMPILED_DIR, 'text');

/** The paths, relative to compiled/, whose files are split; everything else is copied. */
const SPLIT = {
    vocab: 'vocab', kanji: 'kanji', kanjiList: 'kanji.json', sentences: 'sentences', search: 'index/search.json',
    grammarBrowse: 'grammar/index/browse.json',
} as const;
const SPLIT_PATHS: string[] = [...Object.values(SPLIT), ...TEXT_HOLDERS.map(s => s.path)];

/** One entity of a file: its core, its id, and its text by language. */
interface Split<Core> {
    id: string;
    core: Core;
    text: TextByLanguage;
}

/** The core files and, per language, the ids of the files with text in it. */
const filesWithText: Record<LanguageTag, Record<string, string[]>> = {};
let written = 0;

function writeJson(file: string, value: unknown, indented: boolean): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, indented ? JSON.stringify(value, null, 2) : JSON.stringify(value));
    written++;
}

function readJson<T>(file: string): T {
    // Output of this repository's own earlier stages, already typed by them.
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function jsonFiles(dir: string): string[] {
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
}

/**
 * Writes one assembled file: its core at `relative`, and in every language one of its entities has
 * text in, that language's text file at the same path. `group` names the file in the language's
 * list of files with text (`vocab`, `kanji`, `sentences`).
 */
function writeSplit<Core>(relative: string, kind: EntityKind, entities: Split<Core>[], options: { list: boolean; indented: boolean; group?: string }): void {
    const cores = entities.map(e => e.core);
    writeJson(path.join(COMPILED_DIR, relative), options.list ? cores : cores[0], options.indented);

    const languages = [...new Set(entities.flatMap(e => Object.keys(e.text)))].sort();
    for (const lang of languages) {
        const byId: Record<string, EntityText> = {};
        for (const e of entities) {
            const text = e.text[lang];
            if (text && (text.renderings.length > 0 || text.synonyms !== undefined)) byId[e.id] = text;
        }
        if (Object.keys(byId).length === 0) continue;
        const file: TextFile = { kind, lang, entities: byId };
        // Compact: text files are read by programs, and indentation was most of their size.
        writeJson(path.join(TEXT_DIR, lang, relative), file, false);
        if (options.group) ((filesWithText[lang] ??= {})[options.group] ??= []).push(path.basename(relative, '.json'));
    }
}

/** The entity without its text, and its text. */
function withoutText<T extends { text: TextByLanguage }>(entity: T): { core: Omit<T, 'text'>; text: TextByLanguage } {
    const { text, ...core } = entity;
    return { core, text };
}

/**
 * Writes a file whose text sits on objects inside it (src/layout/textHolders.ts): its core at
 * `relative`, compact as the grammar build writes it, and each language's text file beside it.
 */
function writeHolders(relative: string, spec: HolderSpec, group?: string): void {
    const file: unknown = readJson(path.join(ASSEMBLED_DIR, relative));
    const name = path.basename(relative, '.json');
    const byLang = splitText(file, spec, name);
    writeJson(path.join(COMPILED_DIR, relative), file, false);
    for (const [lang, entities] of Object.entries(byLang).sort(([a], [b]) => (a < b ? -1 : 1))) {
        const textFile: TextFile = { kind: spec.kind, lang, entities };
        writeJson(path.join(TEXT_DIR, lang, relative), textFile, false);
        if (group && (spec.isPage?.(name) ?? true)) ((filesWithText[lang] ??= {})[group] ??= []).push(name);
    }
}

/** Copies everything that is not split, skipping the build's logs. */
function copyUnsplit(from: string, to: string, relative = ''): number {
    let copied = 0;
    for (const entry of fs.readdirSync(path.join(from, relative), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const rel = path.join(relative, entry.name).split(path.sep).join('/');
        if (SPLIT_PATHS.includes(rel)) continue;
        if (entry.isDirectory()) {
            copied += copyUnsplit(from, to, rel);
        } else if (!entry.name.endsWith('.log')) {
            fs.mkdirSync(path.join(to, relative), { recursive: true });
            fs.copyFileSync(path.join(from, rel), path.join(to, rel));
            copied++;
        }
    }
    return copied;
}

function main(): void {
    if (!fs.existsSync(ASSEMBLED_DIR)) throw new Error(`${ASSEMBLED_DIR} not found: run bun run build.`);
    // Empties compiled/ rather than deleting it: Windows refuses to remove a folder an editor or a
    // shell has open, but not what is inside it.
    fs.mkdirSync(COMPILED_DIR, { recursive: true });
    // maxRetries: on Windows a scanner or an indexer holding a file open fails the removal with
    // EBUSY for a moment; Node retries it, with a growing delay, instead of failing the build.
    for (const entry of fs.readdirSync(COMPILED_DIR)) fs.rmSync(path.join(COMPILED_DIR, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

    for (const f of jsonFiles(path.join(ASSEMBLED_DIR, SPLIT.vocab))) {
        const vocab = readJson<Vocabulary>(path.join(ASSEMBLED_DIR, SPLIT.vocab, f));
        writeSplit(`${SPLIT.vocab}/${f}`, 'vocab', [{ id: vocab.id, ...withoutText(vocab) }], { list: false, indented: false, group: 'vocab' });
    }

    for (const f of jsonFiles(path.join(ASSEMBLED_DIR, SPLIT.kanji))) {
        const kanji = readJson<Kanji>(path.join(ASSEMBLED_DIR, SPLIT.kanji, f));
        writeSplit(`${SPLIT.kanji}/${f}`, 'kanji', [{ id: kanji.character, ...withoutText(kanji) }], { list: false, indented: true, group: 'kanji' });
    }
    const kanjiList = readJson<Kanji[]>(path.join(ASSEMBLED_DIR, SPLIT.kanjiList));
    writeSplit(SPLIT.kanjiList, 'kanji', kanjiList.map(k => ({ id: k.character, ...withoutText(k) })), { list: true, indented: true });

    for (const f of jsonFiles(path.join(ASSEMBLED_DIR, SPLIT.sentences))) {
        const sentences = readJson<Sentence[]>(path.join(ASSEMBLED_DIR, SPLIT.sentences, f));
        const split = sentences.map(s => ({ id: s.id, ...withoutText(s) }));
        writeSplit(`${SPLIT.sentences}/${f}`, 'sentence', split, { list: true, indented: true, group: 'sentences' });
    }

    // The search index: each word's short gloss goes to its language's index.
    const search = readJson<AssembledSearchIndexEntry[]>(path.join(ASSEMBLED_DIR, SPLIT.search));
    const glossesByLang: Record<LanguageTag, SearchGlosses> = {};
    const searchCore: SearchIndexEntry[] = search.map(({ m, ...entry }) => {
        for (const [lang, gloss] of Object.entries(m)) (glossesByLang[lang] ??= {})[entry.id] = gloss;
        return entry;
    });
    writeJson(path.join(COMPILED_DIR, SPLIT.search), searchCore, false);
    for (const [lang, glosses] of Object.entries(glossesByLang)) writeJson(path.join(TEXT_DIR, lang, SPLIT.search), glosses, false);

    // Grammar (points and their examples, mined examples, the indexes with text) and media.
    for (const spec of TEXT_HOLDERS) {
        const at = path.join(ASSEMBLED_DIR, spec.path);
        if (!fs.existsSync(at)) continue;
        if (fs.statSync(at).isDirectory()) {
            for (const f of jsonFiles(at)) writeHolders(`${spec.path}/${f}`, spec, spec.group);
        } else {
            writeHolders(spec.path, spec);
        }
    }

    // The grammar browse index, like the search index: each row's text goes to its language's index.
    const browse = readJson<GrammarBrowseIndex<AssembledGrammarBrowseRow>>(path.join(ASSEMBLED_DIR, SPLIT.grammarBrowse));
    const browseByLang: Record<LanguageTag, GrammarBrowseTexts> = {};
    const browseCore: GrammarBrowseIndex<GrammarBrowseRow> = {
        ...browse,
        points: browse.points.map(({ text, ...row }) => {
            for (const [lang, fields] of Object.entries(text)) (browseByLang[lang] ??= {})[row.id] = fields;
            return row;
        }),
    };
    writeJson(path.join(COMPILED_DIR, SPLIT.grammarBrowse), browseCore, false);
    for (const [lang, texts] of Object.entries(browseByLang).sort(([a], [b]) => (a < b ? -1 : 1))) writeJson(path.join(TEXT_DIR, lang, SPLIT.grammarBrowse), texts, false);

    // Which core files have text in each language: the pages that exist in it.
    for (const [lang, groups] of Object.entries(filesWithText).sort(([a], [b]) => (a < b ? -1 : 1))) {
        writeJson(path.join(TEXT_DIR, lang, 'index', 'entities.json'), groups, true);
    }

    const copied = copyUnsplit(ASSEMBLED_DIR, COMPILED_DIR);
    const summary = Object.entries(filesWithText)
        .map(([lang, groups]) => `${lang}: ${Object.entries(groups).map(([g, ids]) => `${ids.length} ${g}`).join(', ')}`)
        .join('; ');
    console.log(`[layout] wrote ${written} split files (${summary}); copied ${copied} other files as they are.`);
}

main();
