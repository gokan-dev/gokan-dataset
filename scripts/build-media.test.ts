import { describe, it, expect } from 'vitest';
import { buildVocabResolver, compileTitle, resolveWords, seriesWords, toIndexEntry } from './build-media';
import { isEligible } from './select-easiest-anime';
import { anilistIdOf } from './fetch-anilist-covers';
import type { JitenMediaSnapshot } from '../src/models/media.model';

const resolver = buildVocabResolver([
    { id: '1358280' }, // 食べる
    {
        id: '1000420', // あの, with かの merged into it
        mergedVocabs: [
            { id: '1000420', isBase: true, originalPrimaryReading: 'あの', originalGlosses: [] },
            { id: '2845746', isBase: false, originalPrimaryReading: 'かの', originalGlosses: [] },
        ],
    },
]);

const stats = { characterCount: 0, wordCount: 0, uniqueWordCount: 0, uniqueKanjiCount: 0, speechSpeed: 290, difficulty: 1.01 };

function snapshot(overrides: Partial<JitenMediaSnapshot> = {}): JitenMediaSnapshot {
    return {
        source: 'jiten',
        deckId: 16685,
        fetchedAt: '2026-10-04T00:00:00.000Z',
        sourceUrl: 'https://jiten.moe/decks/media/16685/detail',
        mediaType: 1,
        title: { original: 'のんのんびより', romaji: 'Non Non Biyori', english: null },
        releaseDate: '2013-10-08T00:00:00',
        links: [
            { type: 4, url: 'https://anilist.co/anime/17549' },
            { type: 5, url: 'https://myanimelist.net/anime/17549' },
            { type: 9, url: 'https://example.com/other' },
        ],
        stats,
        episodes: [
            { deckId: 16686, number: 1, title: 'Episode 1', stats: { ...stats, speechSpeed: 295 }, words: [[1358280, 3], [9999999, 40], [2845746, 2], [1000420, 5]] },
        ],
        ...overrides,
    };
}

describe('buildVocabResolver', () => {
    it('resolves a vocab id to itself', () => {
        expect(resolver(1358280)).toBe('1358280');
    });

    it('redirects a merged homograph to its base entry', () => {
        expect(resolver(2845746)).toBe('1000420');
    });

    it('returns null for a word that is not Gokan vocabulary', () => {
        expect(resolver(9999999)).toBeNull();
    });
});

describe('resolveWords', () => {
    it('drops unknown ids and sums ids that share a base, most frequent first', () => {
        expect(resolveWords([[1358280, 3], [9999999, 40], [2845746, 2], [1000420, 5]], resolver))
            .toEqual([['1000420', 7], ['1358280', 3]]);
    });

    it('breaks occurrence ties by id so the output is deterministic', () => {
        expect(resolveWords([[1358280, 2], [1000420, 2]], resolver)).toEqual([['1000420', 2], ['1358280', 2]]);
    });
});

describe('compileTitle', () => {
    it('keeps only Gokan vocabulary while recording how many words the episode had', () => {
        const title = compileTitle(snapshot(), resolver);
        expect(title.episodes[0].words).toEqual([['1000420', 7], ['1358280', 3]]);
        expect(title.episodes[0].sourceUniqueWords).toBe(4);
        expect(title.episodes[0].speechSpeed).toBe(295);
    });

    it('carries the catalogue links and the Jiten attribution', () => {
        const title = compileTitle(snapshot(), resolver);
        expect(title.links).toEqual({ anilist: 'https://anilist.co/anime/17549', myanimelist: 'https://myanimelist.net/anime/17549' });
        expect(title.source).toEqual({ name: 'Jiten', url: 'https://jiten.moe/decks/media/16685/detail', license: 'CC BY-SA 4.0' });
        expect(title.releaseYear).toBe(2013);
    });

    it('omits missing titles and an unknown release date rather than writing nulls', () => {
        const title = compileTitle(snapshot({ releaseDate: null }), resolver);
        expect(title.title).toEqual({ original: 'のんのんびより', romaji: 'Non Non Biyori' });
        expect('releaseYear' in title).toBe(false);
    });
});

describe('covers', () => {
    it('reads the AniList id from the link Jiten records', () => {
        expect(anilistIdOf(snapshot())).toBe(17549);
        expect(anilistIdOf(snapshot({ links: [] }))).toBeNull();
    });

    it('attaches an AniList cover URL, credited, when one was fetched', () => {
        const title = compileTitle(snapshot(), resolver, {
            anilistId: 17549, url: 'https://s4.anilist.co/a.png', urlHiRes: 'https://s4.anilist.co/b.png', color: '#50e4bb',
        });
        expect(title.cover).toEqual({ url: 'https://s4.anilist.co/a.png', urlHiRes: 'https://s4.anilist.co/b.png', color: '#50e4bb', source: 'AniList' });
    });

    it('leaves the cover out when none was fetched', () => {
        expect('cover' in compileTitle(snapshot(), resolver)).toBe(false);
    });
});

describe('genres, tags and series words', () => {
    it('names Jiten genre ids and keeps only strongly voted tags, at most five', () => {
        const title = compileTitle(snapshot({
            genres: [3, 14, 99],
            tags: [
                { name: 'Countryside', percentage: 95 }, { name: 'School', percentage: 71 }, { name: 'A', percentage: 70 },
                { name: 'B', percentage: 65 }, { name: 'C', percentage: 61 }, { name: 'D', percentage: 60 }, { name: 'Weak', percentage: 40 },
            ],
        }), resolver);
        expect(title.genres).toEqual(['Comedy', 'Slice of Life']);
        expect(title.tags).toEqual(['Countryside', 'School', 'A', 'B', 'C']);
    });

    it('treats a snapshot taken before genres were recorded as having none', () => {
        const title = compileTitle(snapshot(), resolver);
        expect(title.genres).toEqual([]);
        expect(title.tags).toEqual([]);
    });

    it('sums each word across every episode for the series list', () => {
        const title = compileTitle(snapshot({
            episodes: [
                { deckId: 1, number: 1, title: 'Episode 1', stats, words: [[1358280, 3]] },
                { deckId: 2, number: 2, title: 'Episode 2', stats, words: [[1358280, 2], [1000420, 4]] },
            ],
        }), resolver);
        expect(seriesWords(title)).toEqual([['1358280', 5], ['1000420', 4]]);
    });
});

describe('isEligible', () => {
    it('keeps an ordinary title and skips adult, ecchi and long-running ones', () => {
        expect(isEligible([3, 14], 12)).toBe(true);
        expect(isEligible([3, 5], 12)).toBe(false);
        expect(isEligible([18], 1)).toBe(false);
        expect(isEligible([3], 53)).toBe(false);
    });
});

describe('toIndexEntry', () => {
    it('is the title without its episodes', () => {
        const entry = toIndexEntry(compileTitle(snapshot(), resolver));
        expect('episodes' in entry).toBe(false);
        expect(entry.episodeCount).toBe(1);
    });
});
