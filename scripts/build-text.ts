#!/usr/bin/env bun
// The text sources read after the core is assembled (docs/MULTILINGUAL.md, "Pipeline"): each one
// imported from its snapshot in data/sources/, matched to the assembled words, sentences and
// kanji, assembled into renderings of its own, assessed (corroboration, the script transform), and
// added to each entity's `text` in build/assembled/, where build:layout finds it like any other.
// Today they are the Chinese sources of phase 4: Chinese Wiktionary (definitions), Japanese
// Wiktionary (equivalents, from translation tables and Chinese entries read backwards), Wikidata
// (equivalents), Wikipedia (corroboration only), Tatoeba's Mandarin (sentence translations) and
// Unihan (kanji labels).
//
// It runs at the end of build:data, before build:grammar, so a mined grammar example carries its
// sentence's translations in these languages too. It first removes what its own sources gave, so
// running it again gives the same files. No network: every snapshot is in the repository.
//
// Run: bun run build:text (part of build:data).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createGunzip, gunzipSync } from 'node:zlib';
import { serializeLike } from '../src/audio/attach';
import type { AssembledSearchIndexEntry } from '../src/models/index.model';
import type { Kanji } from '../src/models/kanji.model';
import type { Sentence } from '../src/models/sentence.model';
import type { MatchEvidence, SourceId, TextByLanguage } from '../src/models/text.model';
import type { Vocabulary } from '../src/models/vocabulary.model';
import {
    chineseSentenceText, chineseWordText, searchGloss, serveStats, type CheckInput, type DefinitionInput, type EquivalentInput, type TranslationInput,
} from '../src/text/chineseText';
import { parseUnihanVariants } from '../src/text/hanScript';
import { reverseRecords, translationRecords } from '../src/text/jawiktionary';
import { parseKaikkiEntry, type KaikkiEntry } from '../src/text/kaikki';
import { MatchLog, matchHeadword, matchSpelling, matchSpellingAndReading, wordIndex, type MatchResult, type MatchWord } from '../src/text/match';
import { sourceCommunities } from '../src/text/registry';
import { addRenderings, withoutRenderings, withoutSources } from '../src/text/renderings';
import { readReviews } from '../src/text/reviewFiles';
import { applyVerdicts, isReviewNote, noteRenderings, staleVerdicts, unknownWords, verdictIndex } from '../src/text/reviews';
import { directionOf, linkKind, sentenceBase, tsvRows, type LinkKind } from '../src/text/tatoebaCmn';
import { parseMandarinReadings, unihanText } from '../src/text/unihan';
import { parseLexemes, parseSitelinks, wikidataRecord } from '../src/text/wikimedia';
import { isBotEntry, zhWiktionaryRecords } from '../src/text/zhwiktionary';

const ASSEMBLED_DIR = './build/assembled';
const SOURCES_DIR = './data/sources';
const REVIEWS_DIR = './data/reviews';
const LOG_FILE = path.join(ASSEMBLED_DIR, 'text_matching.log');

/** The sources this stage reads: what they gave is removed before they are read again. */
const OWN_SOURCES: ReadonlySet<SourceId> = new Set(['zhwiktionary', 'jawiktionary', 'wikidata', 'wikipedia', 'tatoeba-cmn', 'unihan']);
/** The languages this stage gives a search gloss in, replaced on every run. */
const GLOSS_LANGUAGES = ['zh-hans', 'zh-hant', 'nan'];

const snapshot = (source: string, file: string): string => path.join(SOURCES_DIR, source, file);

function readJson<T>(file: string): T {
    // Output of this repository's own earlier stages, already typed by them.
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function gunzipText(file: string): string {
    return gunzipSync(fs.readFileSync(file)).toString('utf8');
}

/** A gzipped snapshot's lines, streamed: the Wiktionary extractions are hundreds of MB once inflated. */
async function* gzLines(file: string): AsyncGenerator<string> {
    const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) if (line) yield line;
}

async function kaikkiEntries(file: string): Promise<KaikkiEntry[]> {
    const entries: KaikkiEntry[] = [];
    for await (const line of gzLines(file)) {
        const entry = parseKaikkiEntry(JSON.parse(line));
        if (entry) entries.push(entry);
    }
    return entries;
}

const jsonFiles = (dir: string): string[] => fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();

