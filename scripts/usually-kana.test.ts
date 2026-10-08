import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { Vocabulary } from '../src/models/vocabulary.model';
import labels from './usually-kana.labels.json';

/**
 * Guards the compiled `usuallyKana` flag against the hand-labelled set the rule
 * was chosen on (decideUsuallyKana in build-common.ts). Each entry is
 * [vocab id, kanji/reading, JLPT level]:
 *
 *  - `kanji`: learned with its kanji. Showing it in kana is the costly error, so
 *    none may be flagged: a rule change that flags one fails here, and the fix is
 *    the rule or data/raw/vocab/usually-kana-overrides.json.
 *  - `kana`: a learner meets it in kana. Most must be flagged; the floor sits just
 *    under the rule's measured recall so a rule that quietly stops catching them
 *    fails too.
 *  - `either`: both spellings are normal. Not asserted.
 *
 * When in doubt a word was labelled `kanji` (the kanji spelling disambiguates).
 * Runs against compiled/vocab, so it describes the committed output; a word the
 * build no longer compiles (merged away, dropped) is skipped.
 */

const VOCAB_DIR = './compiled/vocab';
const KANA_RECALL_FLOOR = 0.8;

function compiled(id: string): Vocabulary | null {
    const file = path.join(VOCAB_DIR, `${id}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) as Vocabulary : null;
}

describe('usuallyKana against the labelled set', () => {
    it('never flags a word labelled as learned with its kanji', () => {
        const flagged = labels.kanji.filter(([id]) => compiled(id)?.usuallyKana).map(([, word]) => word);
        expect(flagged).toEqual([]);
    });

    it(`flags at least ${KANA_RECALL_FLOOR * 100}% of the words labelled as learned in kana`, () => {
        const present = labels.kana.map(([id]) => compiled(id)).filter((v): v is Vocabulary => v !== null);
        const flagged = present.filter(v => v.usuallyKana);
        expect(flagged.length / present.length).toBeGreaterThanOrEqual(KANA_RECALL_FLOOR);
    });

    it('flags a word whose only kanji forms are search-only (の: 乃 and 之 are both sK)', () => {
        // JMdict tags 乃/之 `sK` (search-only, never displayed), not `rK`, and JPDB
        // has no kanji frequency row for a particle, so without the sK signal the
        // rule left の showing its search-only kanji 乃. See decideUsuallyKana.
        const no = compiled('1469800');
        if (no) expect(no.usuallyKana).toBe(true);
    });

    it('flags the core N5 words the feature exists for', () => {
        const core = ['此処', '彼の', '此の', '其の', '此れ', '何処', '有る', '居る', '成る', '下さい', '未だ', '沢山'];
        const missing = core.filter(word => {
            const entry = labels.kana.find(([, label]) => label.startsWith(`${word}/`));
            return !entry || !compiled(entry[0])?.usuallyKana;
        });
        expect(missing).toEqual([]);
    });
});
