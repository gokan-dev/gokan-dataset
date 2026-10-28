import { describe, it, expect } from 'vitest';
import { coarsePosSet, sharesPos, normalizeGloss, sharedGlosses, glossOverlap, overlaps, senseCovered, kanjiStem, isTransitivityPair, sharedGlossList, overlapScore, autoTier, synonymForms, applyOverrides, isRanked, isRareSense, readSenses, sharedMeanings } from './build-synonyms';
import type { SynonymEntry } from './build-synonyms';
import fs from 'fs';

const S = (...xs: string[]) => new Set(xs);

describe('coarsePosSet', () => {
    it('maps JMdict POS codes to major classes', () => {
        expect([...coarsePosSet(['v5u', 'vt'])]).toEqual(['verb']);
        expect([...coarsePosSet(['adj-i'])]).toEqual(['i-adj']);
        expect([...coarsePosSet(['adj-na'])]).toEqual(['na-adj']);
        expect([...coarsePosSet(['adv-to'])]).toEqual(['adv']);
        expect([...coarsePosSet(['n-adv'])]).toEqual(['noun']);
    });

    it('keeps EVERY class a word carries, not just the first recognised one', () => {
        // The 一番 / 最高 defect: both are noun+adjectival, but JMdict lists their
        // codes in a different order, so returning the first match made one a
        // noun and the other a na-adj and they never reached the gloss check.
        expect(coarsePosSet(['n', 'adj-no', 'adv'])).toEqual(S('noun', 'adv'));
        expect(coarsePosSet(['adj-no', 'adj-na', 'n'])).toEqual(S('na-adj', 'noun'));
        expect(sharesPos(coarsePosSet(['n', 'adj-no', 'adv']), coarsePosSet(['adj-no', 'adj-na', 'n']))).toBe(true);
    });

    it('is empty for classes not drilled as production (particles, interjections)', () => {
        expect(coarsePosSet(['int']).size).toBe(0);
        expect(coarsePosSet(['prt']).size).toBe(0);
        expect(coarsePosSet([]).size).toBe(0);
    });

    it('sharesPos needs an actual intersection', () => {
        expect(sharesPos(S('noun'), S('verb'))).toBe(false);
        expect(sharesPos(S(), S('noun'))).toBe(false);
    });
});

describe('normalizeGloss', () => {
    it('strips a leading to/a/an/the, parentheticals, punctuation and case', () => {
        expect(normalizeGloss('to think')).toBe('think');
        expect(normalizeGloss('To Consider.')).toBe('consider');
        expect(normalizeGloss('the state')).toBe('state');
        expect(normalizeGloss('an appearance')).toBe('appearance');
        expect(normalizeGloss('State (of affairs)')).toBe('state');
        expect(normalizeGloss('look(s)')).toBe('look');
        expect(normalizeGloss('  power,  ')).toBe('power');
    });

    it('lets genuinely different senses stay different', () => {
        expect(normalizeGloss('always')).not.toBe(normalizeGloss('certainly'));
    });
});

