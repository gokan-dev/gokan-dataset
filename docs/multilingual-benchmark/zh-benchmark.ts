// Benchmark of first-hand Chinese sources for Gokan's words: coverage per source and JLPT level,
// what each adds over the others, and how often two sources agree.
// Usage: bun zh-benchmark.ts <compiledDir> <scratchDir>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [compiledDir, root] = process.argv.slice(2);
if (!compiledDir || !root) throw new Error('usage: <compiledDir> <scratchDir>');

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/[・\s-]/g, '');
const isKana = (ch: string) => /[ぁ-ゟ゠-ヿ]/.test(ch);
const allKana = (s: string) => s.length > 0 && [...s].every(isKana);
const jsonl = (path: string) => readFileSync(path, 'utf8').split('\n').filter(Boolean);

interface Rec { readings?: string[]; texts: string[] }
type Index = Map<string, Rec[]>;
const add = (index: Index, key: string, rec: Rec) => index.set(key, [...(index.get(key) ?? []), rec]);
interface Source { key: string; label: string; kind: 'definition' | 'equivalent'; needsReading: boolean; jlptOnly?: boolean; index: Index }

// ---------- Chinese Wiktionary, Japanese entries (definitions), split into hand-made and bot entries.
interface ZhEntry {
    word: string; pos: string;
    forms?: { form: string; tags?: string[]; ruby?: [string, string][] }[];
    senses: { glosses?: string[]; form_of?: unknown; alt_of?: unknown }[];
}
const SPELLING = /^(?=.*\p{Script=Han})[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ヶ]{1,10}$/u;
function prefixOf(text: string): { spellings: string[]; rest: string } | undefined {
    const m = /^([^：]{1,40})：\s*/.exec(text);
    const spellings = m?.[1].split(/[，,、]/).map(x => x.trim());
    if (!m || !spellings?.every(p => SPELLING.test(p)) || !text.slice(m[0].length).trim()) return undefined;
    return { spellings, rest: text.slice(m[0].length) };
}
function rubyReading(form: string, ruby: [string, string][]): string | undefined {
    let out = '', i = 0, r = 0;
    while (i < form.length) {
        const pair = ruby[r];
        if (pair && form.startsWith(pair[0], i)) { out += pair[1]; i += pair[0].length; r++; continue; }
        if (!isKana(form[i])) return undefined;
        out += form[i];
        i++;
    }
    return r === ruby.length ? out : undefined;
}
function zhGlosses(e: ZhEntry, spelling?: string): string[] {
    const out: string[] = [];
    for (const s of e.senses) {
        if (s.form_of || s.alt_of || !(s.glosses ?? []).some(g => g.trim())) continue;
        let text = (s.glosses ?? []).join('; ').replace(/\s+/g, ' ');
        const prefix = prefixOf(text);
        if (prefix) {
            if (spelling && !prefix.spellings.includes(spelling)) continue;
            text = prefix.rest;
        }
        out.push(text);
    }
    return out;
}
const zhDef: Index = new Map(), zhBulk: Index = new Map();
for (const file of ['ja-trad.jsonl', 'ja-simp.jsonl']) {
    for (const line of jsonl(join(root, 'wiktionary', file))) {
        const e = JSON.parse(line) as ZhEntry;
        if (e.pos === 'character' || e.pos === 'romanization' || e.pos === 'soft-redirect') continue;
        const firstGloss = e.senses[0]?.glosses?.[0] ?? '';
        const bulk = e.pos === 'unknown' && firstGloss.startsWith(`${e.word}【`);
        const target = bulk ? zhBulk : zhDef;
        let reading: string | undefined;
        const canonical = e.forms?.find(f => f.tags?.includes('canonical'));
        if (canonical?.ruby?.length) reading = rubyReading(canonical.form, canonical.ruby);
        if (!reading && bulk) {
            const m = /【([^】]+)】/.exec(firstGloss);
            if (m && allKana(toHira(m[1]))) reading = m[1];
        }
        if (!reading && allKana(e.word)) reading = e.word;
        const texts = zhGlosses(e).map(t => (bulk ? t.replace(/^.*?】\s*/, '') : t));
        if (texts.length) add(target, e.word, { readings: reading ? [toHira(reading)] : undefined, texts });
        if (allKana(e.word)) {
            const kanji = new Set((e.forms ?? []).filter(f => f.tags?.includes('kanji') && !allKana(f.form)).map(f => f.form));
            for (const s of e.senses) for (const p of prefixOf((s.glosses ?? []).join('; '))?.spellings ?? []) if (!allKana(p)) kanji.add(p);
            for (const k of kanji) {
                const t = zhGlosses(e, k);
                if (t.length) add(target, k, { readings: [toHira(e.word)], texts: t });
            }
        }
    }
}

