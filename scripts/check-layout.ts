#!/usr/bin/env bun
// Proves the layout loses nothing: every split file in compiled/, joined back with its text in
// every language, equals what the build assembled in build/assembled/.
//
// Run: bun run check:layout (after bun run build).
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { TEXT_HOLDERS, joinText, type HolderSpec } from '../src/layout/textHolders';
import type { GrammarBrowseIndex, GrammarBrowseText, GrammarBrowseTexts } from '../src/models/grammar.model';
import type { AssembledSearchIndexEntry, SearchGlosses, SearchIndexEntry } from '../src/models/index.model';
import type { EntityText, TextByLanguage, TextFile } from '../src/models/text.model';

const ASSEMBLED_DIR = './build/assembled';
const COMPILED_DIR = './compiled';
const TEXT_DIR = path.join(COMPILED_DIR, 'text');
const LANGUAGES = fs.existsSync(TEXT_DIR) ? fs.readdirSync(TEXT_DIR).sort() : [];

function read<T>(file: string): T {
    // Output of this repository's own build, already typed by it.
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/** Every language's text file at one path. */
function textFiles(relative: string): Map<string, TextFile> {
    const files = new Map<string, TextFile>();
    for (const lang of LANGUAGES) {
        const file = path.join(TEXT_DIR, lang, relative);
        if (fs.existsSync(file)) files.set(lang, read<TextFile>(file));
    }
    return files;
}

/** An entity's core joined with its text in every language. */
function joined<Core extends object>(core: Core, id: string, files: Map<string, TextFile>): Core & { text: TextByLanguage } {
    const text: TextByLanguage = {};
    for (const [lang, file] of files) {
        const entity = file.entities[id];
        if (entity) text[lang] = entity;
    }
    return { ...core, text };
}

const failures: string[] = [];
let checked = 0;
function expectSame(label: string, a: unknown, b: unknown): void {
    checked++;
    if (!isDeepStrictEqual(a, b)) failures.push(label);
}

function jsonFiles(dir: string): string[] {
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
}

/** One entity per file (words, kanji). */
for (const [dir, idKey] of [['vocab', 'id'], ['kanji', 'character']] as const) {
    for (const f of jsonFiles(path.join(ASSEMBLED_DIR, dir))) {
        const core = read<Record<string, string>>(path.join(COMPILED_DIR, dir, f));
        expectSame(`${dir}/${f}`, joined(core, core[idKey] ?? '', textFiles(`${dir}/${f}`)), read(path.join(ASSEMBLED_DIR, dir, f)));
    }
}

/** A list of entities per file (kanji.json, a word's sentences). */
function checkList(relative: string, idKey: 'character' | 'id'): void {
    const files = textFiles(relative);
    const cores = read<Record<string, string>[]>(path.join(COMPILED_DIR, relative));
    expectSame(relative, cores.map(core => joined(core, core[idKey] ?? '', files)), read(path.join(ASSEMBLED_DIR, relative)));
}
checkList('kanji.json', 'character');
for (const f of jsonFiles(path.join(ASSEMBLED_DIR, 'sentences'))) checkList(`sentences/${f}`, 'id');

/** A file whose text sits on objects inside it (src/layout/textHolders.ts), joined back. */
function checkHolders(relative: string, spec: HolderSpec): void {
    const byLang: Record<string, Record<string, EntityText>> = {};
    for (const [lang, file] of textFiles(relative)) byLang[lang] = file.entities;
    const core: unknown = read(path.join(COMPILED_DIR, relative));
    joinText(core, spec, path.basename(relative, '.json'), byLang);
    expectSame(relative, core, read(path.join(ASSEMBLED_DIR, relative)));
}
for (const spec of TEXT_HOLDERS) {
    const at = path.join(ASSEMBLED_DIR, spec.path);
    if (!fs.existsSync(at)) continue;
    if (fs.statSync(at).isDirectory()) for (const f of jsonFiles(at)) checkHolders(`${spec.path}/${f}`, spec);
    else checkHolders(spec.path, spec);
}

{
    const relative = 'grammar/index/browse.json';
    const texts = new Map(LANGUAGES.filter(lang => fs.existsSync(path.join(TEXT_DIR, lang, relative))).map(lang => [lang, read<GrammarBrowseTexts>(path.join(TEXT_DIR, lang, relative))]));
    const core = read<GrammarBrowseIndex>(path.join(COMPILED_DIR, relative));
    const joinedBrowse = {
        ...core,
        points: core.points.map(row => {
            const text: Record<string, GrammarBrowseText> = {};
            for (const [lang, byId] of texts) { const fields = byId[row.id]; if (fields) text[lang] = fields; }
            return { ...row, text };
        }),
    };
    expectSame(relative, joinedBrowse, read(path.join(ASSEMBLED_DIR, relative)));
}

{
    const glosses = new Map(LANGUAGES.filter(lang => fs.existsSync(path.join(TEXT_DIR, lang, 'index/search.json'))).map(lang => [lang, read<SearchGlosses>(path.join(TEXT_DIR, lang, 'index/search.json'))]));
    const search = read<SearchIndexEntry[]>(path.join(COMPILED_DIR, 'index/search.json')).map(entry => {
        const m: Record<string, string> = {};
        for (const [lang, byId] of glosses) if (byId[entry.id] !== undefined) m[lang] = byId[entry.id] ?? '';
        return { ...entry, m };
    });
    expectSame('index/search.json', search, read<AssembledSearchIndexEntry[]>(path.join(ASSEMBLED_DIR, 'index/search.json')));
}

if (failures.length > 0) {
    console.error(`[check-layout] ${failures.length} of ${checked} files differ after joining, such as:\n  ${failures.slice(0, 10).join('\n  ')}`);
    process.exit(1);
}
console.log(`[check-layout] all ${checked} split files join back to exactly what the build assembled (languages: ${LANGUAGES.join(', ')}).`);
