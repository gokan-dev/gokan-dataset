import fs from 'fs';
import path from 'path';
import type { Vocabulary } from '../src/models/vocabulary.model';
import type { JitenMediaSnapshot, MediaCoverSnapshot, MediaIndexEntry, MediaLibraryWords, MediaSelectionEntry, MediaTitle, MediaWordCount } from '../src/models/media.model';
import { JITEN_GENRES } from '../src/models/media.model';

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
const COVERS_FILE = './data/raw/media/covers.json';
const VOCAB_DIR = './compiled/vocab';
const OUTPUT_DIR = './compiled/media';

/** A tag is kept when at least this share of Jiten's voters agree, and at most MAX_TAGS of them. */
const MIN_TAG_PERCENTAGE = 60;
const MAX_TAGS = 5;

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

export function compileTitle(snapshot: JitenMediaSnapshot, resolve: VocabResolver, cover?: MediaCoverSnapshot): MediaTitle {
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
        genres: (snapshot.genres ?? []).map(id => JITEN_GENRES[id]).filter((name): name is string => Boolean(name)),
        tags: (snapshot.tags ?? []).filter(t => t.percentage >= MIN_TAG_PERCENTAGE).slice(0, MAX_TAGS).map(t => t.name),
        links: {
            ...(linkOf(LINK_TYPE_ANILIST) ? { anilist: linkOf(LINK_TYPE_ANILIST) } : {}),
            ...(linkOf(LINK_TYPE_MYANIMELIST) ? { myanimelist: linkOf(LINK_TYPE_MYANIMELIST) } : {}),
        },
        ...(cover ? {
            cover: { url: cover.url, urlHiRes: cover.urlHiRes, ...(cover.color ? { color: cover.color } : {}), source: 'AniList' as const },
        } : {}),
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

/** A whole series' word list: every episode's counts summed, most frequent first. */
export function seriesWords(title: MediaTitle): MediaWordCount[] {
    const counts = new Map<string, number>();
    for (const episode of title.episodes) {
        for (const [vocabId, count] of episode.words) counts.set(vocabId, (counts.get(vocabId) ?? 0) + count);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
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
    // Optional: a title without a cover still compiles, the library just shows a plain card.
    const covers: Record<string, MediaCoverSnapshot> = fs.existsSync(COVERS_FILE)
        ? JSON.parse(fs.readFileSync(COVERS_FILE, 'utf-8'))
        : {};

    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // A selected title without a snapshot fails the build, unless --allow-missing:
    // fetch:media over a long selection takes hours, and a partial library is
    // worth shipping while it runs. The skipped ids are always listed.
    const allowMissing = process.argv.includes('--allow-missing');
    const missing: number[] = [];
    const index: MediaIndexEntry[] = [];
    const library: MediaLibraryWords = {};
    for (const { jitenDeckId } of selection) {
        const snapshotPath = path.join(SNAPSHOT_DIR, `${jitenDeckId}.json`);
        if (!fs.existsSync(snapshotPath)) {
            if (allowMissing) { missing.push(jitenDeckId); continue; }
            throw new Error(`No snapshot for selected deck ${jitenDeckId}. Run \`bun run fetch:media\` first (or build with --allow-missing).`);
        }
        const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as JitenMediaSnapshot;
        const title = compileTitle(snapshot, resolve, covers[String(jitenDeckId)]);
        fs.writeFileSync(path.join(OUTPUT_DIR, `${title.id}.json`), JSON.stringify(title));
        index.push(toIndexEntry(title));
        library[title.id] = seriesWords(title);

        const kept = title.episodes.reduce((n, e) => n + e.words.length, 0);
        const seen = title.episodes.reduce((n, e) => n + e.sourceUniqueWords, 0);
        console.log(`   - ${title.title.original}: ${title.episodeCount} episodes, ${kept}/${seen} episode words are Gokan vocabulary`);
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(index));
    // Separate from index.json, which the Main hub loads just for covers: only
    // the library page needs every title's words, to rank them by coverage.
    fs.writeFileSync(path.join(OUTPUT_DIR, 'library.json'), JSON.stringify(library));
    if (missing.length > 0) console.warn(`   ⚠ ${missing.length} selected title(s) skipped, no snapshot yet: ${missing.join(', ')}`);
    console.log(`✅ ${index.length} title(s) written to ${OUTPUT_DIR}.`);
}

if (import.meta.main) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
