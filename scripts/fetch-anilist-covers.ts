import fs from 'fs';
import path from 'path';
import type { JitenMediaSnapshot, MediaCoverSnapshot, MediaSelectionEntry } from '../src/models/media.model';

/**
 * Records each selected title's AniList cover image URLs in
 * `data/raw/media/covers.json`, keyed by Jiten deck id.
 *
 * Only the URLs are stored, never the images: cover art belongs to the studios
 * and is not part of any data this repository can license, so a consumer that
 * shows it loads it from AniList's CDN at display time, the way AniList's own
 * API clients do. The AniList id comes from the link Jiten already records for
 * the title, so run `fetch:media` first for a newly selected title.
 *
 * Run by hand (`bun run fetch:covers`), like fetch:media. One GraphQL request
 * covers every title.
 */

const SELECTION_FILE = './data/raw/media/selection.json';
const SNAPSHOT_DIR = './data/raw/media/jiten';
const OUTPUT_FILE = './data/raw/media/covers.json';
const ANILIST_API = 'https://graphql.anilist.co';
const ANILIST_LINK = /anilist\.co\/anime\/(\d+)/;

const QUERY = `query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids, type: ANIME) { id coverImage { large extraLarge color } }
  }
}`;

interface AniListMedia {
    id: number;
    coverImage: { large: string | null; extraLarge: string | null; color: string | null };
}

/** The AniList id a snapshot links to, or null when Jiten records none. */
export function anilistIdOf(snapshot: Pick<JitenMediaSnapshot, 'links'>): number | null {
    for (const link of snapshot.links) {
        const match = ANILIST_LINK.exec(link.url);
        if (match) return Number(match[1]);
    }
    return null;
}

async function main() {
    const selection = JSON.parse(fs.readFileSync(SELECTION_FILE, 'utf-8')) as MediaSelectionEntry[];
    const anilistIdByDeck = new Map<number, number>();
    for (const { jitenDeckId } of selection) {
        const snapshotPath = path.join(SNAPSHOT_DIR, `${jitenDeckId}.json`);
        if (!fs.existsSync(snapshotPath)) throw new Error(`No snapshot for ${jitenDeckId}. Run \`bun run fetch:media ${jitenDeckId}\` first.`);
        const anilistId = anilistIdOf(JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as JitenMediaSnapshot);
        if (anilistId === null) console.warn(`   ⚠ ${jitenDeckId} has no AniList link; it will have no cover.`);
        else anilistIdByDeck.set(jitenDeckId, anilistId);
    }

    const response = await fetch(ANILIST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { ids: [...anilistIdByDeck.values()] } }),
    });
    if (!response.ok) throw new Error(`AniList: ${response.status} ${response.statusText}`);
    const body = await response.json() as { data: { Page: { media: AniListMedia[] } } };
    const mediaById = new Map(body.data.Page.media.map(m => [m.id, m]));

    const covers: Record<string, MediaCoverSnapshot> = {};
    for (const [deckId, anilistId] of anilistIdByDeck) {
        const media = mediaById.get(anilistId);
        const url = media?.coverImage.large ?? media?.coverImage.extraLarge;
        if (!media || !url) {
            console.warn(`   ⚠ AniList returned no cover for ${deckId} (AniList ${anilistId}).`);
            continue;
        }
        covers[deckId] = {
            anilistId,
            url,
            urlHiRes: media.coverImage.extraLarge ?? url,
            ...(media.coverImage.color ? { color: media.coverImage.color } : {}),
        };
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(covers, null, 2) + '\n');
    console.log(`✅ ${Object.keys(covers).length} cover(s) written to ${OUTPUT_FILE}. Run build:media next.`);
}

if (import.meta.main) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
