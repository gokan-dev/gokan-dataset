import { describe, it, expect } from 'vitest';
import {
    applyUsuallyKanaOverrides,
    buildKanaKeyOwners,
    compareMergeBase,
    decideUsuallyKana,
    learningIndexEntry,
    learningRank,
    parseJpdbTsv,
    resolveJlptLevel,
    type JpdbFrequencies,
    type KanaKeyOwners,
    type UsuallyKanaInput,
} from './build-common';

type Dataset = Record<string, Array<{ reading: string; level: number }>>;

const NO_OWNERS: KanaKeyOwners = new Map();

function word(id: string, kanji: string[], kana: string[], opts: { uk?: boolean; commonKana?: boolean } = {}) {
    return {
        id,
        kanji: kanji.map(text => ({ text })),
        kana: kana.map(text => ({ text, common: opts.commonKana ?? true, tags: [] as string[] })),
        sense: [{ misc: opts.uk ? ['uk'] : [] }],
    };
}

describe('resolveJlptLevel', () => {
    it('matches on the primary written form', () => {
        const data: Dataset = { 本: [{ reading: 'ほん', level: 5 }] };
        expect(resolveJlptLevel(data, '1', ['本'], ['ほん'], NO_OWNERS)).toBe(5);
    });

    it('prefers the entry whose reading is this word\'s primary reading', () => {
        const data: Dataset = {
            上手: [{ reading: 'じょうず', level: 5 }, { reading: 'うわて', level: 1 }],
        };
        expect(resolveJlptLevel(data, '1', ['上手'], ['うわて', 'じょうず'], NO_OWNERS)).toBe(1);
    });

    it('falls back to a listed alternative reading, then to the first entry', () => {
        const data: Dataset = {
            上手: [{ reading: 'じょうず', level: 5 }, { reading: 'うわて', level: 1 }],
        };
        // Primary reading absent from the dataset, an alternative present.
        expect(resolveJlptLevel(data, '1', ['上手'], ['かみて', 'うわて'], NO_OWNERS)).toBe(1);
        // No reading in common at all: the dataset's own first entry stands.
        expect(resolveJlptLevel(data, '1', ['上手'], ['かみて'], NO_OWNERS)).toBe(5);
    });

    it('matches on an alternative written form when the headword is absent', () => {
        // JMDict heads this 近づく; the JLPT list writes it 近付く.
        const data: Dataset = { 近付く: [{ reading: 'ちかづく', level: 1 }] };
        expect(resolveJlptLevel(data, '1', ['近づく', '近付く'], ['ちかづく'], NO_OWNERS)).toBe(1);
    });

    it('matches on a kana key this entry owns', () => {
        // 鞄 is listed only as かばん.
        const data: Dataset = { かばん: [{ reading: 'かばん', level: 5 }] };
        const owners: KanaKeyOwners = new Map([['かばん', 'bag']]);
        expect(resolveJlptLevel(data, 'bag', ['鞄', '革包'], ['かばん', 'カバン'], owners)).toBe(5);
    });

    it('ignores a kana key another entry owns, even on the same primary reading', () => {
        // The N5 せっけん is soap (石鹸); 席巻 reads せっけん too.
        const data: Dataset = { せっけん: [{ reading: 'せっけん', level: 5 }] };
        const owners: KanaKeyOwners = new Map([['せっけん', 'soap']]);
        expect(resolveJlptLevel(data, 'sweep', ['席巻'], ['せっけん'], owners)).toBeUndefined();
        expect(resolveJlptLevel(data, 'sweep', ['席巻'], ['せっけん'], NO_OWNERS)).toBeUndefined();
    });

    it('matches an owned kana key that is not the primary reading', () => {
        // 皆 reads みな first; the N5 みんな is still this word.
        const data: Dataset = { みんな: [{ reading: 'みんな', level: 5 }] };
        const owners: KanaKeyOwners = new Map([['みんな', 'all']]);
        expect(resolveJlptLevel(data, 'all', ['皆'], ['みな', 'みんな'], owners)).toBe(5);
    });

    it('takes the easiest level when the written form and an owned kana key disagree', () => {
        // The source lists 綺麗 at N1 and きれい at N5.
        const data: Dataset = {
            綺麗: [{ reading: 'きれい', level: 1 }],
            きれい: [{ reading: 'きれい', level: 5 }],
        };
        const owners: KanaKeyOwners = new Map([['きれい', 'pretty']]);
        expect(resolveJlptLevel(data, 'pretty', ['綺麗'], ['きれい'], owners)).toBe(5);
    });

    it('keeps the written-form level when the kana key is easier but not owned', () => {
        const data: Dataset = {
            熱い: [{ reading: 'あつい', level: 4 }],
            あつい: [{ reading: 'あつい', level: 5 }],
        };
        const owners: KanaKeyOwners = new Map([['あつい', 'hot-weather']]);
        expect(resolveJlptLevel(data, 'hot-to-touch', ['熱い'], ['あつい'], owners)).toBe(4);
    });

    it('takes the easiest of a kana key\'s levels, ignoring entries for another reading', () => {
        const data: Dataset = {
            ここ: [{ reading: 'ここ', level: 3 }, { reading: 'ここ', level: 5 }],
            ほう: [{ reading: 'より', level: 1 }, { reading: 'ほう', level: 4 }],
        };
        const owners: KanaKeyOwners = new Map([['ここ', 'here'], ['ほう', 'side']]);
        expect(resolveJlptLevel(data, 'here', ['此処'], ['ここ'], owners)).toBe(5);
        expect(resolveJlptLevel(data, 'side', ['方'], ['ほう'], owners)).toBe(4);
    });

    it('returns undefined when nothing matches', () => {
        expect(resolveJlptLevel({}, '1', ['鞄'], ['かばん'], NO_OWNERS)).toBeUndefined();
    });
});

