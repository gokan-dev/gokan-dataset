import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type { Sense, Vocabulary } from '../src/models/vocabulary.model';
import type { Sentence } from '../src/models/sentence.model';
import type { Kanji } from '../src/models/kanji.model';
import type { FrequencyIndex, KKLCIndex, SearchIndex } from '../src/models/index.model';
import type kuromoji from 'kuromoji';
import { JMDict } from "../src/models/data.model";
import {
    applyUsuallyKanaOverrides,
    buildMiscFlags,
    sortMergeGroup,
    decideUsuallyKana,
    isAffixOnly,
    learningIndexEntry,
    learningRank,
    mayShareHeadword,
    parseJpdbTsv,
    readSpokenCounts,
    type UsuallyKanaOverrides,
} from './build-common';
import { readWallerDecks, readWallerIdList, resolveJlptLevels, type JlptCorrections, type JmdictWordLike } from './jlpt-levels';
import { inheritJlptLevels } from './jlpt-derived';
import { BUILD_LIMITS } from './build-constants';
import { disambiguateByReading, type ReadingVocab } from '../src/utils/readingDisambiguation';

// --- Configuration ---
const INPUT_JMDICT_FILE = './data/raw/jmdict.json';
const INPUT_JPDB_FILE = './data/raw/jpdb_v2.2_freq_list_2024-10-13.json';
const INPUT_JPDB_TSV_FILE = './data/raw/jpdb_v2.2_freq_list_2024-10-13.csv';
const INPUT_USUALLY_KANA_OVERRIDES_FILE = './data/raw/vocab/usually-kana-overrides.json';
const INPUT_KANJI_FILE = './compiled/kanji.json';
const INPUT_SENTENCES_FILE = './data/raw/Sentence pairs in Japanese-English - 2026-02-15.tsv';
const INPUT_INDICES_FILE = './data/raw/jpn_indices.csv';
const INPUT_JLPT_ID_LIST_DIR = './data/raw/jlpt/waller-ids';
const INPUT_JLPT_DECKS_DIR = './data/raw/jlpt/waller-decks';
const INPUT_JLPT_CORRECTIONS_FILE = './data/raw/vocab/jlpt-corrections.json';
const INPUT_JITEN_DIR = './data/raw/media/jiten';

const OUTPUT_VOCAB_DIR = './compiled/vocab';
const OUTPUT_SENTENCES_DIR = './compiled/sentences';
const OUTPUT_INDEX_DIR = './compiled/index';

// --- Types ---
interface JPDBEntry {
    frequency: number;
    kanaFrequency: number | null;
}
type JPDBData = Record<string, Record<string, JPDBEntry>>;

interface BuildVocabulary extends Vocabulary {
    kklcStep: number;
    isCommon: boolean;
    /** Best JPDB rank of this spelling under one of the word's own readings, null when it has none (see compareMergeBase). Build-only. */
    ownRank: number | null;
    /** JMdict tags the headword `rK` (rarely used) or `sK` (search-only): not a normal display kanji (see decideUsuallyKana). Build-only. */
    rareKanjiForm: boolean;
    /** The headword is a normal spelling of this word, so it may merge with others written the same (see mayShareHeadword). Build-only. */
    sharesHeadword: boolean;
    /** How often anime says this exact JMdict entry (Jiten), for compareMergeBase. Build-only. */
    spoken: number;
    /** The first sense is only a suffix, prefix or counter, for compareMergeBase. Build-only. */
    affixOnly: boolean;
}

// --- Main ---

