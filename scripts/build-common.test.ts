import { describe, it, expect } from 'vitest';
import {
    applyUsuallyKanaOverrides,
    compareMergeBase,
    sortMergeGroup,
    decideUsuallyKana,
    isAffixOnly,
    learningIndexEntry,
    learningRank,
    mayShareHeadword,
    parseJpdbTsv,
    type MergeCandidate,
    type UsuallyKanaInput,
} from './build-common';

describe('parseJpdbTsv', () => {
    it('skips the header and keeps every row of a repeated key, in file order', () => {
        const table = parseJpdbTsv('term\treading\tfrequency\tkana_frequency\nボタン\tボタン\t3397\t\n牡丹\tぼたん\t23652\t42000\nボタン\tボタン\t45485\t\n');
        expect(table.rows.get('ボタン|ボタン')).toEqual([
            { frequency: 3397, kanaFrequency: null },
            { frequency: 45485, kanaFrequency: null },
        ]);
        expect(table.rows.get('牡丹|ぼたん')).toEqual([{ frequency: 23652, kanaFrequency: 42000 }]);
        expect([...table.terms]).toEqual(['ボタン', '牡丹']);
    });
});

describe('decideUsuallyKana', () => {
    const tsv = (rows: string[]) => parseJpdbTsv(['term\treading\tfrequency\tkana_frequency', ...rows].join('\n'));
    const input = (over: Partial<UsuallyKanaInput>): UsuallyKanaInput => ({
        kanji: '此処', reading: 'ここ', readings: ['ここ'], firstSenseUk: true, rareKanjiForm: false, ...over,
    });

    it('flags a uk word whose kana spelling is at least twice as frequent', () => {
        const jpdb = tsv(['此処\tここ\t10545\t56']);
        expect(decideUsuallyKana(input({}), jpdb)).toEqual({ usuallyKana: true, kanaRank: 56 });
    });

    it('needs both the uk tag and the frequency', () => {
        // 分かる is tagged uk, but the kanji spelling is as frequent as the kana one.
        expect(decideUsuallyKana(input({ kanji: '分かる', reading: 'わかる' }), tsv(['分かる\tわかる\t465\t455'])).usuallyKana).toBe(false);
        // 物 is kana-dominant in JPDB, but not tagged uk: its kanji spelling is standard.
        expect(decideUsuallyKana(input({ kanji: '物', reading: 'もの', firstSenseUk: false }), tsv(['物\tもの\t598\t43'])).usuallyKana).toBe(false);
    });

    it('takes no evidence from a row for another reading of the same spelling', () => {
        // JPDB has 皆 only as みんな; that must not make 皆/みな usually-kana.
        const jpdb = tsv(['皆\tみんな\t1313\t178', 'みな\tみな\t1836\t']);
        expect(decideUsuallyKana(input({ kanji: '皆', reading: 'みな' }), jpdb)).toEqual({ usuallyKana: false, kanaRank: null });
    });

    it('lets the rK tag stand in where JPDB has no evidence', () => {
        const jpdb = tsv(['此方\tこっち\t17256\t480']);
        expect(decideUsuallyKana(input({ kanji: '此方', reading: 'こちら', rareKanjiForm: true }), jpdb).usuallyKana).toBe(true);
        // ...but never without the uk tag.
        expect(decideUsuallyKana(input({ kanji: '此方', reading: 'こちら', rareKanjiForm: true, firstSenseUk: false }), jpdb).usuallyKana).toBe(false);
    });

    it('counts the word\'s own katakana spelling when its row is unambiguous', () => {
        const jpdb = tsv(['塵\tごみ\t11614\t17884', 'ゴミ\tゴミ\t3896\t']);
        expect(decideUsuallyKana(input({ kanji: '塵', reading: 'ごみ', readings: ['ごみ', 'ゴミ'] }), jpdb))
            .toEqual({ usuallyKana: true, kanaRank: 3896 });
        // Not a spelling JMdict lists for this word: ignored.
        expect(decideUsuallyKana(input({ kanji: '塵', reading: 'ごみ', readings: ['ごみ'] }), jpdb).usuallyKana).toBe(false);
    });

    it('ignores a katakana row whose key is shared with another word', () => {
        // ボタン is "button" (3397) and the peony's spelling (45485).
        const jpdb = tsv(['牡丹\tぼたん\t23652\t42000', 'ボタン\tボタン\t3397\t', 'ボタン\tボタン\t45485\t']);
        expect(decideUsuallyKana(input({ kanji: '牡丹', reading: 'ぼたん', readings: ['ぼたん', 'ボタン'] }), jpdb).usuallyKana).toBe(false);
    });

    it('uses the standalone kana row when JPDB has no row for the kanji spelling', () => {
        expect(decideUsuallyKana(input({ kanji: '済みません', reading: 'すみません' }), tsv(['すみません\tすみません\t1338\t'])))
            .toEqual({ usuallyKana: true, kanaRank: 1338 });
        // Ambiguous standalone row: no evidence.
        const shared = tsv(['すみません\tすみません\t1338\t', 'すみません\tすみません\t9000\t']);
        expect(decideUsuallyKana(input({ kanji: '済みません', reading: 'すみません' }), shared).usuallyKana).toBe(false);
    });
});

describe('applyUsuallyKanaOverrides', () => {
    const entry = (word: string) => ({ word, why: '' });

    it('removes excluded ids', () => {
        const kept = applyUsuallyKanaOverrides(new Set(['a', 'b']), new Set(['a', 'b', 'c']), { exclude: { b: entry('既に') } });
        expect([...kept]).toEqual(['a']);
    });

    it('rejects an exclusion for an unknown id or a word the rule no longer flags', () => {
        expect(() => applyUsuallyKanaOverrides(new Set(['a']), new Set(['a']), { exclude: { z: entry('?') } })).toThrow(/not a compiled vocab id/);
        expect(() => applyUsuallyKanaOverrides(new Set(['a']), new Set(['a', 'c']), { exclude: { c: entry('?') } })).toThrow(/no longer flagged/);
    });
});

