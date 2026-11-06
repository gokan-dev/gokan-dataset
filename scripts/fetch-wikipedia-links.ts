#!/usr/bin/env bun
// Snapshots, for every JLPT word's headword, the Chinese Wikipedia article linked to the Japanese
// article of exactly that title, through Wikidata's sitelinks (no redirect followed; a
// disambiguation page marked), into data/sources/wikipedia/ja-zh-sitelinks.json.gz (source
// wikipedia, a check only). Network, by hand; the build reads only the snapshot. Reads the
// headwords from compiled/, so run it after a build, then put the printed checksum and today's
// date in data/sources/wikipedia/source.json.
//
// Run: bun scripts/fetch-wikipedia-links.ts
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { CompiledJlptIndex, CompiledVocab } from '../src/models/compiled.model';

const COMPILED_DIR = './compiled';
const OUTPUT = './data/sources/wikipedia/ja-zh-sitelinks.json.gz';
const HEADERS = {
    'User-Agent': 'gokan-dataset/1.0 (https://github.com/gokan-dev/gokan-dataset)',
    Accept: 'application/sparql-results+json',
    'Content-Type': 'application/x-www-form-urlencoded',
};

function read<T>(file: string): T {
    // Output of this repository's own build, already typed by it.
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A SPARQL row's value for a variable, if bound. */
function valueOf(row: Record<string, unknown>, name: string): string | undefined {
    const b = row[name];
    return isRecord(b) && typeof b.value === 'string' ? b.value : undefined;
}

const titles = new Set<string>();
for (const entries of Object.values(read<CompiledJlptIndex>(path.join(COMPILED_DIR, 'index', 'jlpt.json')))) {
    for (const { id } of entries) titles.add(read<CompiledVocab>(path.join(COMPILED_DIR, 'vocab', `${id}.json`)).writtenForm.kanji);
}
const list = [...titles];
const result: Record<string, { zh?: string; disambiguation?: true; missing?: true }> = {};
for (const t of list) result[t] = { missing: true };
for (let i = 0; i < list.length; i += 800) {
    const values = list.slice(i, i + 800).map(t => `${JSON.stringify(t)}@ja`).join(' ');
    const query = `SELECT ?title ?zh ?disambig WHERE {
  VALUES ?title { ${values} }
  ?ja schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> ; schema:name ?title .
  OPTIONAL { ?zhs schema:about ?item ; schema:isPartOf <https://zh.wikipedia.org/> ; schema:name ?zh . }
  BIND(EXISTS { ?item wdt:P31 wd:Q4167410 } AS ?disambig)
}`;
    const response = await fetch('https://query.wikidata.org/sparql', { method: 'POST', headers: HEADERS, body: `query=${encodeURIComponent(query)}` });
    if (!response.ok) throw new Error(`Wikidata: HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const json: unknown = await response.json();
    const bindings = isRecord(json) && isRecord(json.results) ? json.results.bindings : undefined;
    if (!Array.isArray(bindings)) throw new Error('Wikidata: not a SPARQL result');
    for (const row of bindings.filter(isRecord)) {
        const title = valueOf(row, 'title');
        if (!title) continue;
        const zh = valueOf(row, 'zh');
        result[title] = { ...(zh ? { zh } : {}), ...(valueOf(row, 'disambig') === 'true' ? { disambiguation: true as const } : {}) };
    }
    // One request a second, as the query service asks.
    await new Promise(resolve => setTimeout(resolve, 1000));
}
const bytes = gzipSync(JSON.stringify(result));
fs.writeFileSync(OUTPUT, bytes);
const pages = Object.values(result);
console.log(`wikipedia: ${pages.length} titles, ${pages.filter(p => !p.missing).length} with a Japanese article, ${pages.filter(p => p.zh && !p.disambiguation).length} with a Chinese article -> ${OUTPUT}`);
console.log(`checksum: sha256:${createHash('sha256').update(bytes).digest('hex')}`);
