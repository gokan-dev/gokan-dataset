// Measures how many Gokan words match a Chinese Wiktionary entry (kaikki.org extraction) by
// spelling AND reading, and prints a sample for checking by hand.
// Usage: bun wikt-zh-coverage.ts <compiledDir> <trad.jsonl> <simp.jsonl>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [compiledDir, tradFile, simpFile] = process.argv.slice(2);
if (!compiledDir || !tradFile || !simpFile) throw new Error('usage: <compiledDir> <trad.jsonl> <simp.jsonl>');

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/[・\s]/g, '');
const isKana = (ch: string) => /[ぁ-ゟ゠-ヿ]/.test(ch);
const allKana = (s: string) => s.length > 0 && [...s].every(isKana);

interface KaikkiEntry {
    word: string;
    pos: string;
    forms?: { form: string; tags?: string[]; ruby?: [string, string][] }[];
    senses: { glosses?: string[]; form_of?: unknown; alt_of?: unknown; examples?: { text?: string; translation?: string }[] }[];
}
interface Rec { file: 'trad' | 'simp'; bulk: boolean; reading?: string; defined: boolean; glosses: string[]; senses: number; examples: number }

// The reading spelled out by the canonical form's ruby: each ruby base replaced by its reading,
// kana kept as is. Undefined when a kanji has no ruby.
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

// The entry's real senses, with any spelling prefix stripped; for `spelling`, only the senses
// whose prefix names it (or that carry none).
// A sense's spelling prefix ("飲む，呑む： 喝，饮"): the Japanese spellings it applies to.
const SPELLING = /^(?=.*\p{Script=Han})[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ヶ]{1,10}$/u;
function prefixOf(text: string): { spellings: string[]; rest: string } | undefined {
    const m = /^([^：]{1,40})：\s*/.exec(text);
    const spellings = m?.[1].split(/[，,、]/).map(x => x.trim());
    if (!m || !spellings?.every(p => SPELLING.test(p)) || !text.slice(m[0].length).trim()) return undefined;
    return { spellings, rest: text.slice(m[0].length) };
}

function makeRec(e: KaikkiEntry, file: 'trad' | 'simp', bulk: boolean, reading: string | undefined, spelling?: string): Rec {
    const kept: { text: string; examples: number }[] = [];
    for (const s of e.senses) {
        if (s.form_of || s.alt_of || !(s.glosses ?? []).some(g => g.trim())) continue;
        let text = (s.glosses ?? []).join('; ').replace(/\s+/g, ' ');
        const prefix = prefixOf(text);
        if (prefix) {
            if (spelling && !prefix.spellings.includes(spelling)) continue;
            text = prefix.rest;
        }
        kept.push({ text, examples: (s.examples ?? []).filter(x => x.text && x.translation).length });
    }
    return {
        file, bulk,
        reading: reading ? toHira(reading) : undefined,
        defined: kept.length > 0,
        glosses: kept.map(k => k.text),
        senses: kept.length,
        examples: kept.reduce((n, k) => n + k.examples, 0),
    };
}