describe('sharedGlosses', () => {
    it('counts the intersection', () => {
        expect(sharedGlosses(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBe(2);
        expect(sharedGlosses(new Set(['a']), new Set(['b']))).toBe(0);
    });
});

describe('glossOverlap (flat floor: >=1 shared sense at >=30% of the smaller set)', () => {
    it('clusters near-synonyms that share two or more senses', () => {
        // 思う vs 考える shape: heavy overlap.
        expect(glossOverlap(new Set(['think', 'consider', 'believe', 'reckon']), new Set(['think', 'consider']))).toBe(true);
        // the 状態/状況 nouns: share situation + circumstances.
        expect(glossOverlap(new Set(['state', 'condition', 'situation', 'circumstances']), new Set(['situation', 'circumstances', 'conditions']))).toBe(true);
    });

    it('clusters a 2-shared pair at the floor (縛る/締める: tie+fasten, 2/6 = 0.33)', () => {
        expect(glossOverlap(
            new Set(['tie', 'bind', 'fasten', 'restrict', 'tie down', 'fetter']),
            new Set(['tie', 'fasten', 'tighten', 'wear', 'put on', 'total', 'sum']),
        )).toBe(true);
    });

    it('clusters a single shared sense at the floor - English homographs are accepted by design', () => {
        // 作文/作曲 share only "composition" (essay vs music), 1/3 = 0.33 >= 0.30.
        // The product decision is to accept a gloss-matching answer rather than mark
        // it wrong, even when the shared gloss is an English coincidence.
        expect(glossOverlap(new Set(['writing', 'composition', 'composing']), new Set(['setting', 'composition', 'writing music']))).toBe(true);
        // 強い/丈夫 reading shape: 1 of 2 = 0.5. 必ず/常に: "always", 1 of 2 = 0.5.
        expect(glossOverlap(new Set(['strong', 'potent']), new Set(['healthy', 'robust', 'strong', 'solid', 'durable']))).toBe(true);
        expect(glossOverlap(new Set(['certainly', 'surely', 'always']), new Set(['always', 'constantly']))).toBe(true);
    });

    it('still rejects a shared sense below the floor (1 of 4 = 0.25 < 0.30)', () => {
        expect(glossOverlap(new Set(['a', 'b', 'c', 'd']), new Set(['a', 'x', 'y', 'z', 'w']))).toBe(false);
    });

    it('rejects two big words that share only two of many senses (2/8 = 0.25 < 0.30)', () => {
        const a = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
        const b = new Set(['a', 'b', 'x', 'y', 'z', 'w', 'v', 'u']);
        expect(sharedGlosses(a, b)).toBe(2);
        expect(glossOverlap(a, b)).toBe(false);
    });

    it('rejects disjoint sense sets', () => {
        expect(glossOverlap(new Set(['always', 'constantly']), new Set(['certainly', 'surely']))).toBe(false);
    });

    it('rejects one shared gloss between a small word and a polysemous one (もう一人 / 今: 1/3, but 1/√33 = 0.17)', () => {
        // もう一人 {another, the other person, one more} and 今's 11 glosses share only
        // "another", from 今's "another; more" (今一度): the ratio over the smaller word
        // passes, but one gloss of a word that polysemous says little.
        expect(overlaps(1, 3, 11)).toBe(false);
        // Two focused words sharing one gloss still pass: 作文 / 作曲 (1/√9), 強い / 丈夫 (1/√10).
        expect(overlaps(1, 3, 3)).toBe(true);
        expect(overlaps(1, 2, 5)).toBe(true);
    });

    it('keeps the ratio over the smaller word for two or more shared glosses, however big the other (出る / 出かける)', () => {
        // 出かける's sense {go out, leave, depart, start, set out} is all in 出る's 74 glosses.
        expect(overlaps(5, 7, 74)).toBe(true);
        expect(overlaps(2, 3, 40)).toBe(true);
    });
});

describe('sharedMeanings (a shared gloss counts only when both words use it the same way)', () => {
    const word = (...senses: { glosses: string[]; pos: string[]; misc?: { rawTags?: string[]; isArchaic?: boolean; isRare?: boolean } }[]) => readSenses(senses);

    it('does not match an English verb gloss with a noun one (述べる "to state" / 国家 "state")', () => {
        const noberu = word({ glosses: ['to state', 'to express', 'to mention'], pos: ['v1', 'vt'] });
        const kokka = word({ glosses: ['state', 'country', 'nation'], pos: ['n'] });
        expect(sharedMeanings(noberu, kokka)).toEqual([]);
    });

    it("matches a suru noun's bare gloss with a verb, which it stands for (利用 \"use\" / 使う \"to use\")", () => {
        const riyou = word({ glosses: ['use', 'utilization', 'utilisation'], pos: ['n', 'vs', 'vt'] });
        const tsukau = word({ glosses: ['to use (a thing, method, etc.)', 'to make use of'], pos: ['v5u', 'vt'] });
        expect(sharedMeanings(riyou, tsukau)).toEqual(['use']);
    });

    it('matches an expression with either (気を付けて "be careful!" / 気をつける "to be careful")', () => {
        const kiwotsukete = word({ glosses: ['be careful!', 'take care!'], pos: ['exp'] });
        const kiwotsukeru = word({ glosses: ['to be careful', 'to pay attention', 'to take care'], pos: ['exp', 'v1'] });
        expect(sharedMeanings(kiwotsukete, kiwotsukeru)).toEqual(['be careful', 'take care']);
    });

    it('does not match a prefix or suffix sense with a word (来 "next ..." / ここ "the next ... days"), only with another', () => {
        const rai = word({ glosses: ['next (year, spring, etc.)', 'coming'], pos: ['pref'] });
        const koko = word({ glosses: ['here', 'this place'], pos: ['pn'] }, { glosses: ['the next ... (e.g. few days)', 'the past ...'], pos: ['pn'] });
        const ji = word({ glosses: ['next'], pos: ['pref'] });
        expect(sharedMeanings(rai, koko)).toEqual([]);
        expect(sharedMeanings(rai, ji)).toEqual(['next']);
    });

    it('matches a bound-form sense with a word when they share at least 3 glosses that way (以外 / 他), not 2', () => {
        const igai = word({ glosses: ['excluding', 'except (for)', 'apart from', 'other than', 'besides'], pos: ['n-suf'] });
        const hoka = word({ glosses: ['another', 'other'], pos: ['n', 'adj-no'] }, { glosses: ['except', 'but', 'other than', 'apart from'], pos: ['n'] });
        expect(sharedMeanings(igai, hoka)).toEqual(['apart from', 'except', 'other than']);
        const two = word({ glosses: ['other than', 'apart from', 'aside'], pos: ['n'] });
        const one = word({ glosses: ['other than', 'aside', 'beside'], pos: ['n'] });
        expect(sharedMeanings(igai, two)).toEqual([]);
        expect(sharedMeanings(igai, one)).toEqual([]);
        // The other rules still apply to the glosses counted: a verb gloss never matches a noun one.
        const verbs = word({ glosses: ['to except', 'to exclude', 'apart from', 'other than'], pos: ['v5r', 'vt'] });
        expect(sharedMeanings(igai, verbs)).toEqual([]);
    });

    it('matches an interjection only with an interjection or an expression, a conjunction with a conjunction, an adverb or an expression', () => {
        const stopInt = word({ glosses: ['stop!', 'cut it out!'], pos: ['int'] });
        const teisha = word({ glosses: ['stop (of a vehicle)', 'stopping'], pos: ['n', 'vs', 'vi'] });
        const yamete = word({ glosses: ['stop it!'], pos: ['exp'] }, { glosses: ['stop!'], pos: ['int'] });
        expect(sharedMeanings(stopInt, teisha)).toEqual([]);
        expect(sharedMeanings(stopInt, yamete)).toEqual(['stop']);
        const nowConj = word({ glosses: ['now', 'well'], pos: ['conj'] });
        expect(sharedMeanings(nowConj, word({ glosses: ['now'], pos: ['pn'] }))).toEqual([]);
        expect(sharedMeanings(nowConj, word({ glosses: ['now', 'at present'], pos: ['adv', 'n'] }))).toEqual(['now']);
    });

    it('leaves out a rare, archaic or dated sense, which a word page hides, unless the word has no other', () => {
        const uchi = word({ glosses: ['inside', 'within'], pos: ['n'] }, { glosses: ['emperor'], pos: ['n'], misc: { isArchaic: true } });
        const koutei = word({ glosses: ['emperor'], pos: ['n'] });
        expect(sharedMeanings(uchi, koutei)).toEqual([]);
        // 婦人's one sense is dated: dropping it would leave the word with no synonyms at all.
        const fujin = word({ glosses: ['woman', 'lady', 'adult female'], pos: ['n'], misc: { rawTags: ['sens', 'dated'] } });
        const josei = word({ glosses: ['woman', 'female'], pos: ['n', 'adj-no'] });
        expect(sharedMeanings(fujin, josei)).toEqual(['woman']);
    });

    it('counts every gloss for the tier, rare senses included, so dropping one never promotes a pair', () => {
        // お目にかかる's other sense is rare: its one common gloss over 1 would make any pair "=".
        const omenikakaru = word({ glosses: ['to meet (someone of higher status)'], pos: ['exp', 'v5r'] }, { glosses: ['to see', 'to look at'], pos: ['exp', 'v5r'], misc: { isRare: true } });
        expect(omenikakaru.glosses).toEqual(S('meet'));
        expect(omenikakaru.size).toBe(3);
    });

    it('isRareSense reads the same tags as the page (arch, obs, rare, dated)', () => {
        expect(isRareSense({ misc: { rawTags: ['dated'] } })).toBe(true);
        expect(isRareSense({ misc: { rawTags: ['obs'] } })).toBe(true);
        expect(isRareSense({ misc: { isRare: true, rawTags: [] } })).toBe(true);
        expect(isRareSense({ misc: { rawTags: ['col', 'uk'] } })).toBe(false);
        expect(isRareSense({})).toBe(false);
    });
});

describe('kanjiStem', () => {
    it('takes the leading run of kanji, stopping at okurigana', () => {
        expect(kanjiStem('並ぶ')).toBe('並');
        expect(kanjiStem('並べる')).toBe('並');
        expect(kanjiStem('見つかる')).toBe('見');
        expect(kanjiStem('取り引き')).toBe('取');
        expect(kanjiStem('大丈夫')).toBe('大丈夫');
    });

    it('is empty for a kana-only or empty form', () => {
        expect(kanjiStem('かばん')).toBe('');
        expect(kanjiStem('')).toBe('');
    });
});

describe('isTransitivityPair', () => {
    const word = (o: { stem?: string; vi?: boolean; vt?: boolean; glosses?: string[] }) => ({
        id: 'x', pos: S(), senses: [] as Set<string>[],
        stem: o.stem ?? '', vi: o.vi ?? false, vt: o.vt ?? false,
        glosses: S(...(o.glosses ?? [])),
    });

    it('pairs 並ぶ (vi) with 並べる (vt): same stem, opposite transitivity, shared gloss', () => {
        const nabu = word({ stem: '並', vi: true, glosses: ['line up', 'stand in a line'] });
        const naberu = word({ stem: '並', vt: true, glosses: ['line up', 'arrange in a line'] });
        expect(isTransitivityPair(nabu, naberu)).toBe(true);
        expect(isTransitivityPair(naberu, nabu)).toBe(true);
    });

    it('does not pair two words of the SAME transitivity', () => {
        const a = word({ stem: '見', vt: true, glosses: ['see'] });
        const b = word({ stem: '見', vt: true, glosses: ['see', 'show'] });
        expect(isTransitivityPair(a, b)).toBe(false);
    });

    it('does not pair a different kanji stem', () => {
        const a = word({ stem: '並', vi: true, glosses: ['line up'] });
        const b = word({ stem: '揃', vt: true, glosses: ['line up'] });
        expect(isTransitivityPair(a, b)).toBe(false);
    });

    it('needs at least one shared gloss (見る/見つかる: same stem, opposite transitivity, no overlap)', () => {
        const miru = word({ stem: '見', vt: true, glosses: ['see', 'look at'] });
        const mitsukaru = word({ stem: '見', vi: true, glosses: ['be found', 'be discovered'] });
        expect(isTransitivityPair(miru, mitsukaru)).toBe(false);
    });

    it('does not pair kana-only words (empty stem)', () => {
        const a = word({ stem: '', vi: true, glosses: ['line up'] });
        const b = word({ stem: '', vt: true, glosses: ['line up'] });
        expect(isTransitivityPair(a, b)).toBe(false);
    });
});

describe('senseCovered (a whole sense expressible by the other word)', () => {
    // The real shape: 一番 has six senses and 18 glosses, one of which is
    // exactly {best, most}; 最高 carries both across its own two senses. The
    // flattened ratio scores 2/min(18,8) = 0.25 and rejects them.
    const ichiban = [S('number one', 'first', 'first place'), S('best', 'most'), S('game', 'round', 'bout')];
    const saikou = S('best', 'supreme', 'wonderful', 'finest', 'highest', 'maximum', 'most', 'uppermost');

    // The shared glosses, as the pair scan passes them.
    const shared = (other: Set<string>) => new Set(ichiban.flatMap(s => [...s]).filter(g => other.has(g)));

    it('catches a sense wholly contained in the other word', () => {
        expect(senseCovered(ichiban, saikou.size, shared(saikou))).toBe(true);
        expect(glossOverlap(new Set(ichiban.flatMap(s => [...s])), saikou)).toBe(false); // what it rescues
    });

    it('needs the WHOLE sense, not most of it', () => {
        expect(senseCovered([S('best', 'cheapest')], saikou.size, S('best'))).toBe(false);
    });

    it('ignores single-gloss senses, which match by coincidence', () => {
        expect(senseCovered([S('best')], saikou.size, S('best'))).toBe(false);
    });

    it('refuses a covering word polysemous enough to cover anything', () => {
        // 取る carries 54 glosses and would otherwise absorb most of the verb index.
        const huge = new Set(Array.from({ length: 20 }, (_, i) => `g${i}`).concat(['best', 'most']));
        expect(senseCovered(ichiban, huge.size, shared(huge))).toBe(false);
    });
});

describe('context-aware synonym entries', () => {
    const word = (senses: string[][], extra: Partial<{ stem: string; vi: boolean; vt: boolean }> = {}) => {
        const sets = senses.map(s => new Set(s));
        const glosses = new Set(sets.flatMap(s => [...s]));
        return { senses: sets, glosses, size: glosses.size, stem: '', vi: false, vt: false, ...extra };
    };
    // 狭い / 小さい and 人物 / 男: the two reported cases, one shared gloss each.
    const semai = word([['narrow', 'confined', 'small', 'cramped'], ['limited', 'narrow-minded', 'confining']]);
    const chiisai = word([['small', 'little', 'tiny'], ['slight', 'below average', 'minor', 'small'], ['low', 'soft'], ['unimportant', 'petty', 'insignificant', 'trifling', 'trivial'], ['young', 'juvenile']]);

    it('records the shared glosses, sorted', () => {
        expect(sharedGlossList(semai.glosses, chiisai.glosses)).toEqual(['small']);
        expect(sharedGlossList(S('b', 'a', 'c'), S('c', 'a'))).toEqual(['a', 'c']);
    });

    it('scores overlap against the smaller gloss set, rounded', () => {
        expect(overlapScore(semai.glosses, chiisai.glosses)).toBe(0.14);
        expect(overlapScore(S('essay', 'composition', 'writing'), S('composition', 'music'))).toBe(0.5);
        expect(overlapScore(S(), S('a'))).toBe(0);
    });

    it('gives a single-shared-gloss pair between polysemous words the no-credit tier', () => {
        expect(autoTier(semai, chiisai)).toBe('confusable');
    });

    it('keeps the original rules as the minor-error tier', () => {
        // ratio floor
        expect(autoTier(word([['essay', 'composition', 'writing']]), word([['composition', 'music', 'song']]))).toBe('interchangeable');
        // transitivity pair below the floor
        expect(autoTier(
            word([['line up', 'stand in a line', 'be in a row', 'queue', 'wait']], { stem: '並', vi: true }),
            word([['line up', 'arrange', 'set out', 'display', 'enumerate']], { stem: '並', vt: true }),
        )).toBe('interchangeable');
    });
});
describe('synonymForms (answerable forms embedded on each entry)', () => {
    it('lists written forms then readings, primary first, with the readings of merged homographs', () => {
        expect(synonymForms({
            writtenForm: { kanji: '玄関', alternatives: ['玄關'] },
            reading: { primary: 'げんかん', alternatives: [] },
            mergedVocabs: [{ originalPrimaryReading: 'げんかんぐち' }],
            senses: [{ pos: ['n'] }],
        })).toEqual({ w: ['玄関', '玄關'], r: ['げんかん', 'げんかんぐち'] });
    });

    it('keeps only the POS codes that decide inflection, deduped and sorted', () => {
        expect(synonymForms({
            writtenForm: { kanji: '並べる', alternatives: [] },
            reading: { primary: 'ならべる', alternatives: [] },
            senses: [{ pos: ['v1', 'vt'] }, { pos: ['v1', 'vt', 'n'] }],
        }).pos).toEqual(['v1']);
        expect(synonymForms({ writtenForm: { kanji: '登場' }, reading: { primary: 'とうじょう' }, senses: [{ pos: ['n', 'vs', 'vi'] }] }).pos).toEqual(['vs']);
    });

    it('omits pos for a word that does not inflect, and drops empty or repeated forms', () => {
        const forms = synonymForms({ writtenForm: { kanji: '', alternatives: ['あら'] }, reading: { primary: 'あら', alternatives: ['あら'] }, senses: [{ pos: ['n'] }] });
        expect(forms).toEqual({ w: ['あら'], r: ['あら'] });
        expect('pos' in forms).toBe(false);
    });

    it('marks a word learned in kana, and only such a word', () => {
        const here = { writtenForm: { kanji: '此処' }, reading: { primary: 'ここ' }, senses: [{ pos: ['pn'] }] };
        expect(synonymForms({ ...here, usuallyKana: true }).u).toBe(true);
        expect('u' in synonymForms(here)).toBe(false);
    });
});

describe('isRanked (whether an entry carries its frequency rank `f`)', () => {
    it('is true for a word JPDB ranks by either spelling', () => {
        expect(isRanked({ frequency: { kanjiRank: 120 } })).toBe(true);
        expect(isRanked({ frequency: { kanjiRank: 999999, kanaRank: 4000 } })).toBe(true);
    });

    it("is false for build-data's placeholder, or no frequency at all", () => {
        expect(isRanked({ frequency: { kanjiRank: 999999, kanaRank: 999999 } })).toBe(false);
        expect(isRanked({})).toBe(false);
    });
});

describe('applyOverrides (data/raw/vocab/synonyms.json)', () => {
    const byId = new Map([['a', { glosses: S('stop', 'fill') }], ['b', { glosses: S('stop', 'cease') }], ['c', { glosses: S('cease') }]]);
    const auto = (): Map<string, Omit<SynonymEntry, 'id'>> => new Map([
        ['a b', { relation: 'interchangeable', shared: ['stop'], overlap: 0.5 }],
        ['b c', { relation: 'confusable', shared: ['cease'], overlap: 1 }],
    ]);

    it('demotes a clustered pair and marks it curated, with its shared glosses', () => {
        const relations = auto();
        expect(applyOverrides(relations, { clusters: [{ ids: ['b', 'a'], relation: 'confusable' }] }, byId)).toEqual({ excluded: 0, promoted: 1, handAdded: 0 });
        expect(relations.get('a b')).toEqual({ relation: 'confusable', shared: ['stop'], overlap: 0.5, curated: true });
    });

    it('drops an excluded pair', () => {
        const relations = auto();
        applyOverrides(relations, { exclude: [['c', 'b']] }, byId);
        expect(relations.has('b c')).toBe(false);
    });

    it('fails on a cluster id the scan skipped', () => {
        expect(() => applyOverrides(auto(), { clusters: [{ ids: ['a', 'zzz'], relation: 'confusable' }] }, byId)).toThrow(/zzz, which the scan skipped/);
    });

    it('fails on a pair both excluded and clustered, instead of re-adding it', () => {
        expect(() => applyOverrides(auto(), { exclude: [['a', 'b']], clusters: [{ ids: ['a', 'b', 'c'], relation: 'confusable' }] }, byId))
            .toThrow(/a b is both excluded and clustered/);
    });

    it('fails on one pair in two clusters with different tiers, instead of keeping the last', () => {
        expect(() => applyOverrides(auto(), {
            clusters: [{ ids: ['a', 'b'], relation: 'confusable' }, { ids: ['b', 'a', 'c'], relation: 'interchangeable' }],
        }, byId)).toThrow(/a b is clustered as both confusable and interchangeable/);
    });

    it('accepts one pair in two clusters with the same tier', () => {
        expect(() => applyOverrides(auto(), {
            clusters: [{ ids: ['a', 'b'], relation: 'confusable' }, { ids: ['a', 'b', 'c'], relation: 'confusable' }],
        }, byId)).not.toThrow();
    });
});

/**
 * Every synonym case reported against grading, on the compiled files: a build change
 * (a threshold, the normaliser, an exclusion) that drops one fails here, before the
 * pointer moves in gokan-srs, whose own suite grades the same cases end to end
 * (src/services/exercise/reportedSynonyms.test.ts).
 */
describe('reported synonym pairs, as built', () => {
    const REPORTED: { asked: string; typed: string; relation: 'interchangeable' | 'confusable'; curated?: true; shared: string[] }[] = [
        { asked: '1487400', typed: '1355970', relation: 'confusable', curated: true, shared: ['always'] }, // 必ず / 常に
        { asked: '1396130', typed: '1595730', relation: 'interchangeable', curated: true, shared: ['all', 'whole'] }, // 全部 / 全て
        { asked: '1407980', typed: '1236650', relation: 'interchangeable', curated: true, shared: ['likely', 'probably'] }, // 多分 / 恐らく
        { asked: '1165970', typed: '1293850', relation: 'interchangeable', shared: ['best', 'most'] }, // 一番 / 最高
        { asked: '1476050', typed: '1436570', relation: 'interchangeable', shared: ['fasten', 'tie'] }, // 縛る / 締める
        { asked: '1508390', typed: '1508380', relation: 'interchangeable', shared: ['line up'] }, // 並べる / 並ぶ
        { asked: '1236070', typed: '1580480', relation: 'interchangeable', shared: ['strong'] }, // 強い / 丈夫
        { asked: '1297650', typed: '1297960', relation: 'interchangeable', shared: ['composition'] }, // 作曲 / 作文
        { asked: '1221870', typed: '1591990', relation: 'interchangeable', shared: ['be careful', 'take care'] }, // 気を付けて / 気をつける
        { asked: '1237680', typed: '1347750', relation: 'confusable', shared: ['small'] }, // 狭い / 小さい
        { asked: '1369070', typed: '1419990', relation: 'confusable', shared: ['man'] }, // 人物 / 男
        { asked: '1524500', typed: '1310640', relation: 'confusable', curated: true, shared: ['stop'] }, // 埋める / 止む
        // Reported as "=" on 今's Synonyms card: one gloss of an 11-gloss word.
        { asked: '1288850', typed: '2267340', relation: 'confusable', shared: ['another'] }, // 今 / もう一人
        // What the tightening must not cost: frequent pairs sharing several glosses, a word whose only sense is dated,
        { asked: '1524930', typed: '1292300', relation: 'interchangeable', shared: ['again', 'once more'] }, // また / 再び
        { asked: '1338240', typed: '1598550', relation: 'interchangeable', shared: ['depart', 'go out', 'leave', 'set out', 'start'] }, // 出る / 出かける
        { asked: '1496670', typed: '1345250', relation: 'interchangeable', shared: ['woman'] }, // 婦人 / 女性
        // and a pair dropping お目にかかる's rare sense would promote to "=".
        { asked: '1413180', typed: '1535140', relation: 'confusable', shared: ['meet'] }, // 大会 / お目にかかる
        // A bound-form sense sharing 3 or more glosses with a word still pairs.
        { asked: '1155090', typed: '1203260', relation: 'interchangeable', shared: ['apart from', 'besides', 'except', 'in addition to', 'other than', 'outside'] }, // 以外 / 他
    ];
    /** Pairs that share an English gloss used two different ways: never listed. */
    const UNRELATED: [string, string][] = [
        ['1288810', '1547710'], // ここ "the next ... days" / 来 "next ..." (a prefix)
        ['1343950', '1487770'], // 書く "to pen" / 筆 "pen"
        ['1340820', '1286170'], // 述べる "to state" / 国家 "state"
    ];
    const entry = (from: string, to: string): Partial<SynonymEntry> | undefined => {
        const v = JSON.parse(fs.readFileSync(`./compiled/vocab/${from}.json`, 'utf-8')) as { synonyms?: SynonymEntry[] };
        return v.synonyms?.find(s => s.id === to);
    };

    it.each(REPORTED)('$asked / $typed', ({ asked, typed, relation, curated, shared }) => {
        for (const [from, to] of [[asked, typed], [typed, asked]]) {
            const e = entry(from, to);
            expect(e, `${from} lists ${to}`).toBeDefined();
            expect(e?.relation).toBe(relation);
            expect(e?.curated).toBe(curated);
            expect(e?.shared).toEqual(expect.arrayContaining(shared));
        }
    });

    it.each(UNRELATED)('%s / %s are not listed', (a, b) => {
        expect(entry(a, b)).toBeUndefined();
        expect(entry(b, a)).toBeUndefined();
    });

    it("carries the other word's frequency rank, its position in index/frequency.json", () => {
        const frequency = JSON.parse(fs.readFileSync('./compiled/index/frequency.json', 'utf-8')) as { id: string }[];
        const rank = frequency.findIndex(e => e.id === '1355970') + 1;
        expect(rank).toBeGreaterThan(0);
        expect((entry('1487400', '1355970') as { f?: number } | undefined)?.f).toBe(rank);
    });
});
