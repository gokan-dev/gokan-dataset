// Measures how many Gokan words could get a first-hand Chinese example sentence from Tatoeba.
// Usage: bun tatoeba-zh-coverage.ts <compiledDir> <tatoebaDir>
import { readdirSync, readFileSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const [compiledDir, tatoebaDir] = process.argv.slice(2);
if (!compiledDir || !tatoebaDir) throw new Error('usage: <compiledDir> <tatoebaDir>');

function tsvRows(file: string): string[][] {
    return readFileSync(join(tatoebaDir, file), 'utf8').split('\n').filter(Boolean).map(line => line.split('\t'));
}

// --- Gokan side: words, JLPT levels, and the Japanese sentence pool with the words each contains.
const vocabIds = readdirSync(join(compiledDir, 'vocab')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
const levelOf = new Map<string, number>();
const jlptRaw: unknown = JSON.parse(readFileSync(join(compiledDir, 'index', 'jlpt.json'), 'utf8'));
for (const [level, entries] of Object.entries(jlptRaw as Record<string, { id: string }[]>)) {
    for (const entry of entries) levelOf.set(entry.id, Number(level));
}

interface PoolSentence { id: string; vocabIds: string[] }
const pool = new Map<string, string[]>();
const shownFor = new Map<string, Set<string>>(); // vocabId -> sentence ids its own file lists
for (const file of readdirSync(join(compiledDir, 'sentences'))) {
    if (!file.endsWith('.json')) continue;
    const vocabId = file.slice(0, -5);
    const sentences = JSON.parse(readFileSync(join(compiledDir, 'sentences', file), 'utf8')) as PoolSentence[];
    shownFor.set(vocabId, new Set(sentences.map(s => s.id)));
    for (const s of sentences) pool.set(s.id, s.vocabIds);
}

// --- Tatoeba side.
const jpn = new Map(tsvRows('jpn_sentences.tsv').map(([id, , text]) => [id, text]));
const cmn = new Map(tsvRows('cmn_sentences.tsv').map(([id, , text]) => [id, text]));
const links = tsvRows('jpn-cmn_links.tsv').map(([j, c]) => ({ j, c }));

const wanted = new Set<string>();
for (const { j, c } of links) { wanted.add(j); wanted.add(c); }
const base = new Map<string, string>();
const rl = createInterface({ input: createReadStream(join(tatoebaDir, 'sentences_base.csv'), 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
    const tab = line.indexOf('\t');
    const id = line.slice(0, tab);
    if (wanted.has(id)) base.set(id, line.slice(tab + 1));
}

type Kind = 'zhFromJa' | 'jaFromZh' | 'zhFromOtherJa' | 'zhFromOtherLang' | 'zhOriginalJaFromOther' | 'bothOriginal' | 'unknown';
function kindOf(j: string, c: string): Kind {
    const bc = base.get(c) ?? '\\N';
    const bj = base.get(j) ?? '\\N';
    if (bc === j) return 'zhFromJa';
    if (bj === c) return 'jaFromZh';
    if (bc === '\\N') return 'unknown';
    if (bc !== '0') return jpn.has(bc) ? 'zhFromOtherJa' : 'zhFromOtherLang';
    if (bj === '\\N') return 'unknown';
    return bj === '0' ? 'bothOriginal' : 'zhOriginalJaFromOther';
}

const kinds = new Map<Kind, number>();
const firstHandZh = new Map<string, string[]>(); // ja sentence id -> first-hand cmn ids
for (const { j, c } of links) {
    if (!cmn.has(c)) continue;
    const kind = kindOf(j, c);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    if (kind === 'zhFromJa' || kind === 'jaFromZh') firstHandZh.set(j, [...(firstHandZh.get(j) ?? []), c]);
}

// Script of a Chinese sentence, from characters that differ between the two scripts and are
// not used in the other one.
const TRAD = new Set('們這個說會來時為國對學過還麼沒見點開問長書車門話經與將從現實體電語愛氣東認識');
const SIMP = new Set('们这个说会来时为国对学过还么没见点开问长书车门话经与将从现实体电语爱气东认识');
function scriptOf(text: string): 'trad' | 'simp' | 'either' {
    let t = 0, s = 0;
    for (const ch of text) { if (TRAD.has(ch)) t++; if (SIMP.has(ch)) s++; }
    return t > s ? 'trad' : s > t ? 'simp' : 'either';
}
const scripts = { trad: 0, simp: 0, either: 0 };
for (const ids of firstHandZh.values()) for (const c of ids) scripts[scriptOf(cmn.get(c) ?? '')]++;

// --- Per word: sentences in the pool containing it, and how many of those have first-hand Chinese.
const poolFor = new Map<string, string[]>();
for (const [sid, vids] of pool) {
    for (const v of vids) {
        const list = poolFor.get(v);
        if (list) list.push(sid);
        else poolFor.set(v, [sid]);
    }
}

const poolWithZh = [...pool.keys()].filter(id => firstHandZh.has(id)).length;
const extraJa = [...firstHandZh.keys()].filter(id => !pool.has(id)).length;

const rows = new Map<string, { words: number; withEn: number; zh1: number; zh3: number; shownZh1: number }>();
for (const id of vocabIds) {
    const level = levelOf.get(id);
    const key = level ? `N${level}` : 'no level';
    const row = rows.get(key) ?? { words: 0, withEn: 0, zh1: 0, zh3: 0, shownZh1: 0 };
    const sentences = poolFor.get(id) ?? [];
    const zh = sentences.filter(s => firstHandZh.has(s)).length;
    const shown = [...(shownFor.get(id) ?? [])].filter(s => firstHandZh.has(s)).length;
    row.words++;
    if (sentences.length > 0) row.withEn++;
    if (zh >= 1) row.zh1++;
    if (zh >= 3) row.zh3++;
    if (shown >= 1) row.shownZh1++;
    rows.set(key, row);
}

const pct = (n: number, d: number) => `${n} (${d ? Math.round((100 * n) / d) : 0}%)`;
console.log(`Tatoeba: ${jpn.size} jpn sentences, ${cmn.size} cmn sentences, ${links.length} jpn-cmn links`);
console.log('Link kinds:', Object.fromEntries(kinds));
console.log(`Japanese sentences with a first-hand Chinese translation: ${firstHandZh.size}`);
console.log(`  in Gokan's pool: ${poolWithZh} of ${pool.size} pool sentences; not in the pool: ${extraJa}`);
console.log('Script of the first-hand Chinese sentences:', scripts);
console.log('\nlevel     words  with any sentence  >=1 zh sentence  >=3 zh sentences  >=1 zh among shown');
let total = { words: 0, withEn: 0, zh1: 0, zh3: 0, shownZh1: 0 };
for (const key of ['N5', 'N4', 'N3', 'N2', 'N1', 'no level']) {
    const r = rows.get(key);
    if (!r) continue;
    total = { words: total.words + r.words, withEn: total.withEn + r.withEn, zh1: total.zh1 + r.zh1, zh3: total.zh3 + r.zh3, shownZh1: total.shownZh1 + r.shownZh1 };
    console.log(`${key.padEnd(9)} ${String(r.words).padStart(6)}  ${pct(r.withEn, r.words).padStart(17)}  ${pct(r.zh1, r.words).padStart(15)}  ${pct(r.zh3, r.words).padStart(16)}  ${pct(r.shownZh1, r.words).padStart(18)}`);
}
console.log(`${'all'.padEnd(9)} ${String(total.words).padStart(6)}  ${pct(total.withEn, total.words).padStart(17)}  ${pct(total.zh1, total.words).padStart(15)}  ${pct(total.zh3, total.words).padStart(16)}  ${pct(total.shownZh1, total.words).padStart(18)}`);