// ---------- Japanese Wiktionary: translation tables of Japanese entries.
interface JaEntry {
    word: string; pos: string;
    forms?: { form: string; tags?: string[] }[];
    senses: { glosses?: string[] }[];
    translations?: { lang?: string; lang_code?: string; word?: string }[];
}
const jaTrans: Index = new Map();
const kanjiToKana = new Map<string, Set<string>>();
for (const line of jsonl(join(root, 'jawiktionary', 'ja.jsonl'))) {
    const e = JSON.parse(line) as JaEntry;
    if (e.pos === 'character') {
        for (const s of e.senses) for (const g of s.glosses ?? []) {
            const m = /^(.+?)の漢字表記/.exec(g);
            if (m && allKana(m[1])) kanjiToKana.set(e.word, new Set([...(kanjiToKana.get(e.word) ?? []), m[1]]));
        }
        continue;
    }
    const zh = (e.translations ?? []).filter(t => t.word && (t.lang?.includes('中国') || t.lang_code === 'zh' || t.lang_code === 'cmn')).map(t => t.word!);
    if (!zh.length) continue;
    const readings = new Set((e.forms ?? []).filter(f => f.tags?.includes('transliteration')).map(f => toHira(f.form)));
    if (allKana(e.word)) readings.add(toHira(e.word));
    add(jaTrans, e.word, { readings: [...readings], texts: zh });
}
for (const [kanji, kanas] of kanjiToKana) {
    for (const kana of kanas) {
        for (const r of jaTrans.get(kana) ?? []) add(jaTrans, kanji, { readings: [toHira(kana)], texts: r.texts });
    }
}

// ---------- Japanese Wiktionary: Chinese entries defined in Japanese (reverse).
const jaReverse: Index = new Map();
function glossTokens(g: string): string[] {
    const tokens = g.replace(/（[^）]*）|\([^)]*\)|〔[^〕]*〕|［[^］]*］|[「」『』]/g, '')
        .split(/[、。，,；;・／/\s]+/).map(t => t.trim())
        .filter(t => t && t.length <= 12 && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t));
    return tokens.flatMap(t => (t.endsWith('する') && t.length > 3 ? [t, t.slice(0, -2)] : [t]));
}
for (const line of jsonl(join(root, 'jawiktionary', 'zh.jsonl'))) {
    const e = JSON.parse(line) as JaEntry;
    if (e.pos === 'character' || e.pos === 'romanization') continue;
    const heads = [...new Set([e.word, ...(e.forms ?? []).filter(f => f.tags?.includes('canonical') && /\p{Script=Han}/u.test(f.form)).map(f => f.form)])];
    const seen = new Set<string>();
    for (const s of e.senses) for (const g of s.glosses ?? []) for (const t of glossTokens(g)) {
        if (seen.has(t)) continue;
        seen.add(t);
        add(jaReverse, t, { texts: heads });
    }
}

// ---------- Wikidata lexemes and Wikipedia.
const wikidata: Index = new Map();
for (const lex of JSON.parse(readFileSync(join(root, 'sources', 'wikidata.json'), 'utf8')) as { lemmas: Record<string, string>; zh: string[] }[]) {
    const ja = lex.lemmas.ja;
    if (!ja || !lex.zh.length) continue;
    const readings = ['ja-hira', 'ja-kana', 'ja-hrkt'].map(k => lex.lemmas[k]).filter((x): x is string => !!x).map(toHira);
    if (allKana(ja)) readings.push(toHira(ja));
    add(wikidata, ja, { readings, texts: lex.zh });
}
const wikipedia: Index = new Map();
const wpRaw = JSON.parse(readFileSync(join(root, 'sources', 'wikipedia.json'), 'utf8')) as Record<string, { target?: string; zh?: string; disambiguation?: boolean; missing?: boolean }>;
const viaRedirect = new Set<string>();
for (const [title, p] of Object.entries(wpRaw)) {
    if (!p.zh || p.disambiguation || p.missing) continue;
    add(wikipedia, title, { texts: [p.zh.replace(/\s*[（(][^）)]*[）)]\s*$/, '')] });
    if (p.target) viaRedirect.add(title);
}

