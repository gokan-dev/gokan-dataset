import fs from 'fs';
import path from 'path';
import type { Vocabulary } from '../src/models/vocabulary.model';
import type { JitenMediaSnapshot, MediaIndexEntry, MediaSelectionEntry, MediaTitle, MediaWordCount } from '../src/models/media.model';

/**
 * Compiles the Jiten snapshots in `data/raw/media/jiten/` into
 * `compiled/media/index.json` plus one `compiled/media/{id}.json` per title.
 *
 * Offline: it reads only the committed snapshots and the already-compiled vocab,
 * so it needs `build:data` first and never touches the network (refreshing the
 * snapshots is `fetch:media`'s job). Only titles still listed in
 * `selection.json` are compiled, so removing a title from the selection removes
 * it from the library even if its snapshot file is left behind.
 *
 * A word is kept only when its JMdict id resolves to a compiled vocab entry,
 * either directly or through a merged homograph. Particles, kana-only words and
 * loanwords are not Gokan vocabulary yet, so they drop out here, and every count
 * downstream is "of the kanji vocabulary" rather than of every word spoken.
 */

const SELECTION_FILE = './data/raw/media/selection.json';
const SNAPSHOT_DIR = './data/raw/media/jiten';
const VOCAB_DIR = './compiled/vocab';
const OUTPUT_DIR = './compiled/media';

/** Jiten's link types for the two catalogues worth linking to. */
const LINK_TYPE_ANILIST = 4;
const LINK_TYPE_MYANIMELIST = 5;

/** Maps a JMdict id to the Gokan vocab id it lives under, or null if it is not Gokan vocabulary. */
export type VocabResolver = (jmdictId: number) => string | null;

/**
 * A resolver from the compiled vocab entries. A homograph merged into another
 * entry (`mergedVocabs`, e.g. かの into あの) has no file of its own, so its id
 * is redirected to the base entry: without this, a learner who knows the base
 * word would see the merged one counted as unknown.
 */
export function buildVocabResolver(vocabs: Iterable<Pick<Vocabulary, 'id' | 'mergedVocabs'>>): VocabResolver {
    const baseOf = new Map<string, string>();
    for (const vocab of vocabs) {
        baseOf.set(vocab.id, vocab.id);
        for (const merged of vocab.mergedVocabs ?? []) {
            if (!baseOf.has(merged.id)) baseOf.set(merged.id, vocab.id);
        }
    }
    return jmdictId => baseOf.get(String(jmdictId)) ?? null;
}

/** Resolves and re-aggregates a word list (two JMdict ids can share a base), most frequent first. */
export function resolveWords(words: [number, number][], resolve: VocabResolver): MediaWordCount[] {
    const counts = new Map<string, number>();
    for (const [jmdictId, occurrences] of words) {
        const vocabId = resolve(jmdictId);
        if (vocabId) counts.set(vocabId, (counts.get(vocabId) ?? 0) + occurrences);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function compileTitle(snapshot: JitenMediaSnapshot, resolve: VocabResolver): MediaTitle {
    const linkOf = (type: number) => snapshot.links.find(l => l.type === type)?.url;
    const year = snapshot.releaseDate ? Number(snapshot.releaseDate.slice(0, 4)) : NaN;

    return {
        id: String(snapshot.deckId),
        kind: 'anime',
        title: {
            original: snapshot.title.original,
            ...(snapshot.title.romaji ? { romaji: snapshot.title.romaji } : {}),
            ...(snapshot.title.english ? { english: snapshot.title.english } : {}),
        },
        ...(Number.isFinite(year) && year > 1900 ? { releaseYear: year } : {}),
        episodeCount: snapshot.episodes.length,
        speechSpeed: snapshot.stats.speechSpeed,
        difficulty: snapshot.stats.difficulty,
        links: {
            ...(linkOf(LINK_TYPE_ANILIST) ? { anilist: linkOf(LINK_TYPE_ANILIST) } : {}),
            ...(linkOf(LINK_TYPE_MYANIMELIST) ? { myanimelist: linkOf(LINK_TYPE_MYANIMELIST) } : {}),
        },
        source: { name: 'Jiten', url: snapshot.sourceUrl, license: 'CC BY-SA 4.0' },
        episodes: snapshot.episodes.map(episode => ({
            number: episode.number,
            title: episode.title,
            speechSpeed: episode.stats.speechSpeed,
            sourceUniqueWords: episode.words.length,
            words: resolveWords(episode.words, resolve),
        })),
    };
}

export function toIndexEntry(title: MediaTitle): MediaIndexEntry {
    const { episodes, ...entry } = title;
    void episodes;
    return entry;
}

function loadVocabs(): Pick<Vocabulary, 'id' | 'mergedVocabs'>[] {
    const files = fs.readdirSync(VOCAB_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) throw new Error(`No compiled vocab found in ${VOCAB_DIR}. Run build:data first.`);
    return files.map(file => {
        const vocab = JSON.parse(fs.readFileSync(path.join(VOCAB_DIR, file), 'utf-8')) as Vocabulary;
        return { id: vocab.id, mergedVocabs: vocab.mergedVocabs };
    });
}

async function main() {
    console.log('📺 Building media library...');
    const selection = JSON.parse(fs.readFileSync(SELECTION_FILE, 'utf-8')) as MediaSelectionEntry[];
    const resolve = buildVocabResolver(loadVocabs());

    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const index: MediaIndexEntry[] = [];
    for (const { jitenDeckId } of selection) {
        const snapshotPath = path.join(SNAPSHOT_DIR, `${jitenDeckId}.json`);
        if (!fs.existsSync(snapshotPath)) {
            throw new Error(`No snapshot for selected deck ${jitenDeckId}. Run \`bun run fetch:media ${jitenDeckId}\` first.`);
        }
        const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as JitenMediaSnapshot;
        const title = compileTitle(snapshot, resolve);
        fs.writeFileSync(path.join(OUTPUT_DIR, `${title.id}.json`), JSON.stringify(title));
        index.push(toIndexEntry(title));

        const kept = title.episodes.reduce((n, e) => n + e.words.length, 0);
        const seen = title.episodes.reduce((n, e) => n + e.sourceUniqueWords, 0);
        console.log(`   - ${title.title.original}: ${title.episodeCount} episodes, ${kept}/${seen} episode words are Gokan vocabulary`);
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(index));
    console.log(`✅ ${index.length} title(s) written to ${OUTPUT_DIR}.`);
}

if (import.meta.main) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
