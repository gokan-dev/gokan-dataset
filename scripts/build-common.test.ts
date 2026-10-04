import { describe, it, expect } from 'vitest';
import { buildKanaKeyOwners, resolveJlptLevel, type JpdbFrequencies, type KanaKeyOwners } from './build-common';

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