async function main() {
    console.log('🏗️  Starting Unified Data Build...');

    // 0. Tokenizer Import (Dynamic)
    const { SentenceTokenizer } = await import('../src/utils/tokenizer');
    const kuromoji = await import('kuromoji');

    console.log('⏳ Initializing Kuromoji tokenizer...');
    const tokenizer = await new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>((resolve, reject) => {
        kuromoji.default.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => {
            if (err) reject(err);
            else resolve(t);
        });
    });
    console.log('✅ Kuromoji ready!');
    const sentenceTokenizer = new SentenceTokenizer(tokenizer as any);

    // 1. Load Reference Data
    console.log('📚 Loading reference data...');

    // Kanji Data for KKLC mapping
    const kanjiData: Kanji[] = JSON.parse(fs.readFileSync(INPUT_KANJI_FILE, 'utf-8'));
    const kklcMap = new Map<string, number>();
    for (const k of kanjiData) {
        if (k.steps?.kklc) {
            kklcMap.set(k.character, k.steps.kklc);
        }
    }

    // JMDict
    console.log('   - JMDict...');
    const jmdict: JMDict = JSON.parse(fs.readFileSync(INPUT_JMDICT_FILE, 'utf-8'));

    // JPDB
    console.log('   - JPDB...');
    const jpdb: JPDBData = JSON.parse(fs.readFileSync(INPUT_JPDB_FILE, 'utf-8'));
    const jpdbTable = parseJpdbTsv(fs.readFileSync(INPUT_JPDB_TSV_FILE, 'utf-8'));
    const usuallyKanaOverrides: UsuallyKanaOverrides = JSON.parse(fs.readFileSync(INPUT_USUALLY_KANA_OVERRIDES_FILE, 'utf-8'));

    // JLPT levels per JMdict id, from Waller's lists (see jlpt-levels.ts).
    console.log('   - JLPT levels...');
    const jlptCorrections: JlptCorrections = JSON.parse(fs.readFileSync(INPUT_JLPT_CORRECTIONS_FILE, 'utf-8'));
    const jmdictById = new Map<string, JmdictWordLike>(jmdict.words.map(w => [w.id, {
        id: w.id,
        kanji: w.kanji.map(k => ({ text: k.text, tags: k.tags as unknown as string[] })),
        kana: w.kana.map(k => ({ text: k.text, common: k.common, tags: k.tags as unknown as string[], appliesToKanji: k.appliesToKanji })),
        sense: w.sense.map(s => ({ misc: s.misc as unknown as string[] })),
    }]));
    const jlpt = resolveJlptLevels(
        jmdictById,
        readWallerIdList(INPUT_JLPT_ID_LIST_DIR),
        readWallerDecks(INPUT_JLPT_DECKS_DIR),
        jlptCorrections,
    );
    console.log(`     ${jlpt.levels.size} JMdict entries levelled, ${jlpt.textbooks.size} with a textbook lesson.`);

    // Per-entry anime usage, to choose a merged word's base (compareMergeBase).
    const spokenCounts = readSpokenCounts(INPUT_JITEN_DIR);

    // 2. Build Candidate Vocabulary List
    console.log('🔎 Processing vocabulary candidates...');

    // Helper to extract kanji
    function extractKanji(word: string): string[] {
        return [...word].filter(c => /[\u4e00-\u9faf]/.test(c));
    }

    // Map: vocabId -> BuildVocabulary object
    const candidateVocab = new Map<string, BuildVocabulary>();
    // Map: writtenForm -> vocabId (for sentence matching)
    // Note: If multiple vocabs have same written form, we might have collisions.
    // JMDict IDs are unique. We'll prioritize common/higher freq ones if collision?
    // Current build-sentences just used map.set overwriting.
    // To match correctly, we might need a list of IDs per written form, but for optimization 
    // let's stick to the primary one or just overwrite for now as per original script.
    const writtenToVocabId = new Map<string, string[]>();


    for (const entry of jmdict.words) {
        if (!entry.kanji.length || !entry.kana.length) continue;

        // Relaxed check: Use common kanji if available, otherwise use first
        const primaryKanji = entry.kanji.find(k => k.common) ?? entry.kanji[0];
        if (!primaryKanji) continue;

        const kanjiText = primaryKanji.text;
        const containedKanji = extractKanji(kanjiText);
        if (!containedKanji.length) continue;

        // Collect alternative written forms
        const alternativeKanji = entry.kanji
            .map(k => k.text)
            .filter(text => text !== kanjiText);

        // Calculate primary reading
        const primaryReading =
            entry.kana.find(k => k.common && k.appliesToKanji.includes("*"))?.text
            ?? entry.kana[0].text;

        // Match JPDB frequency
        const jpdbKanjiEntry = jpdb[kanjiText];
        const ownRanks = entry.kana
            .map(k => jpdbKanjiEntry?.[k.text]?.frequency)
            .filter((rank): rank is number => rank !== undefined);
        const ownRank = ownRanks.length ? Math.min(...ownRanks) : null;
        let jpdbEntry: { kanjiRank?: number; hiraganaRank?: number } | null = null;

        if (jpdbKanjiEntry) {
            const readingEntry = jpdbKanjiEntry[primaryReading];
            if (readingEntry) {
                jpdbEntry = {
                    kanjiRank: readingEntry.frequency,
                    hiraganaRank: readingEntry.kanaFrequency ?? undefined,
                };
            } else {
                const firstReading = Object.values(jpdbKanjiEntry)[0];
                if (firstReading) {
                    jpdbEntry = {
                        kanjiRank: firstReading.frequency,
                        hiraganaRank: firstReading.kanaFrequency ?? undefined,
                    };
                }
            }
        }

        // If JPDB doesn't have an entry, we still keep the word!
        // We just give it a bottom-tier frequency so it can still be learned or searched via KKLC
        if (!jpdbEntry?.kanjiRank) {
            jpdbEntry = {
                kanjiRank: 999999,
                hiraganaRank: 999999
            };
        }

        let hasNonKKLC = false;
        let kklcStep = 0;
        for (const k of containedKanji) {
            const step = kklcMap.get(k);
            if (!step) {
                hasNonKKLC = true;
            } else {
                kklcStep = Math.max(kklcStep, step);
            }
        }
        if (hasNonKKLC) kklcStep = 99999;
        if (!kklcStep) continue; // Only skip if no kanji mapped at all

        const alternativeReadings = entry.kana
            .map(k => k.text)
            .filter(r => r !== primaryReading);

        const senses: Sense[] = entry.sense.map(s => ({
            pos: s.partOfSpeech,
            misc: buildMiscFlags(s.misc as unknown as string[]),
            glosses: s.gloss.map(g => g.text),
            related: {
                compounds: s.related.map(r => r[0]),
            },
        }));

        const requiresContext =
            entry.kana.length > 1 || senses.some(s => s.misc.isSuffix);

        // JLPT level of this exact JMdict entry; see jlpt-levels.ts.
        const jlptLevel = jlpt.levels.get(entry.id)?.level;
        const textbooks = jlpt.textbooks.get(entry.id);

        const vocabObj: BuildVocabulary = {
            id: entry.id,
            writtenForm: {
                kanji: kanjiText,
                alternatives: alternativeKanji,
                containedKanji,
            },
            reading: {
                primary: primaryReading,
                alternatives: alternativeReadings,
            },
            frequency: {
                kanjiRank: jpdbEntry.kanjiRank!,
                kanaRank: jpdbEntry.hiraganaRank,
            },
            jlptLevel,
            ...(textbooks ? { textbooks: textbooks.map(t => ({ ...t })) } : {}),
            progression: {
                kklcStep,
            },
            senses,
            usageHints: {
                requiresContext,
            },
            kklcStep,
            isCommon: primaryKanji.common,
            ownRank,
            rareKanjiForm: primaryKanji.tags.includes('rK') || primaryKanji.tags.includes('sK'),
            sharesHeadword: mayShareHeadword(primaryKanji.tags as unknown as string[]),
            spoken: spokenCounts.get(entry.id) ?? 0,
            affixOnly: isAffixOnly(senses[0]?.pos ?? []),
        };

        candidateVocab.set(entry.id, vocabObj);
    }

    console.log(`   - Found ${candidateVocab.size} initial vocabulary entries from JMDict.`);

    // --- MERGE EXACT KANJI HOMOGRAPHS ---
    // Only words for which the shared spelling is a normal one merge: あれ, whose
    // kanji 彼 is rare, stays its own word beside 彼/かれ (see mayShareHeadword).
    console.log('   - Merging homographs with identical kanji forms...');
    const vocabGroups = new Map<string, BuildVocabulary[]>();
    for (const vocab of candidateVocab.values()) {
        const key = vocab.sharesHeadword ? vocab.writtenForm.kanji : `${vocab.writtenForm.kanji}#${vocab.id}`;
        if (!vocabGroups.has(key)) {
            vocabGroups.set(key, []);
        }
        vocabGroups.get(key)!.push(vocab);
    }

    const mergedCandidateVocab = new Map<string, BuildVocabulary>();
    const mergedLogs: string[] = [];
    let mergedCount = 0;

    for (const group of vocabGroups.values()) {
        if (group.length === 1) {
            mergedCandidateVocab.set(group[0].id, group[0]);
            continue;
        }
        const kanji = group[0].writtenForm.kanji;

        // A listed reading, a common standalone word, the easiest level, then the one anime says most (see compareMergeBase).
        sortMergeGroup(group);

        const base = group[0];
        const baseReading = base.reading.primary;

        // Initialize merge tracking on base
        base.mergedVocabs = [{
            id: base.id,
            isBase: true,
            originalPrimaryReading: base.reading.primary,
            originalGlosses: base.senses[0]?.glosses.slice(0, 3) || []
        }];

        // Keep track of all readings to avoid exact duplicates
        const allReadings = new Set<string>();
        allReadings.add(base.reading.primary);
        base.reading.alternatives.forEach(r => allReadings.add(r));

        const logEntry = [`Merged "${kanji}": Base=${base.id} (${base.reading.primary})`];

        // Merge others into base
        for (let i = 1; i < group.length; i++) {
            const other = group[i];

            logEntry.push(`  <- ${other.id} (${other.reading.primary})`);

            // Track original ID
            base.mergedVocabs.push({
                id: other.id,
                isBase: false,
                originalPrimaryReading: other.reading.primary,
                originalGlosses: other.senses[0]?.glosses.slice(0, 3) || []
            });

            // Merge readings if new
            if (!allReadings.has(other.reading.primary)) {
                base.reading.alternatives.push(other.reading.primary);
                allReadings.add(other.reading.primary);
            }
            for (const alt of other.reading.alternatives) {
                if (!allReadings.has(alt)) {
                    base.reading.alternatives.push(alt);
                    allReadings.add(alt);
                }
            }

            // Merge Senses, tagging them with the reading they apply to
            for (const sense of other.senses) {
                sense.appliesToReadings = [other.reading.primary];
                base.senses.push(sense);
            }

            // Merge alternative kanji writings
            const allKanji = new Set<string>();
            allKanji.add(base.writtenForm.kanji);
            base.writtenForm.alternatives.forEach(k => allKanji.add(k));

            if (!allKanji.has(other.writtenForm.kanji)) {
                base.writtenForm.alternatives.push(other.writtenForm.kanji);
                allKanji.add(other.writtenForm.kanji);
            }
            for (const alt of other.writtenForm.alternatives) {
                if (!allKanji.has(alt)) {
                    base.writtenForm.alternatives.push(alt);
                    allKanji.add(alt);
                }
            }

            // Take the MIN KKLC step (earliest intro) if different
            if (other.kklcStep > 0 && other.kklcStep < base.kklcStep) {
                base.kklcStep = other.kklcStep;
                base.progression.kklcStep = other.kklcStep;
            }
            // If any was common, base is common
            if (other.isCommon) {
                base.isCommon = true;
            }

            // A level or textbook lesson carries over only from a homograph read like
            // the base: 辛い/からい (N5) must not make 辛い/つらい N5.
            if (other.reading.primary === baseReading || other.reading.alternatives.includes(baseReading)) {
                if (other.jlptLevel !== undefined && other.jlptLevel > (base.jlptLevel ?? 0)) base.jlptLevel = other.jlptLevel;
                for (const lesson of other.textbooks ?? []) {
                    if (!base.textbooks?.some(t => t.book === lesson.book && t.lesson === lesson.lesson)) {
                        base.textbooks = [...(base.textbooks ?? []), lesson];
                    }
                }
            }

            mergedCount++;
        }

        mergedLogs.push(logEntry.join('\n'));
        mergedCandidateVocab.set(base.id, base);
    }

    // Write the merge log to a text file for review
    const mergedLogPath = './compiled/merged_vocabs.log';
    fs.mkdirSync(path.dirname(mergedLogPath), { recursive: true });
    fs.writeFileSync(mergedLogPath, mergedLogs.join('\n\n'), 'utf-8');

    console.log(`   - Merged ${mergedCount} duplicate kanji forms out of the dataset.`);

    // Generate merged ID map for migration
    const mergedMap: Record<string, string> = {};

    // Populate lookup map for sentence tokenizer using MERGED vocab. vocabById
    // lets the matcher tell homographs apart by reading (see disambiguateByReading).
    const vocabById = new Map<string, ReadingVocab>();
    for (const vocab of mergedCandidateVocab.values()) {
        vocabById.set(vocab.id, vocab);
        const kanjiText = vocab.writtenForm.kanji;
        if (!writtenToVocabId.has(kanjiText)) {
            writtenToVocabId.set(kanjiText, []);
        }
        writtenToVocabId.get(kanjiText)!.push(vocab.id);

        for (const altKanji of vocab.writtenForm.alternatives) {
            if (!writtenToVocabId.has(altKanji)) {
                writtenToVocabId.set(altKanji, []);
            }
            writtenToVocabId.get(altKanji)!.push(vocab.id);
        }

        if (vocab.mergedVocabs && vocab.mergedVocabs.length > 1) {
            for (const mv of vocab.mergedVocabs) {
                if (!mv.isBase) {
                    mergedMap[mv.id] = vocab.id;
                }
            }
        }
    }

    fs.writeFileSync(
        path.join(OUTPUT_INDEX_DIR, 'merged-map.json'),
        JSON.stringify(mergedMap, null, 2)
    );

    console.log(`   - Proceeding with ${mergedCandidateVocab.size} unique candidate vocabulary items.`);


    // 3. Process Sentences & Calculate Usage
    console.log('📜 Processing sentences to find usage...');

    // Sort vocab keys by length descending for greedy match
    const sortedVocabKeys = Array.from(writtenToVocabId.keys()).sort((a, b) => b.length - a.length);

    // Map: vocabId -> Use Count
    const vocabUsageCount = new Map<string, number>();

    // Map: vocabId -> Sentence[] (Buffer for final output)
    const vocabSentencesMap = new Map<string, Sentence[]>();

    // Load Indices
    const indicesMap = new Map<string, string>();
    const indicesStream = fs.createReadStream(INPUT_INDICES_FILE);
    const indicesReader = readline.createInterface({ input: indicesStream, crlfDelay: Infinity });
    for await (const line of indicesReader) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        if (parts.length >= 3) {
            indicesMap.set(parts[0], parts[2]);
        }
    }

    // Load Sentences
    const sentencesMap = new Map<string, Sentence>();
    const sentencesStream = fs.createReadStream(INPUT_SENTENCES_FILE);
    const sentencesReader = readline.createInterface({ input: sentencesStream, crlfDelay: Infinity });

    for await (const line of sentencesReader) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        if (parts.length >= 4) {
            const [jpId, jpText, enId, enText] = parts;
            if (!sentencesMap.has(jpId)) {
                sentencesMap.set(jpId, {
                    id: jpId,
                    original: jpText,
                    en: [],
                    indices: indicesMap.get(jpId),
                    vocabIds: []
                });
            }
            const s = sentencesMap.get(jpId)!;
            if (!s.en.some(e => e.id === enId)) {
                s.en.push({ id: enId, text: enText });
            }
        }
    }

    // Tokenize
    let processedSentences = 0;
    const reportInterval = 5000;
    const vocabSet = new Set(writtenToVocabId.keys());

    for (const [_, sentence] of sentencesMap) {
        processedSentences++;
        if (processedSentences % reportInterval === 0) {
            process.stdout.write(`   - Scanned ${processedSentences}/${sentencesMap.size} sentences...\r`);
        }

        const text = sentence.original;

        const extractedMatches = sentenceTokenizer.extractMatches(text, vocabSet);

        const flatMatches: { term: string, match: any }[] = [];
        for (const [term, matchArray] of Object.entries(extractedMatches)) {
            for (const match of matchArray as any[]) {
                flatMatches.push({ term, match });
            }
        }

        flatMatches.sort((a, b) => b.match.length - a.match.length || b.term.length - a.term.length);
        const acceptedMatches: typeof flatMatches = [];

        for (const entry of flatMatches) {
            const { match } = entry;
            const isOverlapping = acceptedMatches.some(accepted => {
                const acceptedEnd = accepted.match.start + accepted.match.length;
                const matchEnd = match.start + match.length;
                return match.start < acceptedEnd && matchEnd > accepted.match.start;
            });
            if (!isOverlapping) acceptedMatches.push(entry);
        }

        const matches: Record<string, { start: number, length: number, reading?: string }[]> = {};
        const matchedVocabIds: string[] = [];

        for (const { term, match } of acceptedMatches) {
            const vocabIds = writtenToVocabId.get(term);
            if (!vocabIds) continue;

            // A written form shared by differently-read homographs (遊ぶ is both
            // あそぶ and the rare すさぶ) must send each occurrence only to the entry
            // actually read that way - the span's reading tells them apart. Without
            // this a すさぶ entry claims a sentence about playing, so its production
            // cloze blanks 遊んでる and grades it correct against a "grow wild" cue.
            const resolvedIds = disambiguateByReading(vocabIds, match.reading, vocabById);

            for (const vId of resolvedIds) {
                if (!matches[vId]) {
                    matches[vId] = [];
                    matchedVocabIds.push(vId);
                }
                matches[vId].push(match);
            }
        }

        // Filter out sentences that matched no vocabulary
        if (matchedVocabIds.length === 0) continue;

        // Save results
        sentence.vocabIds = matchedVocabIds;
        sentence.matches = matches;

        for (const vid of matchedVocabIds) {
            // Increment usage count for filtering
            vocabUsageCount.set(vid, (vocabUsageCount.get(vid) ?? 0) + 1);

            // Store sentence for output (if vocab survives filter)
            if (!vocabSentencesMap.has(vid)) {
                vocabSentencesMap.set(vid, []);
            }
            vocabSentencesMap.get(vid)!.push(sentence);
        }
    }
    console.log(`\n   - Done scanning.`);

    // 4. Filter Vocabulary
    console.log('✂️  Filtering vocabulary...');

    // Sort all candidates by frequency (default sort)
    const sortedCandidates = Array.from(mergedCandidateVocab.values())
        .sort((a, b) => a.frequency.kanjiRank - b.frequency.kanjiRank);

    const FINAL_VOCAB: BuildVocabulary[] = [];

    // Counters
    let keptByFrequency = 0;
    let keptByUsage = 0;
    let keptByJlpt = 0;
    let dropped = 0;

    const limit = BUILD_LIMITS.ENABLED_LIMIT ? BUILD_LIMITS.MAX_VOCABULARY : Number.MAX_SAFE_INTEGER;
    // Actually, user wants "Keep uncommon IF in sentence".
    // We should implement the threshold logic.
    // If we have ENABLED_LIMIT (hard cap), we might just slice. 
    // But let's assume we want the smart filtering.

    for (const vocab of sortedCandidates) {
        // Condition 1: Marked as Common in JMDict
        // (We trust the dictionary's 'common' flag on the primary kanji)
        const isCommon = vocab.isCommon;

        // Condition 2: Used in Sentences
        const usage = vocabUsageCount.get(vocab.id) ?? 0;
        const isUsed = usage > 0;

        // Retention Logic
        if (isCommon) {
            // If hard limit matches, check index? 
            // If we strictly follow limit, we assume sortedCandidates is freq sorted.
            // But we only want to apply limit to the *result*?
            // "only retain uncommon vocabs ... if we find them in sentences"

            // Should we apply a hard MAX cap as well? 
            // If ENABLED_LIMIT is true (e.g. 10000), we stick to that absolute number?
            // Or does "ENABLED_LIMIT" mean "Use dev mode small subset"?
            // Usually it means dev mode subset.

            if (BUILD_LIMITS.ENABLED_LIMIT && FINAL_VOCAB.length >= limit) {
                dropped++;
                continue;
            }

            FINAL_VOCAB.push(vocab);
            keptByFrequency++;
        } else if (isUsed) {
            // It's uncommon, but used in sentences. Keep it!
            if (BUILD_LIMITS.ENABLED_LIMIT && FINAL_VOCAB.length >= limit) {
                dropped++;
                continue;
            }
            FINAL_VOCAB.push(vocab);
            keptByUsage++;
        } else if (vocab.jlptLevel !== undefined) {
            // On a JLPT list: a learner will be taught it whatever JMdict's common flag
            // or the sentence corpus say. This is how する, それ, そこ and とても, whose
            // only kanji (為る, 其れ, 其処, 迚も) are rare, reach the dataset as words
            // learned in kana, like これ already did.
            FINAL_VOCAB.push(vocab);
            keptByJlpt++;
        } else {
            // Uncommon and unused. Drop.
            dropped++;
        }
    }

    console.log(`   - Kept ${keptByFrequency} common words.`);
    console.log(`   - Kept ${keptByUsage} uncommon words (used in sentences).`);
    console.log(`   - Kept ${keptByJlpt} uncommon words (on a JLPT list).`);
    console.log(`   - Dropped ${dropped} words.`);
    console.log(`   - Final Dataset Size: ${FINAL_VOCAB.length} words.`);

    // 4.4 Words formed from a listed word take its level (一緒に from 一緒); see jlpt-derived.ts.
    const finalIds = new Set(FINAL_VOCAB.map(v => v.id));
    for (const [id, { word }] of Object.entries(jlptCorrections.derivedExclude)) {
        if (!finalIds.has(id)) throw new Error(`jlpt-corrections: derivedExclude ${id} (${word}) is not a compiled vocab id; remove it.`);
    }
    const derived = inheritJlptLevels(FINAL_VOCAB, new Set(Object.keys(jlptCorrections.derivedExclude)));
    console.log(`   - ${derived.length} words take the JLPT level of the word they are formed from.`);
    for (const vocab of FINAL_VOCAB) vocab.textbooks?.sort((a, b) => a.book.localeCompare(b.book) || a.lesson - b.lesson);

    // 4.5 Compute components and parents
    console.log('🧩 Computing components and parents...');

    const finalVocabMap = new Map<string, string[]>();
    for (const v of FINAL_VOCAB) {
        const k = v.writtenForm.kanji;
        if (!finalVocabMap.has(k)) finalVocabMap.set(k, []);
        finalVocabMap.get(k)!.push(v.id);
    }
    const finalVocabSetToMatch = new Set(finalVocabMap.keys());

    // Optimize components matching: Map each kanji character to the vocabulary candidates that start with it.
    console.log('   - Indexing for component match...');
    const candidateIndex = new Map<string, typeof FINAL_VOCAB>();
    for (const vocab of FINAL_VOCAB) {
        if (vocab.writtenForm.containedKanji.length === 0) continue;
        const firstChar = vocab.writtenForm.kanji[0];
        if (!candidateIndex.has(firstChar)) candidateIndex.set(firstChar, []);
        candidateIndex.get(firstChar)!.push(vocab);
    }

    let componentProgress = 0;
    for (const vocab of FINAL_VOCAB) {
        componentProgress++;
        if (componentProgress % 5000 === 0) {
            process.stdout.write(`   - Components: ${componentProgress}/${FINAL_VOCAB.length} processed...\r`);
        }

        const targetWord = vocab.writtenForm.kanji;
        const components = new Set<string>();

        // We only need to check candidates that start with a character present in the targetWord.
        const checkedCandidates = new Set<string>(); // avoid checking same candidate twice if it appears in multiple start positions (rare, but possible if index structured differently)

        for (const char of targetWord) {
            const possibleCandidates = candidateIndex.get(char);
            if (!possibleCandidates) continue;

            for (const candidate of possibleCandidates) {
                if (checkedCandidates.has(candidate.id)) continue;
                checkedCandidates.add(candidate.id);

                if (candidate.id === vocab.id) continue;
                const candidateWord = candidate.writtenForm.kanji;

                if (targetWord.includes(candidateWord)) {
                    components.add(candidate.id);
                }
            }
        }

        if (components.size > 0) {
            vocab.components = Array.from(components);
        }
    }
    console.log(`\n   - Done computing components.`);

    // Pass 2: compute parents
    const finalSelectedVocabMap = new Map(FINAL_VOCAB.map(v => [v.id, v]));
    for (const vocab of FINAL_VOCAB) {
        if (vocab.components) {
            for (const componentId of vocab.components) {
                const componentVocab = finalSelectedVocabMap.get(componentId);
                if (componentVocab) {
                    if (!componentVocab.parents) {
                        componentVocab.parents = [];
                    }
                    componentVocab.parents.push(vocab.id);
                }
            }
        }
    }

    // 4.6 Words learned in kana (ここ, not 此処): see decideUsuallyKana.
    console.log('🔤 Deciding which words are learned in kana...');
    const usuallyKanaIds = new Set<string>();
    const kanaRanks = new Map<string, number>();
    for (const vocab of FINAL_VOCAB) {
        const decision = decideUsuallyKana({
            kanji: vocab.writtenForm.kanji,
            reading: vocab.reading.primary,
            readings: [vocab.reading.primary, ...vocab.reading.alternatives],
            firstSenseUk: vocab.senses[0]?.misc.rawTags.includes('uk') ?? false,
            rareKanjiForm: vocab.rareKanjiForm,
        }, jpdbTable);
        if (!decision.usuallyKana) continue;
        usuallyKanaIds.add(vocab.id);
        if (decision.kanaRank !== null) kanaRanks.set(vocab.id, decision.kanaRank);
    }
    const kept = applyUsuallyKanaOverrides(usuallyKanaIds, new Set(FINAL_VOCAB.map(v => v.id)), usuallyKanaOverrides);
    for (const vocab of FINAL_VOCAB) {
        if (!kept.has(vocab.id)) continue;
        vocab.usuallyKana = true;
        // The rank the word is met at is its kana spelling's, which the generic lookup
        // misses when only a katakana or standalone kana row has it (ゴミ, ございます).
        const kanaRank = kanaRanks.get(vocab.id);
        if (kanaRank !== undefined && kanaRank < (vocab.frequency.kanaRank ?? Number.POSITIVE_INFINITY)) {
            vocab.frequency.kanaRank = kanaRank;
        }
    }
    console.log(`   - ${kept.size} words learned in kana (${usuallyKanaIds.size - kept.size} excluded by hand).`);

    // 5. Write Outputs
    console.log('💾 Writing compiled data...');

    // Clean output directories
    if (fs.existsSync(OUTPUT_VOCAB_DIR)) fs.rmSync(OUTPUT_VOCAB_DIR, { recursive: true, force: true });
    if (fs.existsSync(OUTPUT_SENTENCES_DIR)) fs.rmSync(OUTPUT_SENTENCES_DIR, { recursive: true, force: true });
    // Keep index dir structure but maybe clean files? Build script handles specific index files.
    // Ensure directories exist
    fs.mkdirSync(OUTPUT_VOCAB_DIR, { recursive: true });
    fs.mkdirSync(OUTPUT_SENTENCES_DIR, { recursive: true });
    fs.mkdirSync(OUTPUT_INDEX_DIR, { recursive: true });

    // Clean old indices
    if (fs.existsSync(`${OUTPUT_INDEX_DIR}/kklc.json`)) fs.unlinkSync(`${OUTPUT_INDEX_DIR}/kklc.json`);
    if (fs.existsSync(`${OUTPUT_INDEX_DIR}/frequency.json`)) fs.unlinkSync(`${OUTPUT_INDEX_DIR}/frequency.json`);

    // Indices
    const kklcIndex: KKLCIndex = {};
    const frequencyIndex: FrequencyIndex = [];
    const searchIndex: SearchIndex = [];
    const kanjiVocabIndex: Record<string, string[]> = {};
    const kanjiRankById = new Map<string, number>();

    let vocabWritten = 0;
    let sentencesWritten = 0;

    for (const vocab of FINAL_VOCAB) {
        const { kklcStep, ownRank: _ownRank, rareKanjiForm: _rareKanjiForm, sharesHeadword: _sharesHeadword, spoken: _spoken, affixOnly: _affixOnly, ...cleanVocab } = vocab;

        // 1. Write Vocab File
        fs.writeFileSync(
            path.join(OUTPUT_VOCAB_DIR, `${vocab.id}.json`),
            JSON.stringify(cleanVocab, null, 2)
        );
        vocabWritten++;

        // 2. Write Sentences File (if exists)
        const sentences = vocabSentencesMap.get(vocab.id);
        if (sentences && sentences.length > 0) {
            fs.writeFileSync(
                path.join(OUTPUT_SENTENCES_DIR, `${vocab.id}.json`),
                JSON.stringify(sentences, null, 2)
            );
            sentencesWritten++;
        }

        // 3. Update Indexes
        // KKLC: a step is reached by learning kanji, and a word learned in kana
        // teaches none, so the kanji-driven order leaves it out.
        if (!vocab.usuallyKana) {
            if (!kklcIndex[kklcStep]) kklcIndex[kklcStep] = [];
            kklcIndex[kklcStep].push(vocab.id);
        }

        // Frequency (sorted by learningRank below)
        frequencyIndex.push(learningIndexEntry(vocab));

        // Search
        searchIndex.push({
            id: vocab.id,
            w: vocab.writtenForm.kanji,
            r: vocab.reading.primary,
            m: vocab.senses[0]?.glosses.slice(0, 2).join(', ') || '',
            ...(vocab.usuallyKana ? { u: true as const } : {}),
        });

        // Kanji -> Vocab reverse index (for the Kanji Detail Page)
        kanjiRankById.set(vocab.id, vocab.frequency.kanjiRank);
        for (const k of vocab.writtenForm.containedKanji) {
            if (!kanjiVocabIndex[k]) kanjiVocabIndex[k] = [];
            kanjiVocabIndex[k].push(vocab.id);
        }
    }

    // FINAL_VOCAB is in kanji-spelling order; a word learned in kana is met at its
    // kana spelling's rank (ここ is #56, 此処 #10545). Array.sort is stable, so equal
    // ranks keep their order and the file stays reproducible.
    const rankById = new Map(FINAL_VOCAB.map(v => [v.id, learningRank(v)]));
    frequencyIndex.sort((a, b) => rankById.get(a.id)! - rankById.get(b.id)!);

    // Sort each kanji's vocab list by frequency (most common first) so
    // capped/expandable UI lists surface common words before rare ones.
    for (const ids of Object.values(kanjiVocabIndex)) {
        ids.sort((a, b) => (kanjiRankById.get(a) ?? Infinity) - (kanjiRankById.get(b) ?? Infinity));
    }

    fs.writeFileSync(
        path.join(OUTPUT_INDEX_DIR, 'kklc.json'),
        JSON.stringify(kklcIndex, null, 2)
    );
    fs.writeFileSync(
        path.join(OUTPUT_INDEX_DIR, 'frequency.json'),
        JSON.stringify(frequencyIndex, null, 2)
    );
    fs.writeFileSync(
        path.join(OUTPUT_INDEX_DIR, 'search.json'),
        JSON.stringify(searchIndex)
    );
    fs.writeFileSync(
        path.join(OUTPUT_INDEX_DIR, 'kanji-vocab.json'),
        JSON.stringify(kanjiVocabIndex, null, 2)
    );

    console.log(`✅ Build Complete!`);
    console.log(`   - Vocab Files: ${vocabWritten}`);
    console.log(`   - Sentence Files: ${sentencesWritten}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
