/**
 * JLPT levels for words formed from a listed word by one fixed affix, which Waller's
 * lists do not repeat: 一緒に (一緒, N5), 早く (早い, N5), お店 (店, N5), 私たち (私,
 * N5), 誰も (誰, N5). Anime says these constantly, so leaving them unlevelled made
 * every JLPT coverage mark undershoot what a learner at that level understands.
 *
 * A derived word takes its base's level only when BOTH its spelling and its reading
 * are the base's plus the affix, and the base is itself listed (never derived: no
 * chains). Idioms whose meaning is not the sum of the parts are excluded by hand in
 * jlpt-corrections.json (`derivedExclude`): 為に is grammar (ために), 癖に means
 * "despite", not "habit".
 */

export interface DerivableWord {
    id: string;
    writtenForm: { kanji: string; alternatives: string[] };
    reading: { primary: string; alternatives: string[] };
    jlptLevel?: number;
    jlptLevelFrom?: string;
}

interface Rule {
    name: string;
    /** The base's spelling and reading, or null when the rule does not apply. */
    base(written: string, reading: string): [string, string] | null;
}

const suffix = (name: string, written: string[], read: string): Rule => ({
    name,
    base: (w, r) => {
        const ending = written.find(s => w.endsWith(s) && w.length > s.length);
        return ending && r.endsWith(read) && r.length > read.length
            ? [w.slice(0, -ending.length), r.slice(0, -read.length)]
            : null;
    },
});

const prefix = (name: string, written: string[], read: string): Rule => ({
    name,
    base: (w, r) => {
        const start = written.find(s => w.startsWith(s) && w.length > s.length);
        return start && r.startsWith(read) && r.length > read.length
            ? [w.slice(start.length), r.slice(read.length)]
            : null;
    },
});

export const DERIVATION_RULES: Rule[] = [
    suffix('adverb in に', ['に'], 'に'),
    { name: 'adverb in く', base: (w, r) => (w.endsWith('く') && r.endsWith('く') && w.length > 1 ? [w.slice(0, -1) + 'い', r.slice(0, -1) + 'い'] : null) },
    prefix('polite お', ['お', '御'], 'お'),
    prefix('polite ご', ['ご', '御'], 'ご'),
    suffix('plural たち', ['たち', '達'], 'たち'),
    suffix('with も', ['も'], 'も'),
];

/**
 * Give each unlevelled word the level of the listed word it is derived from. Mutates
 * the words (jlptLevel, jlptLevelFrom) and returns the ids it levelled.
 */
export function inheritJlptLevels(words: DerivableWord[], excluded: ReadonlySet<string>): string[] {
    const listed = new Map<string, DerivableWord>();
    for (const w of words) {
        if (w.jlptLevel === undefined || w.jlptLevelFrom) continue;
        for (const form of [w.writtenForm.kanji, ...w.writtenForm.alternatives]) {
            for (const reading of [w.reading.primary, ...w.reading.alternatives]) {
                const key = `${form}|${reading}`;
                const current = listed.get(key);
                if (!current || w.jlptLevel > (current.jlptLevel ?? 0)) listed.set(key, w);
            }
        }
    }

    const levelled: string[] = [];
    for (const w of words) {
        if (w.jlptLevel !== undefined || excluded.has(w.id)) continue;
        for (const rule of DERIVATION_RULES) {
            const base = rule.base(w.writtenForm.kanji, w.reading.primary);
            const from = base && listed.get(`${base[0]}|${base[1]}`);
            if (!from || from.id === w.id) continue;
            w.jlptLevel = from.jlptLevel;
            w.jlptLevelFrom = from.id;
            levelled.push(w.id);
            break;
        }
    }
    return levelled;
}