/** Rewrites a file only when its content changed, in the layout it had. */
function rewrite(file: string, original: string, value: unknown): boolean {
    const next = serializeLike(original, value);
    if (next === original) return false;
    fs.writeFileSync(file, next);
    return true;
}

const log = new MatchLog();
const stats = serveStats();
const samplesOf = (result: MatchResult): string => ('id' in result ? result.id : result.failure);

async function main(): Promise<void> {
    if (!fs.existsSync(path.join(ASSEMBLED_DIR, 'vocab'))) throw new Error(`${ASSEMBLED_DIR}/vocab not found: run build:data first.`);
    const variants = parseUnihanVariants(gunzipText(snapshot('unihan', 'Unihan_Variants.txt.gz')).split('\n'));
    const mandarin = parseMandarinReadings(gunzipText(snapshot('unihan', 'Unihan_Readings.txt.gz')).split('\n'));
    const community = sourceCommunities(SOURCES_DIR);

    // ---- the words, as the matcher knows them
    const vocabDir = path.join(ASSEMBLED_DIR, 'vocab');
    const words: MatchWord[] = [];
    const readingCount = new Map<string, number>();
    for (const f of jsonFiles(vocabDir)) {
        const v = readJson<Vocabulary>(path.join(vocabDir, f));
        const spellings = [v.writtenForm.kanji, ...v.writtenForm.alternatives, ...(v.usuallyKana ? [v.reading.primary] : [])];
        const readings = [v.reading.primary, ...v.reading.alternatives];
        words.push({ id: v.id, headword: v.writtenForm.kanji, spellings, readings });
        readingCount.set(v.id, new Set(readings).size);
    }
    const index = wordIndex(words);

    // ---- the reviews (build check 6): every record readable, every word it names real, before the long reads
    const { reviews, problems: reviewProblems } = readReviews(REVIEWS_DIR);
    const forms = new Map(words.map(w => [w.id, { forms: [...w.spellings, ...w.readings] }]));
    const { index: verdicts, problems: duplicateVerdicts } = verdictIndex(reviews.verdicts);
    const reviewFailures = [...reviewProblems, ...duplicateVerdicts, ...unknownWords(reviews, forms)];
    if (reviewFailures.length > 0) throw new Error(`data/reviews/ has ${reviewFailures.length} problem(s):\n  ${reviewFailures.join('\n  ')}`);
    const notes = noteRenderings(reviews.notes);
    const noteLanguages = new Set(reviews.notes.map(n => n.lang));
    const ownText = (text: TextByLanguage): TextByLanguage => withoutRenderings(text, (r, lang) => OWN_SOURCES.has(r.source.source) || isReviewNote(r, noteLanguages, lang));

    const spellingRank = new Map(words.map(w => [w.id, w.spellings]));
    const inputs = new Map<string, { definitions: DefinitionInput[]; equivalents: EquivalentInput[]; checks: CheckInput[] }>();
    const inputsOf = (id: string) => {
        let entry = inputs.get(id);
        if (!entry) { entry = { definitions: [], equivalents: [], checks: [] }; inputs.set(id, entry); }
        return entry;
    };

    // ---- Chinese Wiktionary: one definition per page a word matches, its entries' senses in page order
    let botEntries = 0;
    let entryIndex = 0;
    /** Per word and page: per entry, the record whose spelling comes first among the word's. */
    const zhByWord = new Map<string, Map<string, Map<number, { rank: number; record: ReturnType<typeof zhWiktionaryRecords>[number]; match: MatchEvidence }>>>();
    for (const file of ['kaikki-ja-trad.jsonl.gz', 'kaikki-ja-simp.jsonl.gz']) {
        for await (const line of gzLines(snapshot('zhwiktionary', file))) {
            const entry = parseKaikkiEntry(JSON.parse(line));
            entryIndex++;
            if (!entry) continue;
            if (isBotEntry(entry)) { botEntries++; log.record('zhwiktionary', 'excluded', `${entry.word} (bot entry)`); continue; }
            for (const record of zhWiktionaryRecords(entry)) {
                const result = matchSpellingAndReading(index, record.spelling, record.reading ? [record.reading] : []);
                log.record('zhwiktionary', result, `${record.spelling} (${record.reading ?? '?'}) ${record.ref}`);
                if (!('id' in result)) continue;
                const pages = zhByWord.get(result.id) ?? new Map();
                zhByWord.set(result.id, pages);
                const entries = pages.get(record.ref) ?? new Map();
                pages.set(record.ref, entries);
                const rank = spellingRank.get(result.id)?.indexOf(record.spelling) ?? 0;
                const previous = entries.get(entryIndex);
                if (!previous || rank < previous.rank) entries.set(entryIndex, { rank, record, match: result.match });
            }
        }
    }
    for (const [id, pages] of [...zhByWord].sort(([a], [b]) => (a < b ? -1 : 1))) {
        for (const [ref, entries] of pages) {
            const ordered = [...entries].sort(([a], [b]) => a - b).map(([, e]) => e);
            const several = (readingCount.get(id) ?? 0) > 1;
            inputsOf(id).definitions.push({
                source: 'zhwiktionary',
                ref,
                match: ordered[0]?.match ?? 'spelling+reading',
                senses: ordered.flatMap(({ record }) => record.senses.map(s => ({
                    glosses: s.glosses,
                    tags: s.tags,
                    ...(s.spellings ? { spellings: s.spellings } : {}),
                    pos: record.pos,
                    ...(several && record.reading ? { reading: record.reading } : {}),
                }))),
            });
        }
    }
    console.log(`   - Chinese Wiktionary: ${botEntries} bot entries left out (decision D5); ${zhByWord.size} words defined`);

    // ---- Japanese Wiktionary: translation tables, then Chinese entries read backwards
    const addEquivalents = (source: SourceId, id: string, ref: string, match: MatchEvidence, values: { value: string; lang: 'zh' | 'nan' }[]) => {
        for (const { value, lang } of values) inputsOf(id).equivalents.push({ source, ref, match, value, lang });
    };
    const jaEntries = await kaikkiEntries(snapshot('jawiktionary', 'kaikki-ja.jsonl.gz'));
    const translationMatches: { id: string; ref: string; match: MatchEvidence; equivalents: { value: string; lang: 'zh' | 'nan' }[] }[] = [];
    for (const record of translationRecords(jaEntries)) {
        const result = matchSpellingAndReading(index, record.spelling, record.readings);
        log.record('jawiktionary (translations)', result, `${record.spelling} (${record.readings.join(',') || '?'}) ${record.ref}`);
        if ('id' in result) translationMatches.push({ id: result.id, ref: record.ref, match: result.match, equivalents: record.equivalents });
    }
    for (const m of translationMatches) addEquivalents('jawiktionary', m.id, m.ref, m.match, m.equivalents);
    for await (const line of gzLines(snapshot('jawiktionary', 'kaikki-zh.jsonl.gz'))) {
        const entry = parseKaikkiEntry(JSON.parse(line));
        if (!entry) continue;
        for (const record of reverseRecords(entry)) {
            const result = matchSpelling(index, record.spelling);
            // A gloss that is not one of our spellings is ordinary Japanese prose, not a failed match.
            if ('failure' in result && result.failure === 'no word') continue;
            log.record('jawiktionary (reverse)', result, `${record.spelling} ${record.ref} [${samplesOf(result)}]`);
            if ('id' in result) addEquivalents('jawiktionary', result.id, record.ref, result.match, record.equivalents);
        }
    }

    // ---- Wikidata lexemes, and Wikipedia's article titles (checks only)
    for (const lexeme of parseLexemes(JSON.parse(gunzipText(snapshot('wikidata', 'lexemes-zh.json.gz'))))) {
        const record = wikidataRecord(lexeme);
        if (!record) continue;
        const result = matchSpellingAndReading(index, record.spelling, record.readings);
        log.record('wikidata', result, `${record.spelling} (${record.readings.join(',') || '?'}) ${record.ref}`);
        if ('id' in result) addEquivalents('wikidata', result.id, record.ref, result.match, record.equivalents.map(value => ({ value, lang: 'zh' })));
    }
    for (const [title, zh] of parseSitelinks(JSON.parse(gunzipText(snapshot('wikipedia', 'ja-zh-sitelinks.json.gz'))))) {
        const result = matchHeadword(index, title);
        log.record('wikipedia', result, title);
        if ('id' in result) inputsOf(result.id).checks.push({ source: 'wikipedia', ref: title, text: zh });
    }

    // ---- assemble and assess each word, and its search gloss
    const searchFile = path.join(ASSEMBLED_DIR, 'index', 'search.json');
    const search = readJson<AssembledSearchIndexEntry[]>(searchFile);
    const glossById = new Map<string, Record<string, string>>();
    let wordsWritten = 0;
    const wordsByLang = new Map<string, number>();
    for (const f of jsonFiles(vocabDir)) {
        const file = path.join(vocabDir, f);
        const original = fs.readFileSync(file, 'utf8');
        // Output of build:data, already typed by it.
        const v = JSON.parse(original) as Vocabulary;
        const text = ownText(v.text);
        const own = inputs.get(v.id);
        const wordNotes = notes.get(v.id);
        if (own || wordNotes) {
            const assembled = own ? chineseWordText(v.id, own, community, variants, stats) : {};
            for (const n of wordNotes ?? []) addRenderings(assembled, n.lang, n.renderings);
            // Reviews before the search gloss, so a rejected text is never chosen.
            const chinese = applyVerdicts(assembled, 'vocab', v.id, verdicts);
            for (const [lang, entity] of Object.entries(chinese)) {
                addRenderings(text, lang, entity.renderings);
                wordsByLang.set(lang, (wordsByLang.get(lang) ?? 0) + 1);
            }
            const glosses: Record<string, string> = {};
            for (const lang of GLOSS_LANGUAGES) {
                const gloss = searchGloss(chinese, lang);
                if (gloss) glosses[lang] = gloss;
            }
            glossById.set(v.id, glosses);
        }
        if (rewrite(file, original, { ...v, text })) wordsWritten++;
    }
    const stale = staleVerdicts(verdicts);
    if (stale.length > 0) throw new Error(`${stale.length} verdict(s) in data/reviews/ name a rendering that does not exist (build check 6):\n  ${stale.join('\n  ')}`);
    const decided = new Map<string, number>();
    for (const v of reviews.verdicts) {
        const key = `${v.lang} ${v.decision}`;
        decided.set(key, (decided.get(key) ?? 0) + 1);
    }
    console.log(`   - Reviews applied: ${[...decided].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `${k} ${n}`).join(', ')}; ${verdicts.statusChanged} reviewed at another status than they have now; ${reviews.notes.length} notes; ${reviews.gold.length} gold words`);
    for (const entry of search) {
        for (const lang of GLOSS_LANGUAGES) delete entry.m[lang];
        Object.assign(entry.m, glossById.get(entry.id) ?? {});
    }
    fs.writeFileSync(searchFile, JSON.stringify(search));
    console.log(`   - Words: ${[...wordsByLang].sort(([a], [b]) => (a < b ? -1 : 1)).map(([l, n]) => `${l} ${n}`).join(', ')}; ${wordsWritten} files rewritten`);

    // ---- Tatoeba's first-hand Mandarin, for the sentences in the pool
    const tatoeba = (file: string) => snapshot('tatoeba-cmn', file);
    const links = tsvRows(gunzipText(tatoeba('jpn-cmn_links.tsv.gz'))).flatMap(([ja, zh]) => (ja && zh ? [{ ja, zh }] : []));
    const japanese = new Map(tsvRows(gunzipText(tatoeba('jpn_sentences.tsv.gz'))).flatMap(([id, , text]) => (id && text !== undefined ? [[id, text] as const] : [])));
    const mandarinText = new Map(tsvRows(gunzipText(tatoeba('cmn_sentences.tsv.gz'))).flatMap(([id, , text]) => (id && text !== undefined ? [[id, text] as const] : [])));
    const wanted = new Set(links.flatMap(l => [l.ja, l.zh]));
    const base = new Map<string, string>();
    for await (const line of gzLines(tatoeba('sentences_base.csv.gz'))) {
        const row = sentenceBase(line);
        if (row && wanted.has(row[0])) base.set(row[0], row[1]);
    }
    const kinds = new Map<LinkKind, number>();
    const translationsOf = new Map<string, TranslationInput[]>();
    const japaneseIds = new Set(japanese.keys());
    for (const { ja, zh } of links) {
        const text = mandarinText.get(zh);
        if (text === undefined) continue;
        const kind = linkKind(ja, zh, base, japaneseIds);
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        const direction = directionOf(kind);
        if (direction) translationsOf.set(ja, [...(translationsOf.get(ja) ?? []), { ref: zh, text, direction }]);
    }
    for (const list of translationsOf.values()) list.sort((a, b) => Number(a.ref) - Number(b.ref));

    const sentencesDir = path.join(ASSEMBLED_DIR, 'sentences');
    const pool = new Set<string>();
    const withTranslation = new Set<string>();
    let changedSinceSnapshot = 0;
    const countedChange = new Set<string>();
    const sentenceText = new Map<string, TextByLanguage>();
    let sentenceFilesWritten = 0;
    for (const f of jsonFiles(sentencesDir)) {
        const file = path.join(sentencesDir, f);
        const original = fs.readFileSync(file, 'utf8');
        // Output of build:data, already typed by it.
        const sentences = JSON.parse(original) as Sentence[];
        let touched = false;
        const next = sentences.map(s => {
            pool.add(s.id);
            const had = Object.values(s.text).some(e => e.renderings.some(r => OWN_SOURCES.has(r.source.source)));
            const found = translationsOf.get(s.id);
            // Our sentence pool was read from an earlier export: a translation of a Japanese text
            // edited since is a translation of another text, so it is left out.
            const sameText = found !== undefined && japanese.get(s.id)?.trim() === s.original.trim();
            if (found && !sameText && !countedChange.has(s.id)) { countedChange.add(s.id); changedSinceSnapshot++; }
            if (!had && !sameText) return s;
            touched = true;
            const text = withoutSources(s.text, OWN_SOURCES);
            if (found && sameText) {
                withTranslation.add(s.id);
                // A sentence is in the file of every word it uses: assembled once, so it is counted once.
                let chinese = sentenceText.get(s.id);
                if (!chinese) { chinese = chineseSentenceText(s.id, 'tatoeba-cmn', found, variants, stats); sentenceText.set(s.id, chinese); }
                for (const [lang, entity] of Object.entries(chinese)) addRenderings(text, lang, entity.renderings);
            }
            return { ...s, text };
        });
        if (touched && rewrite(file, original, next)) sentenceFilesWritten++;
    }
    console.log(`   - Tatoeba: links ${JSON.stringify(Object.fromEntries([...kinds].sort(([a], [b]) => (a < b ? -1 : 1))))}; ${translationsOf.size} Japanese sentences with a first-hand Mandarin translation, ${withTranslation.size} of them in the pool of ${pool.size}; ${changedSinceSnapshot} left out because the Japanese changed since the pool's export; ${sentenceFilesWritten} files rewritten`);

    // ---- Unihan, for every kanji
    const kanjiDir = path.join(ASSEMBLED_DIR, 'kanji');
    const kanjiText = (k: Kanji): TextByLanguage => {
        const text = withoutSources(k.text, OWN_SOURCES);
        for (const [lang, entity] of Object.entries(unihanText(k.character, variants, mandarin))) addRenderings(text, lang, entity.renderings);
        return text;
    };
    let kanjiLabelled = 0;
    for (const f of jsonFiles(kanjiDir)) {
        const file = path.join(kanjiDir, f);
        const original = fs.readFileSync(file, 'utf8');
        // Output of build:kanji, already typed by it.
        const k = JSON.parse(original) as Kanji;
        const text = kanjiText(k);
        if (Object.keys(text).some(lang => lang.startsWith('zh'))) kanjiLabelled++;
        rewrite(file, original, { ...k, text });
    }
    const listFile = path.join(ASSEMBLED_DIR, 'kanji.json');
    const listOriginal = fs.readFileSync(listFile, 'utf8');
    // Output of build:kanji, already typed by it.
    rewrite(listFile, listOriginal, (JSON.parse(listOriginal) as Kanji[]).map(k => ({ ...k, text: kanjiText(k) })));
    console.log(`   - Unihan: ${kanjiLabelled} kanji labelled`);

    console.log(`   - Script: ${stats.converted} values written in Simplified by the transform; ${stats.unconvertible} renderings not in zh-hans (a Traditional-only character with no single Simplified variant); ${stats.simplifiedOnly} not in zh-hant (Simplified-only characters)`);
    for (const line of log.summary()) console.log(`   - Matched ${line}`);
    fs.writeFileSync(LOG_FILE, log.report());
    console.log(`   - Unmatched and ambiguous records, with samples: ${LOG_FILE}`);
}

console.log('🈶 Text sources read after the core (phase 4: Chinese)...');
await main();
