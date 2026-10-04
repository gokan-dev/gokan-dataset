import fs from 'fs';
import path from 'path';
import type { JitenDeckStats, JitenMediaSnapshot, JitenWordCount, MediaSelectionEntry } from '../src/models/media.model';

/**
 * Snapshots the hand-picked titles in `data/raw/media/selection.json` from
 * Jiten's public API into `data/raw/media/jiten/{deckId}.json`.
 *
 * Run by hand (`bun run fetch:media`), never as part of a build: the snapshot is
 * committed like every other raw source, so builds stay offline and
 * reproducible, and Jiten is only asked for data when the selection changes.
 *
 * Jiten's terms allow API use within its rate limits and forbid systematic
 * extraction of the whole database, so this only ever fetches the selected
 * titles, one request at a time with a pause between each. Its derived data is
 * CC BY-SA 4.0, attribution required (see README).
 *
 * Usage: `bun run fetch:media` refreshes every selected title; pass deck ids
 * (`bun run fetch:media 16685`) to refresh only those.
 */

const API = 'https://api.jiten.moe/api';
const SELECTION_FILE = './data/raw/media/selection.json';
const OUTPUT_DIR = './data/raw/media/jiten';
const PAGE_SIZE = 200; // the API's own maximum
const DELAY_MS = 750;
const USER_AGENT = 'gokan-dataset (https://github.com/gokan-dev/gokan-dataset)';

interface ApiDeck {
    deckId: number;
    mediaType: number;
    originalTitle: string;
    romajiTitle: string | null;
    englishTitle: string | null;
    releaseDate: string | null;
    characterCount: number;
    wordCount: number;
    uniqueWordCount: number;
    uniqueKanjiCount: number;
    speechSpeed: number | null;
    difficultyRaw: number | null;
    links?: { linkType: number; url: string }[];
}

interface ApiVocabularyPage {
    data: { words: { wordId: number; occurrences: number }[] } | null;
    totalItems: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getJson<T>(url: string, attempt = 1): Promise<T> {
    await sleep(DELAY_MS);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (response.status === 429 && attempt <= 5) {
        const wait = Number(response.headers.get('retry-after') ?? 0) * 1000 || attempt * 5000;
        console.warn(`   rate limited, waiting ${wait / 1000}s`);
        await sleep(wait);
        return getJson<T>(url, attempt + 1);
    }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
    return response.json() as Promise<T>;
}

function statsOf(deck: ApiDeck): JitenDeckStats {
    return {
        characterCount: deck.characterCount,
        wordCount: deck.wordCount,
        uniqueWordCount: deck.uniqueWordCount,
        uniqueKanjiCount: deck.uniqueKanjiCount,
        speechSpeed: Math.round(deck.speechSpeed ?? 0),
        difficulty: Math.round((deck.difficultyRaw ?? 0) * 100) / 100,
    };
}

/** "Episode 12" -> 12; anything else keeps its position in Jiten's list. */
function episodeNumber(title: string, position: number): number {
    const match = /(\d+)/.exec(title);
    return match ? Number(match[1]) : position + 1;
}

async function fetchWords(deckId: number): Promise<JitenWordCount[]> {
    const counts = new Map<number, number>();
    let offset = 0;
    let total = Infinity;
    // Default ordering is by Jiten's own row id, which is stable, so pages never
    // overlap or skip.
    while (offset < total) {
        const page = await getJson<ApiVocabularyPage>(`${API}/media-deck/${deckId}/vocabulary?limit=${PAGE_SIZE}&offset=${offset}`);
        total = page.totalItems;
        const words = page.data?.words ?? [];
        if (words.length === 0) break;
        for (const w of words) counts.set(w.wordId, (counts.get(w.wordId) ?? 0) + w.occurrences);
        offset += words.length;
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

async function fetchTitle(deckId: number): Promise<JitenMediaSnapshot> {
    const detail = await getJson<{ data: { mainDeck: ApiDeck; subDecks: ApiDeck[] } }>(`${API}/media-deck/${deckId}/detail`);
    const { mainDeck, subDecks } = detail.data;
    console.log(`📺 ${mainDeck.originalTitle} (${subDecks.length} episodes)`);

    const episodes: JitenMediaSnapshot['episodes'] = [];
    for (const [position, sub] of subDecks.entries()) {
        const words = await fetchWords(sub.deckId);
        episodes.push({
            deckId: sub.deckId,
            number: episodeNumber(sub.originalTitle, position),
            title: sub.originalTitle,
            stats: statsOf(sub),
            words,
        });
        console.log(`   - ${sub.originalTitle}: ${words.length} words`);
    }
    episodes.sort((a, b) => a.number - b.number);

    return {
        source: 'jiten',
        deckId,
        fetchedAt: new Date().toISOString(),
        sourceUrl: `https://jiten.moe/decks/media/${deckId}/detail`,
        mediaType: mainDeck.mediaType,
        title: { original: mainDeck.originalTitle, romaji: mainDeck.romajiTitle, english: mainDeck.englishTitle },
        releaseDate: mainDeck.releaseDate,
        links: (mainDeck.links ?? []).map(l => ({ type: l.linkType, url: l.url })),
        stats: statsOf(mainDeck),
        episodes,
    };
}

async function main() {
    const selection = JSON.parse(fs.readFileSync(SELECTION_FILE, 'utf-8')) as MediaSelectionEntry[];
    const only = new Set(process.argv.slice(2).map(Number));
    const targets = selection.filter(s => only.size === 0 || only.has(s.jitenDeckId));
    if (targets.length === 0) throw new Error('Nothing to fetch: no selected deck matches the given ids.');

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    for (const { jitenDeckId } of targets) {
        const snapshot = await fetchTitle(jitenDeckId);
        // Indented so a refresh diffs readably, with each [wordId, count] pair kept
        // on one line rather than spread over four.
        const json = JSON.stringify(snapshot, null, 1).replace(/\[\s*(\d+),\s*(\d+)\s*\]/g, '[$1,$2]');
        fs.writeFileSync(path.join(OUTPUT_DIR, `${jitenDeckId}.json`), json + '\n');
    }
    console.log(`✅ ${targets.length} title(s) snapshotted into ${OUTPUT_DIR}. Run build:media next.`);
}

if (import.meta.main) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