const SOURCES: Source[] = [
    { key: 'zhDef', label: 'zh.wikt definitions', kind: 'definition', needsReading: true, index: zhDef },
    { key: 'jaTrans', label: 'ja.wikt translations', kind: 'equivalent', needsReading: true, index: jaTrans },
    { key: 'jaRev', label: 'ja.wikt reverse', kind: 'equivalent', needsReading: false, index: jaReverse },
    { key: 'wikidata', label: 'Wikidata', kind: 'equivalent', needsReading: true, index: wikidata },
    { key: 'wikipedia', label: 'Wikipedia', kind: 'equivalent', needsReading: false, jlptOnly: true, index: wikipedia },
];
const BULK: Source = { key: 'zhBulk', label: 'zh.wikt bot entries', kind: 'definition', needsReading: true, index: zhBulk };

// ---------- Per word.
interface Vocab { id: string; writtenForm: { kanji: string; alternatives?: string[] }; reading: { primary: string; alternatives?: string[] }; usuallyKana?: boolean; senses: { glosses: string[] }[] }
const levelOf = new Map<string, number>();
for (const [level, entries] of Object.entries(JSON.parse(readFileSync(join(compiledDir, 'index', 'jlpt.json'), 'utf8')) as Record<string, { id: string }[]>)) for (const e of entries) levelOf.set(e.id, Number(level));

function hits(src: Source, v: Vocab): string[] | undefined {
    const spellings = new Set([v.writtenForm.kanji, ...(v.writtenForm.alternatives ?? [])]);
    if (v.usuallyKana) spellings.add(v.reading.primary);
    if (src.key === 'wikipedia') { spellings.clear(); spellings.add(v.writtenForm.kanji); }
    const readings = new Set([v.reading.primary, ...(v.reading.alternatives ?? [])].map(toHira));
    const recs = [...spellings].flatMap(s => src.index.get(s) ?? []);
    const ok = src.needsReading ? recs.filter(r => r.readings?.some(x => readings.has(x))) : recs;
    const texts = [...new Set(ok.flatMap(r => r.texts).filter(t => t.trim()))];
    return texts.length ? texts : undefined;
}

interface Row { v: Vocab; level: string; hits: Record<string, string[] | undefined> }
const rows: Row[] = [];
for (const file of readdirSync(join(compiledDir, 'vocab'))) {
    if (!file.endsWith('.json')) continue;
    const v = JSON.parse(readFileSync(join(compiledDir, 'vocab', file), 'utf8')) as Vocab;
    const level = levelOf.get(v.id);
    const h: Record<string, string[] | undefined> = {};
    for (const src of [...SOURCES, BULK]) h[src.key] = hits(src, v);
    rows.push({ v, level: level ? `N${level}` : 'no level', hits: h });
}

