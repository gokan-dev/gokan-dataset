import fs from 'fs';
import type { MediaSelectionEntry } from '../src/models/media.model';

/**
 * Adds Jiten's easiest anime to `data/raw/media/selection.json`, so the
 * listening library always has something a beginner can follow.
 *
 * Walks Jiten's difficulty ranking for anime, easiest first, and appends the
 * first titles that pass the filters below until the selection holds `target`
 * titles marked `source: 'easiest'` (100 by default). Hand-picked entries are
 * never touched or counted. Run by hand (`bun run select:media [target]`), then
 * `fetch:media` to snapshot the new titles.
 *
 * Filters, each for a reason:
 * - Adult and Ecchi genres are skipped: this is a study app, and the library's
 *   covers show on the Main hub. Such a title can still be added by hand.
 * - Titles over MAX_EPISODES are skipped: a long-runner (Doraemon has hundreds
 *   of episodes) would cost thousands of API requests and a multi-megabyte file
 *   for a list nobody scrolls to the end of.
 */

const API = 'https://api.jiten.moe/api';
const SELECTION_FILE = './data/raw/media/selection.json';
const ANIME = 1;
const EXCLUDED_GENRES = new Set([5, 18]); // Ecchi, Adult
const MAX_EPISODES = 52;
const DELAY_MS = 750;
const USER_AGENT = 'gokan-dataset (https://github.com/gokan-dev/gokan-dataset)';

interface RankedRow { deckId: number; originalTitle: string; difficulty: number }
interface DeckDetail { mainDeck: { genres?: number[]; childrenDeckCount?: number } ; subDecks: unknown[] }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function getJson<T>(url: string): Promise<T> {
    await sleep(DELAY_MS);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
    return response.json() as Promise<T>;
}

/** Whether a ranked title belongs in the library; exported for tests. */
export function isEligible(genres: number[], episodeCount: number): boolean {
    return !genres.some(g => EXCLUDED_GENRES.has(g)) && episodeCount <= MAX_EPISODES;
}

async function main() {
    const target = Number(process.argv[2] ?? 100);
    const selection = JSON.parse(fs.readFileSync(SELECTION_FILE, 'utf-8')) as MediaSelectionEntry[];
    const selected = new Set(selection.map(s => s.jitenDeckId));
    let easiestCount = selection.filter(s => s.source === 'easiest').length;
    console.log(`📋 ${easiestCount} easiest title(s) already selected, target ${target}.`);

    for (let page = 1; easiestCount < target; page++) {
        const ranked = await getJson<{ data: RankedRow[] }>(`${API}/media-deck/get-media-decks-by-type-ranked/${ANIME}?page=${page}`);
        if (ranked.data.length === 0) break;

        for (const row of ranked.data) {
            if (easiestCount >= target) break;
            if (selected.has(row.deckId)) continue;

            const detail = (await getJson<{ data: DeckDetail }>(`${API}/media-deck/${row.deckId}/detail`)).data;
            const episodes = detail.subDecks.length || 1;
            if (!isEligible(detail.mainDeck.genres ?? [], episodes)) {
                console.log(`   skip ${row.originalTitle} (${episodes} episodes, genres ${detail.mainDeck.genres?.join(',') ?? 'none'})`);
                continue;
            }

            easiestCount++;
            selected.add(row.deckId);
            selection.push({
                jitenDeckId: row.deckId,
                note: `${row.originalTitle} (easiest #${easiestCount}, difficulty ${row.difficulty.toFixed(2)})`,
                source: 'easiest',
            });
            console.log(`   + ${row.originalTitle}`);
        }
    }

    const json = '[\n' + selection.map(s => '    ' + JSON.stringify(s)).join(',\n') + '\n]\n';
    fs.writeFileSync(SELECTION_FILE, json);
    console.log(`✅ selection.json now holds ${selection.length} titles (${easiestCount} easiest). Run fetch:media next.`);
}

if (import.meta.main) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