const byWord = new Map<string, Rec[]>();
const fileStats = { trad: { entries: 0, skipped: 0, bulk: 0 }, simp: { entries: 0, skipped: 0, bulk: 0 } };
for (const [file, path] of [['trad', tradFile], ['simp', simpFile]] as const) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line) continue;
        const e = JSON.parse(line) as KaikkiEntry;
        fileStats[file].entries++;
        if (e.pos === 'character' || e.pos === 'romanization' || e.pos === 'soft-redirect') { fileStats[file].skipped++; continue; }
        const firstGloss = e.senses[0]?.glosses?.[0] ?? '';
        // Bulk-imported technical entries: POS unknown, the reading written inside the gloss.
        const bulk = e.pos === 'unknown' && firstGloss.startsWith(`${e.word}【`);
        if (bulk) fileStats[file].bulk++;
        let reading: string | undefined;
        const canonical = e.forms?.find(f => f.tags?.includes('canonical'));
        if (canonical?.ruby?.length) reading = rubyReading(canonical.form, canonical.ruby);
        if (!reading && bulk) {
            const m = /【([^】]+)】/.exec(firstGloss);
            if (m && allKana(toHira(m[1]))) reading = m[1];
        }
        if (!reading && allKana(e.word)) reading = e.word;
        const add = (key: string, rec: Rec) => byWord.set(key, [...(byWord.get(key) ?? []), rec]);
        add(e.word, makeRec(e, file, bulk, reading));
        // A native word's lemma is its kana page, listing its kanji spellings; each sense may be
        // prefixed with the spellings it applies to ("飲む，呑む： 喝，饮").
        if (allKana(e.word)) {
            const kanjiSpellings = new Set((e.forms ?? []).filter(f => f.tags?.includes('kanji') && !allKana(f.form)).map(f => f.form));
            for (const s of e.senses) for (const p of prefixOf((s.glosses ?? []).join('; '))?.spellings ?? []) if (!allKana(p)) kanjiSpellings.add(p);
            for (const k of kanjiSpellings) add(k, makeRec(e, file, bulk, e.word, k));
        }
    }
}

// --- Gokan words.
interface Vocab {
    id: string;
    writtenForm: { kanji: string; alternatives?: string[] };
    reading: { primary: string; alternatives?: string[] };
    usuallyKana?: boolean;
    senses: { glosses: string[] }[];
}
const levelOf = new Map<string, number>();
const jlptRaw: unknown = JSON.parse(readFileSync(join(compiledDir, 'index', 'jlpt.json'), 'utf8'));
for (const [level, entries] of Object.entries(jlptRaw as Record<string, { id: string }[]>)) for (const e of entries) levelOf.set(e.id, Number(level));

type Outcome = 'confirmed' | 'confirmedBulkOnly' | 'altOnly' | 'spellingOnly' | 'readingMismatch' | 'none';
const ORDER: Outcome[] = ['confirmed', 'confirmedBulkOnly', 'altOnly', 'spellingOnly', 'readingMismatch', 'none'];
const rows = new Map<string, Record<Outcome | 'words' | 'withExamples', number>>();
const confirmedSample: { level: string; v: Vocab; recs: Rec[] }[] = [];
const senseCompare = { words: 0, en: 0, zh: 0, zhFewer: 0 };
const confirmedFrom = { trad: 0, simp: 0 };
const misses: { v: Vocab; outcome: Outcome; recs: Rec[] }[] = [];

for (const file of readdirSync(join(compiledDir, 'vocab'))) {
    if (!file.endsWith('.json')) continue;
    const v = JSON.parse(readFileSync(join(compiledDir, 'vocab', file), 'utf8')) as Vocab;
    const spellings = new Set([v.writtenForm.kanji, ...(v.writtenForm.alternatives ?? [])]);
    if (v.usuallyKana) spellings.add(v.reading.primary);
    const readings = new Set([v.reading.primary, ...(v.reading.alternatives ?? [])].map(toHira));
    const recs = [...spellings].flatMap(s => byWord.get(s) ?? []);
    const sameReading = recs.filter(r => r.reading && readings.has(r.reading));
    const good = sameReading.filter(r => r.defined && !r.bulk);
    let outcome: Outcome;
    if (good.length) outcome = 'confirmed';
    else if (sameReading.some(r => r.defined)) outcome = 'confirmedBulkOnly';
    else if (sameReading.length) outcome = 'altOnly';
    else if (recs.some(r => r.defined && !r.reading)) outcome = 'spellingOnly';
    else if (recs.length) outcome = 'readingMismatch';
    else outcome = 'none';

    const level = levelOf.get(v.id);
    const key = level ? `N${level}` : 'no level';
    const row = rows.get(key) ?? { words: 0, withExamples: 0, confirmed: 0, confirmedBulkOnly: 0, altOnly: 0, spellingOnly: 0, readingMismatch: 0, none: 0 };
    row.words++;
    row[outcome]++;
    if (outcome === 'confirmed') {
        if (good.some(r => r.examples > 0)) row.withExamples++;
        if (good.some(r => r.file === 'trad')) confirmedFrom.trad++; else confirmedFrom.simp++;
        if (level && level >= 3) {
            const zh = Math.max(...good.map(r => r.senses));
            senseCompare.words++;
            senseCompare.en += v.senses.length;
            senseCompare.zh += zh;
            if (zh < v.senses.length) senseCompare.zhFewer++;
            confirmedSample.push({ level: key, v, recs: good });
        }
    }
    rows.set(key, row);
    if (key === 'N5' && (outcome === 'none' || outcome === 'spellingOnly' || outcome === 'readingMismatch')) misses.push({ v, outcome, recs });
}

