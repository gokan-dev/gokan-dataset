// Fetches Chinese equivalents from Wikidata (Japanese lexeme senses linked to a concept item,
// and that item's Chinese labels) and Wikipedia (the Chinese article a Japanese article links
// to, for every JLPT word's headword). Writes <outDir>/wikidata.json and <outDir>/wikipedia.json.
// Usage: bun fetch-wiki-sources.ts <compiledDir> <outDir>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [compiledDir, outDir] = process.argv.slice(2);
if (!compiledDir || !outDir) throw new Error('usage: <compiledDir> <outDir>');
const headers = { 'User-Agent': 'gokan-dataset-research/0.1 (coverage benchmark)', Accept: 'application/json' };

// --- Wikidata (skipped when already fetched).
if (!existsSync(join(outDir, 'wikidata.json'))) await fetchWikidata();
async function fetchWikidata() {
const sparql = `PREFIX ontolex: <http://www.w3.org/ns/lemon/ontolex#>
PREFIX dct: <http://purl.org/dc/terms/>
SELECT ?l ?lemma ?item ?zl WHERE {
  ?l dct:language wd:Q5287 ; wikibase:lemma ?lemma ; ontolex:sense ?s .
  ?s wdt:P5137 ?item .
  OPTIONAL { ?item rdfs:label ?zl . FILTER(LANG(?zl) IN ("zh","zh-hans","zh-cn","zh-sg","zh-my","zh-hant","zh-tw","zh-hk","zh-mo")) }
}`;
const wd = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, { headers });
if (!wd.ok) throw new Error(`wikidata ${wd.status}`);
interface Binding { value: string; 'xml:lang'?: string }
const wdJson = (await wd.json()) as { results: { bindings: Record<string, Binding | undefined>[] } };
const lexemes = new Map<string, { lemmas: Record<string, string>; zh: Set<string>; items: Set<string> }>();
for (const b of wdJson.results.bindings) {
    const id = b.l!.value.split('/').pop()!;
    const lex = lexemes.get(id) ?? { lemmas: {}, zh: new Set<string>(), items: new Set<string>() };
    lex.lemmas[b.lemma!['xml:lang'] ?? '?'] = b.lemma!.value;
    lex.items.add(b.item!.value.split('/').pop()!);
    if (b.zl) lex.zh.add(b.zl.value);
    lexemes.set(id, lex);
}
writeFileSync(join(outDir, 'wikidata.json'), JSON.stringify([...lexemes].map(([id, x]) => ({ id, lemmas: x.lemmas, items: [...x.items], zh: [...x.zh] }))));
console.log(`wikidata: ${wdJson.results.bindings.length} rows, ${lexemes.size} lexemes, ${[...lexemes.values()].filter(x => x.zh.size).length} with a Chinese label`);
}

// One request at a time, a second apart, waiting out a 429 as the API asks.
async function politeFetch(url: string): Promise<Response> {
    for (let attempt = 0; attempt < 6; attempt++) {
        const res = await fetch(url, { headers });
        if (res.status !== 429) return res;
        const wait = Number(res.headers.get('retry-after') ?? '0') || 5 * 2 ** attempt;
        console.log(`429, waiting ${wait}s`);
        await new Promise(r => setTimeout(r, wait * 1000));
    }
    throw new Error('wikipedia: still rate limited');
}

// --- Wikipedia, for the JLPT words' headwords.
const jlpt = JSON.parse(readFileSync(join(compiledDir, 'index', 'jlpt.json'), 'utf8')) as Record<string, { id: string }[]>;
const titles = new Set<string>();
for (const entries of Object.values(jlpt)) {
    for (const { id } of entries) {
        const v = JSON.parse(readFileSync(join(compiledDir, 'vocab', `${id}.json`), 'utf8')) as { writtenForm: { kanji: string } };
        titles.add(v.writtenForm.kanji);
    }
}
interface Page { title: string; missing?: string; pageprops?: { disambiguation?: string }; langlinks?: { '*': string }[] }
const result: Record<string, { target?: string; zh?: string; disambiguation?: boolean; missing?: boolean }> = {};
const list = [...titles];
for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    const url = `https://ja.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=langlinks|pageprops&ppprop=disambiguation&lllang=zh&lllimit=max&titles=${encodeURIComponent(batch.join('|'))}`;
    const res = await politeFetch(url);
    if (!res.ok) throw new Error(`wikipedia ${res.status}`);
    const json = (await res.json()) as { query: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages: Record<string, Page> } };
    const forward = new Map<string, string>();
    for (const n of json.query.normalized ?? []) forward.set(n.from, n.to);
    for (const r of json.query.redirects ?? []) forward.set(r.from, r.to);
    const pages = new Map(Object.values(json.query.pages).map(p => [p.title, p]));
    for (const title of batch) {
        let target = title;
        for (let hops = 0; forward.has(target) && hops < 3; hops++) target = forward.get(target)!;
        const page = pages.get(target);
        result[title] = {
            target: target === title ? undefined : target,
            zh: page?.langlinks?.[0]?.['*'],
            disambiguation: page?.pageprops?.disambiguation !== undefined || undefined,
            missing: page === undefined || page.missing !== undefined || undefined,
        };
    }
    await new Promise(r => setTimeout(r, 1000));
}
writeFileSync(join(outDir, 'wikipedia.json'), JSON.stringify(result));
const vals = Object.values(result);
console.log(`wikipedia: ${vals.length} titles, ${vals.filter(v => !v.missing).length} articles, ${vals.filter(v => v.zh && !v.disambiguation).length} with a Chinese link, ${vals.filter(v => v.zh && v.target).length} of those through a redirect`);
