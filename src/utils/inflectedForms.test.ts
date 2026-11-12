import { beforeAll, describe, expect, it } from 'vitest';
import kuromoji from 'kuromoji';
import { createFormFinder } from './inflectedForms';
import type { FormToken } from './inflectedForms';

/** A real tokenizer, as the conjugator's own tests use: the finder reads kuromoji's conjugation types. */
describe('createFormFinder', () => {
    let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures>;

    beforeAll(async () => {
        tokenizer = await new Promise((resolve, reject) => {
            kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => {
                if (err) reject(err); else resolve(t);
            });
        });
    }, 30000);

    function found(text: string): string[] {
        let offset = 0;
        const tokens: FormToken[] = tokenizer.tokenize(text).map(t => {
            const start = offset;
            offset += t.surface_form.length;
            return { surface: t.surface_form, pos: t.pos, posDetail1: t.pos_detail_1, base: t.basic_form, conjType: t.conjugated_type, start, end: offset };
        });
        return createFormFinder()(tokens, text).map(f => `${f.form}:${f.lemma}:${text.slice(f.start, f.end)}`);
    }

    it('finds a form where the sentence writes it', () => {
        expect(found('昨日、本を読みました。')).toEqual(['masu-past:読む:読みました']);
        expect(found('この部屋は広くて明るい。')).toEqual(['i-adj-te:広い:広くて']);
        expect(found('彼は速く走る。')).toEqual(['i-adj-adverbial:速い:速く']);
    });

    it('never reads a short form inside a longer one', () => {
        // 食べた inside 食べたい, 高く inside 高くない and 高くて.
        expect(found('ケーキを食べたい。')).toEqual(['tai:食べる:食べたい']);
        expect(found('この山は高くない。')).toEqual(['i-adj-negative:高い:高くない']);
        expect(found('肉を食べませんでした。')).toEqual(['masu-past-negative:食べる:食べませんでした']);
    });

    it('drops a form the sentence conjugates further', () => {
        // 食べたら is not the plain past, and no form the conjugator names.
        expect(found('ご飯を食べたら、出かけます。')).toEqual(['masu:出かける:出かけます']);
    });

    it('finds a な-adjective with its copula', () => {
        expect(found('この町は静かでした。')).toEqual(['na-adj-past-polite:静か:静かでした']);
        expect(found('この町は静かではない。')).toEqual(['na-adj-negative:静か:静かではない']);
    });

    it('finds nothing in a sentence of dictionary forms', () => {
        expect(found('毎日、本を読む。')).toEqual([]);
    });
});