// Why N5 words miss: is there an entry under another spelling with the same reading?
const byReading = new Map<string, string[]>();
for (const [word, recs] of byWord) for (const r of recs) if (r.reading && r.defined) byReading.set(r.reading, [...(byReading.get(r.reading) ?? []), word]);
console.log('\n--- N5 misses (every 3rd)');
misses.filter((_, i) => i % 3 === 0).forEach(({ v, outcome, recs }) => {
    const sameReading = [...new Set(byReading.get(toHira(v.reading.primary)) ?? [])].slice(0, 6).join(',');
    const theirs = recs.map(r => r.reading ?? '?').join(',');
    console.log(`${outcome.padEnd(15)} ${v.writtenForm.kanji} (${v.reading.primary}) alts=${(v.writtenForm.alternatives ?? []).join(',') || '-'} kana=${v.usuallyKana ? 'y' : 'n'} entryReadings=${theirs || '-'} sameReadingWords=${sameReading || '-'}`);
});

const pct = (n: number, d: number) => `${n} (${d ? Math.round((100 * n) / d) : 0}%)`.padStart(13);
console.log('files:', fileStats);
console.log(`\nlevel     words    confirmed   +bulk only     alt-only  spelling only  other reading         none  confirmed w/ examples`);
const total: Record<string, number> = {};
for (const key of ['N5', 'N4', 'N3', 'N2', 'N1', 'no level']) {
    const r = rows.get(key);
    if (!r) continue;
    for (const [k, n] of Object.entries(r)) total[k] = (total[k] ?? 0) + n;
    console.log(`${key.padEnd(9)} ${String(r.words).padStart(5)} ${ORDER.map(o => pct(r[o], r.words)).join('')}  ${pct(r.withExamples, r.words)}`);
}
console.log(`${'all'.padEnd(9)} ${String(total.words).padStart(5)} ${ORDER.map(o => pct(total[o], total.words)).join('')}  ${pct(total.withExamples, total.words)}`);
console.log('\nconfirmed words by file (trad = 日語 heading, simp = 日语):', confirmedFrom);
console.log(`N5-N3 confirmed: ${senseCompare.words} words, JMdict senses avg ${(senseCompare.en / senseCompare.words).toFixed(2)}, Wiktionary senses avg ${(senseCompare.zh / senseCompare.words).toFixed(2)}, Wiktionary has fewer for ${pct(senseCompare.zhFewer, senseCompare.words).trim()}`);

console.log('\n--- sample, every 40th confirmed N5-N3 word');
confirmedSample.filter((_, i) => i % 40 === 0).forEach(({ level, v, recs }) => {
    console.log(`${level} ${v.writtenForm.kanji} (${v.reading.primary})`);
    console.log(`   en: ${v.senses.slice(0, 3).map(s => s.glosses.slice(0, 3).join(', ')).join(' | ')}`);
    console.log(`   zh: ${recs[0].glosses.slice(0, 3).join(' | ').slice(0, 160)}`);
});