describe('buildKanaKeyOwners', () => {
    const jpdb: JpdbFrequencies = {
        石鹸: { せっけん: { frequency: 15000, kanaFrequency: 40000 } },
        席巻: { せっけん: { frequency: 30000, kanaFrequency: null } },
        遣る: { やる: { frequency: 90000, kanaFrequency: 60 } },
        殺る: { やる: { frequency: 50000, kanaFrequency: 9000 } },
    };

    it('awards a kanji word spelled in kana to its most frequent reading', () => {
        const owners = buildKanaKeyOwners(
            { せっけん: [] },
            [word('sweep', ['席巻'], ['せっけん']), word('soap', ['石鹸'], ['せっけん'])],
            jpdb,
        );
        expect(owners.get('せっけん')).toBe('soap');
    });

    it('prefers a word usually written in kana over a more frequent kanji homophone', () => {
        const owners = buildKanaKeyOwners(
            { やる: [] },
            [word('kill', ['殺る'], ['やる']), word('do', ['遣る'], ['やる'], { uk: true })],
            jpdb,
        );
        expect(owners.get('やる')).toBe('do');
    });

    it('awards a key to a kana-only word, so no kanji homophone takes it', () => {
        // はい "yes" has no kanji; 灰 (ash) must not inherit the N5 はい.
        const owners = buildKanaKeyOwners(
            { はい: [] },
            [word('ash', ['灰'], ['はい']), word('yes', [], ['はい'])],
            {},
        );
        expect(owners.get('はい')).toBe('yes');
    });

    it('ranks a common kana spelling first', () => {
        const owners = buildKanaKeyOwners(
            { いす: [] },
            [word('rare', ['倚子'], ['いす'], { commonKana: false }), word('chair', ['椅子'], ['いす'])],
            {},
        );
        expect(owners.get('いす')).toBe('chair');
    });

    it('ignores search-only spellings and keys written in kanji', () => {
        const searchOnly = word('x', ['某'], ['ほげ']);
        searchOnly.kana[0].tags.push('sk');
        const owners = buildKanaKeyOwners({ ほげ: [], 本: [] }, [searchOnly, word('book', ['本'], ['ほん'])], {});
        expect(owners.has('ほげ')).toBe(false);
        expect(owners.has('本')).toBe(false);
    });

    it('applies an override, including null', () => {
        const words = [word('vomit', ['吐く'], ['はく'], { uk: true }), word('wear', ['履く'], ['はく'])];
        const overridden = buildKanaKeyOwners({ はく: [] }, words, {}, {
            owners: { はく: { owner: 'wear', why: '' } },
        });
        expect(overridden.get('はく')).toBe('wear');
        const cleared = buildKanaKeyOwners({ はく: [] }, words, {}, {
            owners: { はく: { owner: null, why: '' } },
        });
        expect(cleared.get('はく')).toBeNull();
    });

    it('rejects an override that names a word without that reading, or an unknown key', () => {
        const words = [word('wear', ['履く'], ['はく']), word('bridge', ['橋'], ['はし'])];
        expect(() => buildKanaKeyOwners({ はく: [] }, words, {}, {
            owners: { はく: { owner: 'bridge', why: '' } },
        })).toThrow(/not a JMdict entry/);
        expect(() => buildKanaKeyOwners({ はく: [] }, words, {}, {
            owners: { はし: { owner: 'bridge', why: '' } },
        })).toThrow(/not a key/);
    });
});

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
    it('puts a word ranked on its own reading before one ranked on a stand-in row', () => {
        // 点/ちょぼ borrowed 点/てん's rank and tied with it.
        const chobo = { ownRank: null, frequency: { kanjiRank: 829 } };
        const ten = { ownRank: 829, frequency: { kanjiRank: 829 } };
        expect([chobo, ten].sort(compareMergeBase)).toEqual([ten, chobo]);
    });

    it('orders words that both have their own rows by those rows', () => {
        // 此方: the こちら entry owns JPDB's こっち row (17256); こなた has a rarer one.
        const kochira = { ownRank: 17256, frequency: { kanjiRank: 999999 } };
        const konata = { ownRank: 90000, frequency: { kanjiRank: 90000 } };
        expect([konata, kochira].sort(compareMergeBase)).toEqual([kochira, konata]);
    });

    it('falls back to the stand-in rank when neither has a row of its own', () => {
        const a = { ownRank: null, frequency: { kanjiRank: 50 } };
        const b = { ownRank: null, frequency: { kanjiRank: 10 } };
        expect([a, b].sort(compareMergeBase)).toEqual([b, a]);
    });
});
