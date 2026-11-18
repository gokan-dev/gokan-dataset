#!/usr/bin/env bun
// data/raw/accents/unidic.tsv: each dictionary-form row of UniDic's lexicon that carries an
// accent (src/accent/unidic.ts), from unidic-cwj 3.1.0, used under its New BSD option (its
// notice: data/raw/accents/UNIDIC-BSD-LICENSE). The lexicon is 233 MB and is not committed:
// download https://clrd.ninjal.ac.jp/unidic_archive/cwj/3.1.0/unidic-cwj-3.1.0.zip, unzip it,
// and pass its lex_3_1.csv.
//
// Run: bun run extract:accents:unidic <path to lex_3_1.csv>
import fs from 'node:fs';
import readline from 'node:readline';
import { formatSnapshot, type AccentRow } from '../src/accent/snapshot';
import { unidicRow } from '../src/accent/unidic';

const OUT = 'data/raw/accents/unidic.tsv';

async function main(): Promise<void> {
    const lexPath = process.argv[2];
    if (!lexPath || !fs.existsSync(lexPath)) throw new Error('usage: bun run extract:accents:unidic <path to unidic-cwj-3.1.0/lex_3_1.csv>');
    // The first row of a (form, reading) is kept: UniDic lists a lemma's usual row first.
    const rows = new Map<string, AccentRow>();
    const lines = readline.createInterface({ input: fs.createReadStream(lexPath, 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) {
        const row = unidicRow(line);
        if (!row) continue;
        const key = `${row.form}\t${row.reading}`;
        if (!rows.has(key)) rows.set(key, row);
    }
    fs.mkdirSync('data/raw/accents', { recursive: true });
    fs.writeFileSync(OUT, formatSnapshot([
        'UniDic (unidic-cwj 3.1.0, NINJAL), New BSD licence (UNIDIC-BSD-LICENSE): aType of each dictionary-form row.',
        'form <TAB> reading (katakana) <TAB> accents, most usual first. See src/accent/.',
    ], [...rows.values()]));
    console.log(`extract:accents:unidic: ${rows.size} rows -> ${OUT}`);
}

await main();
