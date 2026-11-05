#!/usr/bin/env bun
// compiled/datapackage.json (decision D10): a Frictionless Data Package describing the compiled
// dataset, so a consumer outside this repository can find what each file type is, which
// languages it comes in, and where every text came from and under which licence.
//
// One resource per file type, not per file (there are about 150,000): a resource's path pattern
// is kept in the `gokan:pathPattern` extension property, since a Data Package path names one
// file. No date or build id is written, so an unchanged build leaves this file unchanged.
//
// Run: bun run build:datapackage (the last step of bun run build).
import fs from 'node:fs';
import path from 'node:path';
import { resourceOf, schemaPath } from '../src/layout/resources';

const COMPILED_DIR = './compiled';
const SOURCES_DIR = './data/sources';
const OUTPUT = path.join(COMPILED_DIR, 'datapackage.json');

/** Directories holding one file per entity: their files share one pattern. */
const COLLECTIONS: Record<string, string> = {
    vocab: '{wordId}',
    kanji: '{character}',
    sentences: '{wordId}',
    'grammar/points': '{pointId}',
    'grammar/mined': '{pointId}',
    'index/kanji-orders': '{order}',
    media: '{titleId}',
};
/** Files in a collection's directory that are not entities. */
const NOT_ENTITIES = new Set(['media/index.json', 'media/library.json']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(relative: string): string[] {
    return fs.readdirSync(path.join(COMPILED_DIR, relative), { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .flatMap(entry => {
            const rel = relative ? `${relative}/${entry.name}` : entry.name;
            return entry.isDirectory() ? walk(rel) : [rel];
        });
}

/** A file's pattern: its language as {lang}, its name as its collection's placeholder. */
function patternOf(file: string): { pattern: string; lang?: string } {
    const text = /^text\/([^/]+)\/(.+)$/.exec(file);
    const corePath = text?.[2] ?? file;
    const dir = path.posix.dirname(corePath);
    const placeholder = COLLECTIONS[dir];
    const named = placeholder && !NOT_ENTITIES.has(corePath) ? `${dir}/${placeholder}.json` : corePath;
    return text ? { pattern: `text/{lang}/${named}`, lang: text[1] } : { pattern: named };
}

const resources = new Map<string, { files: number; languages: Set<string>; type: string }>();
for (const file of walk('')) {
    if (file === 'datapackage.json' || file.startsWith('schemas/')) continue;
    const { pattern, lang } = patternOf(file);
    const type = resourceOf(file)?.type;
    if (!type) throw new Error(`: no file type in src/layout/resources.ts matches it`);
    const resource = resources.get(pattern) ?? { files: 0, languages: new Set<string>(), type };
    resource.files++;
    if (lang) resource.languages.add(lang);
    resources.set(pattern, resource);
}

const sources = fs.readdirSync(SOURCES_DIR).sort().flatMap(id => {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, id, 'source.json'), 'utf8'));
    if (!isRecord(raw)) return [];
    return [{
        title: typeof raw.name === 'string' ? raw.name : id,
        ...(typeof raw.url === 'string' ? { path: raw.url } : {}),
        'gokan:id': id,
        'gokan:license': raw.license,
        ...(typeof raw.licenseNote === 'string' ? { 'gokan:licenseNote': raw.licenseNote } : {}),
        ...(Array.isArray(raw.languages) ? { 'gokan:languages': raw.languages } : {}),
    }];
});

const datapackage = {
    $schema: 'https://datapackage.org/profiles/2.0/datapackage.json',
    name: 'gokan-dataset',
    title: 'Gokan dataset: Japanese words, kanji, sentences, grammar and media, explained per language',
    homepage: 'https://github.com/gokan-dev/gokan-dataset',
    licenses: [{ name: 'CC-BY-SA-4.0', path: 'https://creativecommons.org/licenses/by-sa/4.0/', title: 'Creative Commons Attribution-ShareAlike 4.0' }],
    sources,
    resources: [...resources].sort(([a], [b]) => (a < b ? -1 : 1)).map(([pattern, { files, languages, type }]) => ({
        name: pattern.replace(/\.json$/, '').replace(/[{}]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(),
        path: pattern.replace(/\{[^}]+\}/g, 'example'),
        'gokan:pathPattern': pattern,
        format: 'json',
        mediatype: 'application/json',
        schema: schemaPath(type),
        'gokan:files': files,
        ...(languages.size > 0 ? { 'gokan:languages': [...languages].sort() } : {}),
    })),
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(datapackage, null, 2)}\n`);
console.log(`[datapackage] ${datapackage.resources.length} resources, ${sources.length} sources -> ${OUTPUT}`);
