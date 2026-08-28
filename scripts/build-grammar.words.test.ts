import { describe, it, expect, beforeAll } from 'vitest';
import kuromoji from 'kuromoji';
import { SentenceTokenizer } from '../src/utils/tokenizer';
import { buildExampleWords, buildVocabLookup } from './build-grammar';
import type { SearchIndex } from '../src/models/index.model';

/**
 * Integration tests for the sentence-matching upgrade (issue: "upgrade the
 * grammar sentence match to the standard sentence match"). Uses a real
 * kuromoji tokenizer (same as kuromoji.test.ts/grammar-pattern-matcher.test.ts)
 * against a small synthetic vocab lookup, rather than the full compiled
 * search index, so these stay fast and self-contained.
 */
describe('buildExampleWords (sentence-matching upgrade)', () => {
    let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures>;
    let sentenceTokenizer: SentenceTokenizer;

    const searchIndex: SearchIndex = [
        { id: 'v-hayai', w: '早い', r: 'はやい', m: 'early, fast' },
        { id: 'v-kayou', w: '通う', r: 'かよう', m: 'to commute' },
        { id: 'v-warau', w: '笑う', r: 'わらう', m: 'to laugh' },
        // A particle-like JMDict entry, to exercise the content-POS rejection guard.
        { id: 'v-wa', w: 'は', r: 'は', m: 'topic marker' },
    ];

    beforeAll(async () => {
        tokenizer = await new Promise((resolve, reject) => {
            kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => {
                if (err) reject(err);
                else resolve(t);
            });
        });
        sentenceTokenizer = new SentenceTokenizer(tokenizer);
    });

    function build(jp: string, formation: string) {
        const lookup = buildVocabLookup(searchIndex);
        const vocabSet = new Set(lookup.byWrittenForm.keys());
        return buildExampleWords(tokenizer, sentenceTokenizer, vocabSet, lookup, jp, formation);
    }

    it('reconstructs the original sentence exactly by concatenating every word surface', () => {
        const { words } = build('朝早かろうが夜遅かろうが、いつもバスが遅れる。', '');
        expect(words.map(w => w.surface).join('')).toBe('朝早かろうが夜遅かろうが、いつもバスが遅れる。');
    });

    it('resolves a conjugated form to its dictionary-form vocabId, merged into one word (not split into fragments)', () => {
        const { words } = build('彼は仕事をするかたわら、大学に通っている。', '');
        const match = words.find(w => w.vocabId === 'v-kayou');
        expect(match).toBeDefined();
        expect(match!.surface).toBe('通っている');
        expect(match!.baseForm).toBe('通う');
        expect(match!.reading).toBe('かよっている');
    });

    it('still locates a pattern marker whose literal characters get absorbed into a merged conjugated word (the regression this upgrade could have caused)', () => {
        // わらう's conjugation-extension absorbs "ずにはいられない" onto the same
        // merged word as its own "笑わ" stem, which would hide the formation
        // literal from a naive pattern search run only against the merged
        // output - patternWordIndices must still find it via the separate
        // fine-grained pass (mirrors a real hanabira formation, e.g. n2-065's
        // "Verb-ない form (drop ない) + ずにはいられない").
        const { patternWordIndices, words } = build('彼の話がおかしくて笑わずにはいられない。', 'Verb-ない form + ずにはいられない');
        expect(patternWordIndices.length).toBeGreaterThan(0);
        // Every reported index must be valid against the MERGED output, not the
        // fine-grained one it was originally found against.
        for (const i of patternWordIndices) expect(words[i]).toBeDefined();
    });

    it('does not resolve a matched particle-only span to a vocabId (content-POS guard)', () => {
        const { words } = build('今日は晴れです。', '');
        const haWord = words.find(w => w.surface === 'は');
        expect(haWord).toBeDefined();
        expect(haWord!.vocabId).toBeNull();
    });
});

describe('vocab linking precision (the あり -> 蟻 bug)', () => {
    let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures>;

    beforeAll(async () => {
        tokenizer = await new Promise((resolve, reject) => {
            kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => {
                if (err) reject(err); else resolve(t);
            });
        });
    }, 30000);

    /**
     * A homophone-rich index, mirroring the real one's shape: 蟻 and 有る both
     * read あり / ある, so a reading-only match would pick whichever comes first.
     * The real index is frequency-ordered, which is why 蟻 ("ant") won and got
     * linked to the あり in あります.
     */
    const searchIndex: SearchIndex = [
        { id: 'v-ari-ant', w: '蟻', r: 'あり', m: 'ant' },
        { id: 'v-aru', w: '有る', r: 'ある', m: 'to be, to exist' },
        { id: 'v-aru2', w: '或', r: 'ある', m: 'a certain, some' },
        { id: 'v-naku-cry', w: '泣く', r: 'なく', m: 'to cry' },
        { id: 'v-shi-death', w: '死', r: 'し', m: 'death' },
        { id: 'v-suru-rub', w: '擦る', r: 'する', m: 'to rub' },
        { id: 'v-eki', w: '駅', r: 'えき', m: 'station' },
        // An uninflected kana word stored under a kanji written form - the case
        // the reading fallback legitimately exists for.
        { id: 'v-itsumo', w: '何時も', r: 'いつも', m: 'always' },
    ];

    function link(sentence: string) {
        const lookup = buildVocabLookup(searchIndex);
        const vocabSet = new Set(lookup.byWrittenForm.keys());
        const sentenceTokenizer = new SentenceTokenizer(tokenizer);
        const { words } = buildExampleWords(tokenizer, sentenceTokenizer, vocabSet, lookup, sentence, '');
        return words;
    }

    it('never links あります to 蟻', () => {
        // The reported bug: 駅の近くにコンビニがあります。
        const words = link('駅の近くにコンビニがあります。');
        const ari = words.find(w => w.surface === 'あり');
        expect(ari).toBeDefined();
        expect(ari!.vocabId).not.toBe('v-ari-ant');
    });

    it('refuses an ambiguous reading rather than guessing a homophone', () => {
        // ある is claimed by both 有る and 或, so no link is the only honest answer.
        const lookup = buildVocabLookup(searchIndex);
        expect(lookup.ambiguousReadings.has('ある')).toBe(true);
        const words = link('駅の近くにコンビニがあります。');
        expect(words.find(w => w.surface === 'あり')!.vocabId).toBeNull();
    });

    it('never looks up a conjugated surface as if it were a dictionary word', () => {
        // なく is ない's stem, not 泣く; し is する's stem, not 死.
        for (const [sentence, surface, wrongId] of [
            ['お金がなくても行きます。', 'なく', 'v-naku-cry'],
            ['勉強しました。', 'し', 'v-shi-death'],
        ] as const) {
            const hit = link(sentence).find(w => w.surface === surface);
            if (hit) expect(hit.vocabId).not.toBe(wrongId);
        }
    });

    it('still links an uninflected kana word with an unambiguous reading', () => {
        // The fallback must not be gutted: いつも is genuinely 何時も.
        const words = link('いつも駅に行きます。');
        const itsumo = words.find(w => w.surface === 'いつも');
        expect(itsumo?.vocabId).toBe('v-itsumo');
    });

    it('still links words by their written form', () => {
        expect(link('駅の近くにコンビニがあります。').find(w => w.surface === '駅')?.vocabId).toBe('v-eki');
    });
});
