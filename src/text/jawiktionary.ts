// Japanese Wiktionary (kaikki.org extraction), two ways: the Chinese words in a Japanese entry's
// translation table, and its Chinese entries, defined in Japanese, read backwards (信 is defined as
// 手紙, so 信 is an equivalent of 手紙). Both give equivalents; the matcher attaches them.
import { hiraganaReading, isAllKana, kaikkiRef, spellingReading, type KaikkiEntry } from './kaikki';

/** Mandarin as written in either script, told apart later by its characters; Southern Min is its own language (decision D2). */
export type ChineseLanguage = 'zh' | 'nan';

export interface EquivalentValue {
    value: string;
    lang: ChineseLanguage;
}

/** A translation table's language codes: Chinese (中国語, 漢語) and Mandarin (北京官話) are `zh`, Southern Min (閩南語) `nan`. */
const TRANSLATION_LANGUAGES: Record<string, ChineseLanguage> = { zh: 'zh', cmn: 'zh', nan: 'nan' };

const HAN = /\p{Script=Han}/u;

/** A table cell may give both scripts at once (`飲/饮`): each is its own equivalent. */
function cellValues(word: string): string[] {
    return word.split(/[/／]/).map(w => w.trim()).filter(w => HAN.test(w));
}

export interface TranslationRecord {
    ref: string;
    spelling: string;
    readings: string[];
    equivalents: EquivalentValue[];
}

/**
 * The translation tables' records. A table sits on the entry it translates; a kanji page that is
 * only a pointer (`てがみの漢字表記。`) lends it the table of the kana entry it names, read as that
 * entry, as the benchmark did.
 */
export function translationRecords(entries: Iterable<KaikkiEntry>): TranslationRecord[] {
    const records: TranslationRecord[] = [];
    const kanaPages = new Map<string, TranslationRecord[]>();
    const pointers: { kanji: string; kana: string }[] = [];
    for (const entry of entries) {
        if (entry.pos === 'character') {
            for (const sense of entry.senses) for (const gloss of sense.glosses) {
                const m = /^(.+?)の漢字表記/.exec(gloss);
                if (m?.[1] && isAllKana(m[1])) pointers.push({ kanji: entry.word, kana: m[1] });
            }
            continue;
        }
        const equivalents = entry.translations.flatMap(t => {
            const lang = TRANSLATION_LANGUAGES[t.langCode];
            return lang ? cellValues(t.word).map(value => ({ value, lang })) : [];
        });
        if (equivalents.length === 0) continue;
        const readings = new Set(entry.forms.filter(f => f.tags.includes('transliteration')).map(f => spellingReading(entry.word, hiraganaReading(f.form))));
        if (isAllKana(entry.word)) readings.add(hiraganaReading(entry.word));
        const record = { ref: kaikkiRef(entry), spelling: entry.word, readings: [...readings], equivalents };
        records.push(record);
        if (isAllKana(entry.word)) kanaPages.set(entry.word, [...(kanaPages.get(entry.word) ?? []), record]);
    }
    for (const { kanji, kana } of pointers) {
        for (const record of kanaPages.get(kana) ?? []) records.push({ ...record, spelling: kanji, readings: [hiraganaReading(kana)] });
    }
    return records;
}

export interface ReverseRecord {
    ref: string;
    /** The Japanese the gloss is: a word's spelling. */
    spelling: string;
    equivalents: EquivalentValue[];
}

/** A sense's leading label (`(閩南語) 新鮮な。`, `（日本語に同じ）冠詞。`). */
const LEADING_LABEL = /^\s*[（(]([^）)]*)[）)]\s*/;

/** Labels naming Southern Min (閩南語, and Taiwanese, a variety of it): the sense is `nan`. */
const SOUTHERN_MIN = /閩南|台湾語|臺灣語/;
/** Labels naming another Chinese language: not Mandarin, and without a tag of its own here, so left out. */
const OTHER_CHINESE = /広東語|粤語|粵語|香港語|呉語|上海語|客家語|閩東語|閩北語|潮州語|福州語|文語中国語/;

/** The language a sense's labels say it is in; undefined for a Chinese language other than Mandarin and Southern Min. */
export function senseLanguage(labels: string[]): ChineseLanguage | undefined {
    if (labels.some(l => SOUTHERN_MIN.test(l))) return 'nan';
    if (labels.some(l => OTHER_CHINESE.test(l))) return undefined;
    return 'zh';
}

/**
 * The spellings a gloss can be, under the rule in docs/MULTILINGUAL.md ("Matching"): the whole
 * gloss, or a whole 、-separated part of it, labels and brackets removed, its final 。 dropped.
 * 信 ("手紙。") gives 手紙; 久闊 ("長期間会わないこと。また、手紙を送らないこと。") gives nothing
 * that is a word. A verbal noun's する is dropped too (信用する is 信用), as the benchmark did.
 */
export function glossSpellings(gloss: string): string[] {
    const bare = gloss.replace(/（[^）]*）|\([^)]*\)|〔[^〕]*〕|［[^］]*］|[「」『』]/g, '').trim();
    const parts = [bare, ...bare.split('、')].map(p => p.trim().replace(/。$/, '').trim()).filter(p => p && !/[。、]/.test(p));
    const spellings = parts.flatMap(p => (p.endsWith('する') && p.length > 3 ? [p, p.slice(0, -2)] : [p]));
    return [...new Set(spellings)];
}

/**
 * A Chinese entry's records: for each spelling one of its glosses is, the entry's headwords (the
 * page and its other script's canonical form) as equivalents, in the language the sense's labels say.
 */
export function reverseRecords(entry: KaikkiEntry): ReverseRecord[] {
    if (entry.pos === 'character' || entry.pos === 'romanization') return [];
    const heads = [...new Set([entry.word, ...entry.forms.filter(f => f.tags.includes('canonical') && HAN.test(f.form)).map(f => f.form)])].filter(h => HAN.test(h));
    if (heads.length === 0) return [];
    const ref = kaikkiRef(entry);
    const records = new Map<string, ReverseRecord>();
    for (const sense of entry.senses) {
        if (sense.pointer) continue;
        for (const gloss of sense.glosses) {
            const label = LEADING_LABEL.exec(gloss)?.[1];
            const lang = senseLanguage([...(label ? [label] : []), ...sense.rawTags]);
            if (!lang) continue;
            for (const spelling of glossSpellings(gloss)) {
                const key = `${lang}\u0000${spelling}`;
                if (!records.has(key)) records.set(key, { ref, spelling, equivalents: heads.map(value => ({ value, lang })) });
            }
        }
    }
    return [...records.values()];
}
