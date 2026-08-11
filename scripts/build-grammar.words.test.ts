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
