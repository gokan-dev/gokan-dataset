import { describe, expect, it } from 'vitest';
import { MatchLog, matchHeadword, matchSpelling, matchSpellingAndReading, wordIndex } from './match';

const index = wordIndex([
    { id: '1327720', headword: '手紙', spellings: ['手紙'], readings: ['てがみ'] },
    { id: '1', headword: '家', spellings: ['家'], readings: ['いえ', 'うち'] },
    { id: '2', headword: '内', spellings: ['内', '家'], readings: ['うち'] },
    { id: '3', headword: '其れ', spellings: ['其れ', 'それ'], readings: ['それ'] },
]);

describe('the matcher', () => {
    it('attaches a record to the one word written and read as it says, with that evidence', () => {
        expect(matchSpellingAndReading(index, '手紙', ['テガミ'])).toEqual({ id: '1327720', match: 'spelling+reading' });
        expect(matchSpellingAndReading(index, '家', ['いえ'])).toEqual({ id: '1', match: 'spelling+reading' });
    });

    it('never guesses: no reading, another reading, or two words read alike are failures', () => {
        expect(matchSpellingAndReading(index, '手紙', [])).toEqual({ failure: 'no reading' });
        expect(matchSpellingAndReading(index, '手紙', ['てがん'])).toEqual({ failure: 'reading differs' });
        expect(matchSpellingAndReading(index, '家', ['うち'])).toEqual({ failure: 'several words' });
        expect(matchSpellingAndReading(index, '郵便', ['ゆうびん'])).toEqual({ failure: 'no word' });
    });

    it('matches a spelling alone, a kana spelling of a word learned in kana included, only when one word has it', () => {
        expect(matchSpelling(index, 'それ')).toEqual({ id: '3', match: 'spelling' });
        expect(matchSpelling(index, '家')).toEqual({ failure: 'several words' });
        expect(matchHeadword(index, '家')).toEqual({ id: '1', match: 'spelling' });
    });

    it('counts outcomes per source, with samples of the failures only', () => {
        const log = new MatchLog();
        log.record('wikidata', { id: '1', match: 'spelling+reading' }, '家');
        log.record('wikidata', { failure: 'no word' }, '郵便');
        log.record('zhwiktionary', 'excluded', '汚泥処理');
        expect(log.summary()).toEqual(['wikidata: matched 1, no word 1', 'zhwiktionary: excluded 1']);
        expect(log.report()).toContain('## wikidata: no word\n郵便');
        expect(log.report()).not.toContain('## wikidata: matched');
    });
});
