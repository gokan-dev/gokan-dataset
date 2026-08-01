import fs from 'fs';
import path from 'path';
import type { Vocabulary } from '../src/models/vocabulary.model';
import type { JlptIndex } from '../src/models/index.model';

/**
 * Builds `index/jlpt.json` (JLPT level -> vocab, frequency-sorted) from the
 * already-compiled vocab files.
 *
 * Kept as a separate pass over the compiled output rather than folded into
 * build-data.ts so it can be regenerated on its own - the main build re-runs
 * Kuromoji tokenization over the whole corpus, which is far too slow to repeat
 * just to reshape an index. `build:data` chains this after build-data.ts, so
 * the two never drift.
 */

const INPUT_VOCAB_DIR = './public/data/compiled/vocab';
const OUTPUT_INDEX_DIR = './public/data/compiled/index';

async function main() {
    console.log('📖 Building JLPT index...');

    const files = fs.readdirSync(INPUT_VOCAB_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        throw new Error(`No compiled vocab found in ${INPUT_VOCAB_DIR}. Run build:data first.`);
    }

    // Levels are keyed 1 (N1) .. 5 (N5); the consumer walks 5 -> 1.
    const index: JlptIndex = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    const rankById = new Map<string, number>();

    let scanned = 0;
    let matched = 0;

    for (const file of files) {
        const raw = fs.readFileSync(path.join(INPUT_VOCAB_DIR, file), 'utf-8');
        const vocab = JSON.parse(raw) as Vocabulary;
        scanned++;

        const level = vocab.jlptLevel;
        if (level === undefined || level === null) continue;
        if (!index[level]) {
            console.warn(`   ⚠ Skipping ${vocab.id}: unexpected jlptLevel ${level}`);
            continue;
        }

        index[level].push({
            id: vocab.id,
            containedKanji: vocab.writtenForm.containedKanji,
        });
        rankById.set(vocab.id, vocab.frequency.kanjiRank);
        matched++;
    }

    // Within a level, common words first - a learner working through N5 should
    // meet 人 before 湖. readdirSync order is filesystem-dependent, so this sort
    // is what makes the index deterministic across machines.
    for (const entries of Object.values(index)) {
        entries.sort((a, b) => {
            const rankDelta = (rankById.get(a.id) ?? Infinity) - (rankById.get(b.id) ?? Infinity);
            return rankDelta !== 0 ? rankDelta : a.id.localeCompare(b.id);
        });
    }

    fs.mkdirSync(OUTPUT_INDEX_DIR, { recursive: true });
    fs.writeFileSync(
        path.join(OUTPUT_INDEX_DIR, 'jlpt.json'),
        JSON.stringify(index)
    );

    console.log(`✅ JLPT index written.`);
    console.log(`   - Vocab scanned: ${scanned}`);
    console.log(`   - With a JLPT level: ${matched}`);
    for (const level of [5, 4, 3, 2, 1]) {
        console.log(`   - N${level}: ${index[level].length}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
