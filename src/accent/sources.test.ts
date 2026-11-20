import { describe, expect, it } from 'vitest';
import { formatSnapshot, parseSnapshot } from './snapshot';
import { lexCells, unidicRow } from './unidic';
import { accentRowsOf, parseJaPron } from './wiktionary';

describe('Wiktionary', () => {
    it('reads the reading and every accent of a ja-pron', () => {
        expect(parseJaPron('考える', 'ja-pron|かんがえる|acc=4|acc_ref=DJR|acc2=3')).toEqual({ form: '考える', reading: 'かんがえる', accents: ['4', '3'] });
        expect(parseJaPron('東京', 'ja-pron|とう きょう|acc=0|audio=Ja-Tokyo.ogg')).toEqual({ form: '東京', reading: 'とうきょう', accents: ['0'] });
    });

    it('skips a ja-pron without an accent', () => {
        expect(parseJaPron('先生', 'ja-pron|しぇんしぇい')).toBeNull();
    });

    it('reads only the Japanese section, every ja-pron in it', () => {
        const page = [
            '==Chinese==', '{{ja-pron|ちがう|acc=1}}',
            '==Japanese==', '===Etymology 1===', '{{ja-pron|はし|acc=1|acc_ref={{cite|NHK}}}}',
            '===Etymology 2===', '{{ja-pron|はし|acc=o}}',
            '==Korean==', '{{ja-pron|はし|acc=0}}',
        ].join('\n');
        expect(accentRowsOf('橋', page)).toEqual([
            { form: '橋', reading: 'はし', accents: ['1'] },
            { form: '橋', reading: 'はし', accents: ['o'] },
        ]);
    });
});

describe('UniDic', () => {
    const line = (orth: string, orthBase: string, kana: string, kanaBase: string, aType: string) =>
        ['x', '1', '2', '3', '動詞', '一般', '*', '*', '*', '*', 'L', 'lemma', orth, 'P', orthBase, 'P', '和', '*', '*', '*', '*', '*', '*', '用', kana, kanaBase, 'F', 'F', aType, 'C1', '*', '1', '2'].join(',');

    it('splits quoted cells that hold commas', () => {
        expect(lexCells('a,"3,4",b')).toEqual(['a', '3,4', 'b']);
        expect(lexCells('a,b,')).toEqual(['a', 'b', '']);
    });

    it('keeps a dictionary form with its accents, most usual first', () => {
        expect(unidicRow(line('考える', '考える', 'カンガエル', 'カンガエル', '"3,4"'))).toEqual({ form: '考える', reading: 'カンガエル', accents: ['3', '4'] });
    });

    it('leaves out conjugated forms and rows without an accent', () => {
        expect(unidicRow(line('食べ', '食べる', 'タベ', 'タベル', '2'))).toBeNull();
        expect(unidicRow(line('食べる', '食べる', 'タベル', 'タベル', '*'))).toBeNull();
    });
});

describe('snapshot', () => {
    it('round-trips rows, sorted and deduplicated, with its header as comments', () => {
        const rows = [
            { form: '橋', reading: 'はし', accents: ['o'] },
            { form: '箸', reading: 'はし', accents: ['1'] },
            { form: '橋', reading: 'はし', accents: ['o'] },
        ];
        const text = formatSnapshot(['source'], rows);
        expect(text.startsWith('# source\n')).toBe(true);
        // By code point: 橋 (U+6A4B) before 箸 (U+7BB8).
        expect(parseSnapshot(text)).toEqual([rows[0], rows[1]]);
    });

    it('fails on a row without an accent', () => {
        expect(() => parseSnapshot('橋\tはし\n')).toThrow(/line 1/);
    });
});