describe('learning-order index helpers', () => {
    const here = { id: '1', writtenForm: { kanji: '此処', alternatives: [], containedKanji: ['此', '処'] }, frequency: { kanjiRank: 10545, kanaRank: 56 } };

    it('ranks a word learned in kana at its kana spelling, any other at its kanji spelling', () => {
        expect(learningRank({ ...here, usuallyKana: true })).toBe(56);
        expect(learningRank(here)).toBe(10545);
        expect(learningRank({ frequency: { kanjiRank: 700 }, usuallyKana: true })).toBe(700);
    });

    it('gives a word learned in kana no kanji to wait on', () => {
        expect(learningIndexEntry({ ...here, usuallyKana: true })).toEqual({ id: '1', containedKanji: [], usuallyKana: true });
        expect(learningIndexEntry(here)).toEqual({ id: '1', containedKanji: ['此', '処'] });
    });
});

describe('compareMergeBase', () => {
    const candidate = (over: Partial<MergeCandidate>): MergeCandidate => ({ affixOnly: false, isCommon: false, spoken: 0, ownRank: null, frequency: { kanjiRank: 999999 }, ...over });

    it('puts a listed reading first, then a word that stands alone before an affix', () => {
        // 時: the suffix じ ("o'clock") is listed at N5, the noun とき at N3.
        const ji = candidate({ affixOnly: true, jlptLevel: 5, spoken: 900 });
        const toki = candidate({ jlptLevel: 3, spoken: 300 });
        expect([ji, toki].sort(compareMergeBase)).toEqual([toki, ji]);
        // 達: the plural suffix たち is listed, the slang noun だち is not.
        const tachi = candidate({ affixOnly: true, jlptLevel: 5 });
        const dachi = candidate({ spoken: 50 });
        expect([dachi, tachi].sort(compareMergeBase)).toEqual([tachi, dachi]);
    });

    it('demotes an affix only for a common standalone word in the group', () => {
        // 時: とき is a common word, so the N5 suffix じ does not become the base.
        const ji = candidate({ affixOnly: true, isCommon: true, jlptLevel: 5 });
        const toki = candidate({ isCommon: true, jlptLevel: 3 });
        expect(sortMergeGroup([ji, toki])).toEqual([toki, ji]);
        // 氏: うじ "clan" (N1) is not common, so the level decides and し "Mr.; he" (N3) wins.
        const shi = candidate({ affixOnly: true, isCommon: true, jlptLevel: 3 });
        const uji = candidate({ jlptLevel: 1 });
        expect(sortMergeGroup([uji, shi])).toEqual([shi, uji]);
    });

    it('puts the reading the JLPT lists put easiest first', () => {
        // 上手: じょうず is N5, うわて N1, かみて unlisted.
        const jouzu = candidate({ jlptLevel: 5, ownRank: 3000 });
        const uwate = candidate({ jlptLevel: 1, ownRank: 100 });
        const kamite = candidate({ ownRank: 50, spoken: 900 });
        expect([kamite, uwate, jouzu].sort(compareMergeBase)).toEqual([jouzu, uwate, kamite]);
    });

    it('then the reading anime says most, over a JPDB row a homophone inflates', () => {
        // 内: JPDB ranks 内|ない through the auxiliary ない; Jiten counts うち 1925 times.
        const nai = candidate({ ownRank: 20, spoken: 19 });
        const uchi = candidate({ ownRank: 4000, spoken: 1925 });
        expect([nai, uchi].sort(compareMergeBase)).toEqual([uchi, nai]);
    });

    it('then a word ranked on its own reading before one ranked on a stand-in row', () => {
        // 点/ちょぼ borrowed 点/てん's rank and tied with it.
        const chobo = candidate({ frequency: { kanjiRank: 829 } });
        const ten = candidate({ ownRank: 829, frequency: { kanjiRank: 829 } });
        expect([chobo, ten].sort(compareMergeBase)).toEqual([ten, chobo]);
    });

    it('orders words that both have their own rows by those rows, then by the stand-in rank', () => {
        const kochira = candidate({ ownRank: 17256 });
        const konata = candidate({ ownRank: 90000, frequency: { kanjiRank: 90000 } });
        expect([konata, kochira].sort(compareMergeBase)).toEqual([kochira, konata]);
        const a = candidate({ frequency: { kanjiRank: 50 } });
        const b = candidate({ frequency: { kanjiRank: 10 } });
        expect([a, b].sort(compareMergeBase)).toEqual([b, a]);
    });
});

describe('isAffixOnly', () => {
    it('is true only when every part of speech is an affix', () => {
        expect(isAffixOnly(['suf'])).toBe(true);
        expect(isAffixOnly(['n-suf', 'ctr'])).toBe(true);
        expect(isAffixOnly(['suf', 'adj-na'])).toBe(false);
        expect(isAffixOnly([])).toBe(false);
    });
});

describe('mayShareHeadword', () => {
    it('lets a word merge only under a normal spelling of it', () => {
        expect(mayShareHeadword([])).toBe(true);
        // 彼 for あれ is rK; 米 for メートル is ateji; 乃 for の is search-only.
        for (const tag of ['rK', 'sK', 'ateji', 'iK', 'oK']) expect(mayShareHeadword([tag])).toBe(false);
    });
});