// ---------- Traditional -> Simplified, character by character, with Windows' own converter.
const chars = new Set<string>();
for (const r of rows) for (const t of Object.values(r.hits)) for (const s of t ?? []) for (const ch of s) if (ch.charCodeAt(0) > 0x2e80) chars.add(ch);
const charList = [...chars];
mkdirSync(join(root, 'benchmark'), { recursive: true });
const inFile = join(root, 'benchmark', 't2s-in.txt'), outFile = join(root, 'benchmark', 't2s-out.txt');
writeFileSync(inFile, charList.join('\n'));
const ps = Bun.spawnSync(['pwsh', '-NoProfile', '-Command', `Add-Type -AssemblyName Microsoft.VisualBasic; $t = [IO.File]::ReadAllText('${inFile}'); [IO.File]::WriteAllText('${outFile}', [Microsoft.VisualBasic.Strings]::StrConv($t, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 2052), [Text.UTF8Encoding]::new($false))`]);
if (ps.exitCode !== 0) throw new Error(`t2s failed: ${ps.stderr.toString()}`);
const converted = readFileSync(outFile, 'utf8').split('\n');
const t2s = new Map<string, string>();
charList.forEach((ch, i) => { if (converted[i] && converted[i] !== ch && [...converted[i]].length === 1) t2s.set(ch, converted[i]); });
const norm = (s: string) => [...s].map(c => t2s.get(c) ?? c).join('');
const tokens = (texts: string[]) => texts.flatMap(t => norm(t).replace(/[（(][^）)]*[）)]/g, ' ').split(/[，,。；;、：:\s/／|．.！!？?…]+/)).map(t => t.trim()).filter(Boolean);
function agreeing(a: string[], b: string[]): [string, string] | undefined {
    const A = tokens(a), B = tokens(b);
    // A one-character equivalent (浅, 运) agrees with a gloss item it starts ("浅的", "运送").
    const within = (long: string, short: string) => short.length >= 2 ? long.includes(short) : long.startsWith(short);
    for (const x of A) for (const y of B) if (x === y || within(x, y) || within(y, x)) return [x, y];
    return undefined;
}
const agree = (a: string[], b: string[]) => agreeing(a, b) !== undefined;

// ---------- Report.
const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1', 'no level'];
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '-').padStart(6);
const covered = (r: Row, keys: string[]) => keys.some(k => r.hits[k]);
const ALL = SOURCES.map(s => s.key);
const EQUIV = SOURCES.filter(s => s.kind === 'equivalent').map(s => s.key);
console.log(`t2s map: ${t2s.size} characters`);
console.log(`\nCoverage (share of words; Wikipedia asked for JLPT words only)`);
console.log(`level      words ${SOURCES.map(s => s.label.slice(0, 13).padStart(14)).join('')}   any source  def or 2+ equiv   2+ sources`);
for (const level of [...LEVELS, 'all']) {
    const rs = rows.filter(r => level === 'all' || r.level === level);
    const two = rs.filter(r => ALL.filter(k => r.hits[k]).length >= 2).length;
    const defOr2 = rs.filter(r => r.hits.zhDef || EQUIV.filter(k => r.hits[k]).length >= 2).length;
    console.log(`${level.padEnd(9)} ${String(rs.length).padStart(6)} ${SOURCES.map(s => pct(rs.filter(r => r.hits[s.key]).length, rs.length).padStart(14)).join('')} ${pct(rs.filter(r => covered(r, ALL)).length, rs.length).padStart(12)} ${pct(defOr2, rs.length).padStart(16)} ${pct(two, rs.length).padStart(12)}`);
}

console.log(`\nWhat each source adds: words it alone covers`);
for (const src of SOURCES) {
    const others = ALL.filter(k => k !== src.key);
    const only = (rs: Row[]) => rs.filter(r => r.hits[src.key] && !covered(r, others)).length;
    const core = rows.filter(r => ['N5', 'N4', 'N3'].includes(r.level));
    console.log(`  ${src.label.padEnd(22)} N5-N3: ${String(only(core)).padStart(5)}   all: ${String(only(rows)).padStart(6)}`);
}

console.log(`\nAgreement between sources (words both cover: share where they share an equivalent)`);
const pairSources = [...SOURCES, BULK];
for (let i = 0; i < pairSources.length; i++) for (let j = i + 1; j < pairSources.length; j++) {
    const a = pairSources[i], b = pairSources[j];
    const both = rows.filter(r => r.hits[a.key] && r.hits[b.key]);
    if (both.length < 20) continue;
    const ok = both.filter(r => agree(r.hits[a.key]!, r.hits[b.key]!)).length;
    console.log(`  ${a.label.padEnd(22)} x ${b.label.padEnd(22)} ${String(both.length).padStart(6)} words  ${pct(ok, both.length)} agree`);
}

