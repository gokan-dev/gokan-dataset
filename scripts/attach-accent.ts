#!/usr/bin/env bun
// Writes `pitchAccent` on every assembled word a source covers and removes it from those no
// longer covered (src/accent/pitchAccent.ts), from the committed snapshots in data/raw/accents/
// (fetch:accents:wiktionary, extract:accents:unidic). Offline. Fails on an accent the app could
// not draw (assertPitchAccent). Runs at the end of build:data; rewrites only words whose accent
// changed, in their own formatting.
//
// Run: bun run attach:accent
import fs from 'node:fs';
import path from 'node:path';
import { accentIndex, assertPitchAccent, pitchAccentOf, type AccentSources } from '../src/accent/pitchAccent';
import { parseSnapshot } from '../src/accent/snapshot';
import { serializeLike } from '../src/audio/attach';
import { VOCAB_DIR } from '../src/audio/compiled';
import type { Vocabulary } from '../src/models/vocabulary.model';

const SNAPSHOTS = { wiktionary: 'data/raw/accents/wiktionary.tsv', unidic: 'data/raw/accents/unidic.tsv' } as const;

function main(): void {
    const sources: AccentSources = {
        wiktionary: accentIndex(parseSnapshot(fs.readFileSync(SNAPSHOTS.wiktionary, 'utf8'))),
        unidic: accentIndex(parseSnapshot(fs.readFileSync(SNAPSHOTS.unidic, 'utf8'))),
    };
    if (!fs.existsSync(VOCAB_DIR)) throw new Error(`${VOCAB_DIR} not found: run build:data first.`);

    const counts = { words: 0, wiktionary: 0, unidic: 0, rewritten: 0 };
    for (const f of fs.readdirSync(VOCAB_DIR).filter(n => n.endsWith('.json')).sort()) {
        const file = path.join(VOCAB_DIR, f);
        const original = fs.readFileSync(file, 'utf8');
        // Assembled output of this repo's own build, already typed by it.
        const word = JSON.parse(original) as Vocabulary;
        const accents = pitchAccentOf(word, sources);
        assertPitchAccent(word, accents);
        counts.words++;
        const first = accents[0];
        if (first) counts[first.source]++;

        const before = JSON.stringify(word.pitchAccent ?? null);
        if (accents.length > 0) word.pitchAccent = accents;
        else delete word.pitchAccent;
        if (JSON.stringify(word.pitchAccent ?? null) === before) continue;
        fs.writeFileSync(file, serializeLike(original, word));
        counts.rewritten++;
    }
    const covered = counts.wiktionary + counts.unidic;
    const pct = (n: number) => `${(100 * n / counts.words).toFixed(1)}%`;
    console.log(`attach:accent: ${covered} of ${counts.words} words carry a pitch accent (${pct(covered)}: Wiktionary ${counts.wiktionary}, UniDic ${counts.unidic}); ${counts.rewritten} files rewritten.`);
}

main();
