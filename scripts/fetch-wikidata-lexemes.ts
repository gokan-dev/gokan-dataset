#!/usr/bin/env bun
// Snapshots Wikidata's Japanese lexemes whose sense links a concept item (P5137), with that item's
// Chinese labels, into data/sources/wikidata/lexemes-zh.json.gz (source wikidata). Network, by
// hand, like every fetch; the build reads only the snapshot. After running it, put the printed
// checksum and today's date in data/sources/wikidata/source.json.
//
// Run: bun scripts/fetch-wikidata-lexemes.ts
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';

const OUTPUT = './data/sources/wikidata/lexemes-zh.json.gz';
const HEADERS = { 'User-Agent': 'gokan-dataset/1.0 (https://github.com/gokan-dev/gokan-dataset)', Accept: 'application/sparql-results+json' };
const QUERY = `PREFIX ontolex: <http://www.w3.org/ns/lemon/ontolex#>
PREFIX dct: <http://purl.org/dc/terms/>
SELECT ?l ?lemma ?item ?zl WHERE {
  ?l dct:language wd:Q5287 ; wikibase:lemma ?lemma ; ontolex:sense ?s .
  ?s wdt:P5137 ?item .
  OPTIONAL { ?item rdfs:label ?zl . FILTER(LANG(?zl) IN ("zh","zh-hans","zh-cn","zh-sg","zh-my","zh-hant","zh-tw","zh-hk","zh-mo")) }
}`;

interface Binding { value: string; lang?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function binding(value: unknown): Binding | undefined {
    if (!isRecord(value) || typeof value.value !== 'string') return undefined;
    const lang = value['xml:lang'];
    return { value: value.value, ...(typeof lang === 'string' ? { lang } : {}) };
}

/** The SPARQL result's rows, narrowed: each a map of variable to binding. */
function rows(json: unknown): Map<string, Binding>[] {
    const results = isRecord(json) && isRecord(json.results) ? json.results.bindings : undefined;
    if (!Array.isArray(results)) throw new Error('Wikidata: not a SPARQL result');
    return results.filter(isRecord).map(row => new Map(Object.entries(row).flatMap(([k, v]) => {
        const b = binding(v);
        return b ? [[k, b] as const] : [];
    })));
}

const lastSegment = (uri: string): string => uri.split('/').pop() ?? uri;

const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(QUERY)}`, { headers: HEADERS });
if (!response.ok) throw new Error(`Wikidata: HTTP ${response.status}`);
const lexemes = new Map<string, { lemmas: Record<string, string>; items: Set<string>; zh: Set<string> }>();
for (const row of rows(await response.json())) {
    const l = row.get('l');
    const lemma = row.get('lemma');
    const item = row.get('item');
    if (!l || !lemma || !item) continue;
    const id = lastSegment(l.value);
    const lexeme = lexemes.get(id) ?? { lemmas: {}, items: new Set<string>(), zh: new Set<string>() };
    lexeme.lemmas[lemma.lang ?? '?'] = lemma.value;
    lexeme.items.add(lastSegment(item.value));
    const label = row.get('zl');
    if (label) lexeme.zh.add(label.value);
    lexemes.set(id, lexeme);
}
const snapshot = [...lexemes].map(([id, x]) => ({ id, lemmas: x.lemmas, items: [...x.items], zh: [...x.zh] }));
const bytes = gzipSync(JSON.stringify(snapshot));
fs.writeFileSync(OUTPUT, bytes);
console.log(`wikidata: ${snapshot.length} lexemes, ${snapshot.filter(x => x.zh.length > 0).length} with a Chinese label -> ${OUTPUT}`);
console.log(`checksum: sha256:${createHash('sha256').update(bytes).digest('hex')}`);
