// The Chinese Wikipedia article linked to the Japanese article named exactly like each JLPT
// word's headword, through Wikidata's sitelinks (no redirects followed, disambiguation pages
// left out). Writes <outDir>/wikipedia.json. Usage: bun fetch-wikipedia-links.ts <compiledDir> <outDir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [compiledDir, outDir] = process.argv.slice(2);
if (!compiledDir || !outDir) throw new Error('usage: <compiledDir> <outDir>');
const headers = { 'User-Agent': 'gokan-dataset-research/0.1 (coverage benchmark)', Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' };

const jlpt = JSON.parse(readFileSync(join(compiledDir, 'index', 'jlpt.json'), 'utf8')) as Record<string, { id: string }[]>;
const titles = new Set<string>();
for (const entries of Object.values(jlpt)) {
    for (const { id } of entries) titles.add((JSON.parse(readFileSync(join(compiledDir, 'vocab', `${id}.json`), 'utf8')) as { writtenForm: { kanji: string } }).writtenForm.kanji);
}
const list = [...titles];
const result: Record<string, { zh?: string; disambiguation?: boolean; missing?: boolean }> = {};
for (const t of list) result[t] = { missing: true };
for (let i = 0; i < list.length; i += 800) {
    const values = list.slice(i, i + 800).map(t => JSON.stringify(t) + '@ja').join(' ');
    const query = `SELECT ?title ?zh ?disambig WHERE {
  VALUES ?title { ${values} }
  ?ja schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> ; schema:name ?title .
  OPTIONAL { ?zhs schema:about ?item ; schema:isPartOf <https://zh.wikipedia.org/> ; schema:name ?zh . }
  BIND(EXISTS { ?item wdt:P31 wd:Q4167410 } AS ?disambig)
}`;
    const res = await fetch('https://query.wikidata.org/sparql', { method: 'POST', headers, body: `query=${encodeURIComponent(query)}` });
    if (!res.ok) throw new Error(`wikidata ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { results: { bindings: Record<string, { value: string } | undefined>[] } };
    for (const b of json.results.bindings) {
        result[b.title!.value] = { zh: b.zh?.value, disambiguation: b.disambig?.value === 'true' || undefined };
    }
    await new Promise(r => setTimeout(r, 1000));
}
writeFileSync(join(outDir, 'wikipedia.json'), JSON.stringify(result));
const vals = Object.values(result);
console.log(`wikipedia: ${vals.length} titles, ${vals.filter(v => !v.missing).length} with a Japanese article, ${vals.filter(v => v.disambiguation).length} disambiguation, ${vals.filter(v => v.zh && !v.disambiguation).length} with a Chinese article`);