console.log(`\nzh.wikt definitions, checked against the equivalent sources`);
for (const group of [['N5', 'N4', 'N3'], ['N2', 'N1'], ['no level']]) {
    const rs = rows.filter(r => group.includes(r.level) && r.hits.zhDef);
    const checked = rs.filter(r => covered(r, EQUIV));
    const corroborated = checked.filter(r => EQUIV.some(k => r.hits[k] && agree(r.hits.zhDef!, r.hits[k]!)));
    console.log(`  ${group.join('-').padEnd(8)} ${String(rs.length).padStart(6)} words: corroborated ${pct(corroborated.length, rs.length)}, contradicted ${pct(checked.length - corroborated.length, rs.length)}, unchecked ${pct(rs.length - checked.length, rs.length)}`);
}
console.log('\n--- corroborated N5-N3 words (every 40th): the pair that agreed');
rows.filter(r => ['N5', 'N4', 'N3'].includes(r.level) && r.hits.zhDef && EQUIV.some(k => r.hits[k] && agree(r.hits.zhDef!, r.hits[k]!)))
    .filter((_, i) => i % 40 === 0)
    .forEach(r => {
        const k = EQUIV.find(key => r.hits[key] && agree(r.hits.zhDef!, r.hits[key]!))!;
        const [x, y] = agreeing(r.hits.zhDef!, r.hits[k]!)!;
        console.log(`${r.v.writtenForm.kanji} (${r.v.reading.primary}) en ${r.v.senses[0].glosses.slice(0, 2).join(', ')}: "${x}" ~ "${y}" (${k})`);
    });
console.log('\n--- contradicted N5-N3 words (every 12th)');
rows.filter(r => ['N5', 'N4', 'N3'].includes(r.level) && r.hits.zhDef && covered(r, EQUIV) && !EQUIV.some(k => r.hits[k] && agree(r.hits.zhDef!, r.hits[k]!)))
    .filter((_, i) => i % 12 === 0)
    .forEach(r => {
        console.log(`${r.v.writtenForm.kanji} (${r.v.reading.primary}) ${r.level}: en ${r.v.senses.slice(0, 2).map(s => s.glosses.slice(0, 2).join(', ')).join(' | ')}`);
        for (const src of SOURCES) if (r.hits[src.key]) console.log(`   ${src.label.padEnd(22)} ${r.hits[src.key]!.slice(0, 4).join(' | ').slice(0, 100)}`);
    });
console.log(`\nWikipedia: article titles matched exactly through Wikidata sitelinks, no redirects followed (${viaRedirect.size} via redirect)`);

const PROBES = ['手紙', '勉強', '先生', '本', '即ち', '一月', '上手', '橋', '紙', '箱', '少し', '宿題', '汽車', '娘', '大丈夫', '新聞', '走る', '飲む', '学生', '醤油', '愛人', '丈夫'];
console.log('\n--- probes');
for (const word of PROBES) {
    for (const r of rows.filter(x => x.v.writtenForm.kanji === word)) {
        console.log(`${r.v.writtenForm.kanji} (${r.v.reading.primary}) ${r.level}: en ${r.v.senses.slice(0, 3).map(s => s.glosses[0]).join(' | ')}`);
        for (const src of [...SOURCES, BULK]) if (r.hits[src.key]) console.log(`   ${src.label.padEnd(22)} ${r.hits[src.key]!.slice(0, 4).join(' | ').slice(0, 110)}`);
    }
}

// ---------- Review sheet: 60 random words per level (fixed seed), every source side by side.
let seed = 20261104;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
const sheet = [['id', 'level', 'headword', 'reading', 'jmdict (en)', ...[...SOURCES, BULK].map(s => s.label)].join('\t')];
for (const level of ['N5', 'N4', 'N3', 'N2', 'N1']) {
    const pool = rows.filter(r => r.level === level);
    const picked = new Set<number>();
    while (picked.size < Math.min(60, pool.length)) picked.add(Math.floor(rand() * pool.length));
    for (const i of picked) {
        const r = pool[i];
        sheet.push([r.v.id, level, r.v.writtenForm.kanji, r.v.reading.primary, r.v.senses.map(s => s.glosses.slice(0, 3).join(', ')).join(' | '), ...[...SOURCES, BULK].map(s => (r.hits[s.key] ?? []).join(' | ').replace(/\t/g, ' '))].join('\t'));
    }
}
writeFileSync(join(root, 'benchmark', 'review-sheet.tsv'), sheet.join('\n'));
console.log(`\nreview sheet: ${sheet.length - 1} words`);
