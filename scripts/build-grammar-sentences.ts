/**
 * Mines the vocab sentence corpus for real sentences that use each grammar
 * point's construction (gokan-srs#73), so the grammar quiz can pick the sentence
 * that best exercises the vocabulary a given learner is currently trying to
 * PRODUCE, instead of always drilling the same 3-5 curated examples.
 *
 * Two matchers compose:
 *   1. `formationMiner` (morphology-aware) decides IF a sentence uses the
 *      construction, over 227k arbitrary sentences where precision is everything
 *      (a literal てある matches である/がある; the miner's POS/conjugation-form
 *      rules do not). See src/utils/formationMiner.ts.
 *   2. `buildExampleWords` (shared with build-grammar.ts) then tokenizes the
 *      accepted sentence and runs `locatePattern` to place the blank precisely,
 *      the SAME way curated examples are processed - so a mined GrammarExample is
 *      indistinguishable in shape from a hand-authored one, and a sentence whose
 *      pattern cannot be located is dropped (a second precision gate).
 *
 * Scope (issue #73, first build): HIGH-PRECISION points only - every
 * morphological rule, plus distinctive multi-char literals. The ~function-word
 * literal over-matchers (こと/なら/だろう/まで/という/…) are deferred to a later
 * morphology pass rather than shipped noisy. `augment` model: these pools are
 * used for productivity-driven REVIEWS; the curated examples still front each
 * point's intro/first review and are the fallback when a point has no pool.
 *
 * Output: compiled/grammar/mined/{pointId}.json = GrammarExample[] (same shape
 * as point.examples). Synced into the app like every other grammar artifact.
 *
 * Run (needs build:data + build:grammar first): bun scripts/build-grammar-sentences.ts
 */
import fs from 'fs';
import path from 'path';
import kuromoji from 'kuromoji';
import type { GrammarExample, GrammarPoint } from '../src/models/grammar.model';
import type { SearchIndex } from '../src/models/index.model';
import { SentenceTokenizer } from '../src/utils/tokenizer';
import { buildKanaWritableIds, buildVocabLookup, buildExampleWords } from './build-grammar';
import {
    blankFitsRule, blankOpensClause, compileFormation, emptyMarkerLexicon, findMatch, fitsMarkerLexicon, isExampleSized, isPredicateSlot,
    leaksAnswer, learnMarker, opensClause, toMorphToken, type MarkerLexicon, type MiningRule, type RuleMatch,
} from '../src/utils/formationMiner';

const SEARCH_INDEX_PATH = './compiled/index/search.json';
const POINTS_DIR = './compiled/grammar/points';
const SENTENCES_DIR = './compiled/sentences';
const OUTPUT_DIR = './compiled/grammar/mined';

/** Per-point pool cap: enough that dropping mastered vocab shifts the productivity argmax, bounded enough to load in one fetch. */
const CAP = 60;
/** matchRule hits reservoir-sampled to this before the (costlier) locate-verify pass, to bound work on very common patterns. */
const PRE_CAP = 200;

// --- precision gate --------------------------------------------------------
/** 3+ char literals that are still ubiquitous function words / quotatives - deferred. */
const OVER_MATCHER_3 = new Set(['という', 'ところ', 'だろう', 'でしょう', 'します', 'ように', 'なんて', 'なんか', 'について']);
/** 2-char literals that ARE distinctive grammar markers - kept despite the length floor. */
const DISTINCTIVE_2 = new Set(['はず', 'わけ', 'さえ', 'しか', 'だけ', 'ため', 'のに', 'ので', 'きり', 'つつ', 'ずに', 'こそ', 'すら', 'ほか']);

/**
 * Variants excluded by hand, because no rule can tell their grammatical sense
 * from a far more common literal one, and even the point's curated examples
 * tokenize them identically. An empty pool is better than a wrong one: the quiz
 * falls back to the curated examples. Value: excluded anchors, or '*' for all.
 */
const EXCLUDED_VARIANTS: Record<string, string[] | '*'> = {
    // "Noun + の上に" / "の上は" is overwhelmingly the literal "on top of" (テーブルの上に).
    'n2-176': ['の上に'],
    'n2-177': ['の上は'],
    // につけ ("whenever") vs に + 付ける (身につける, 職につける): same tokens, same tags.
    'n2-113': '*',
};

const isExcluded = (pointId: string, rule: MiningRule) => {
    const excluded = EXCLUDED_VARIANTS[pointId];
    return excluded === '*' || (excluded?.includes(rule.anchor) ?? false);
};

export function isHighPrecision(rule: MiningRule): boolean {
    if (rule.elements.some(e => e.kind !== 'lit')) return true; // morphological - proven precise
    const a = rule.anchor;
    if (OVER_MATCHER_3.has(a)) return false;
    if (a.length >= 3) return true;
    if (a.length !== 2) return false;
    // A 2-char marker is precise when it is a distinctive grammar word, or when
    // the formation pins the word before it to a verb or adjective: that is what
    // separates reason から (行くから) from source から (駅から). A NOUN slot does
    // not qualify, since Noun + particle is exactly the classic over-match.
    return DISTINCTIVE_2.has(a) || (isPredicateSlot(rule.leading) && rule.leading !== 'naAdjective');
}

/** FNV-1a: a stable 32-bit seed from a point id. */
const seedOf = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; };
const mulberry32 = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

async function main() {
    console.log('⛏️  Mining corpus sentences for grammar points...');
    const searchIndex: SearchIndex = JSON.parse(fs.readFileSync(SEARCH_INDEX_PATH, 'utf-8'));
    const kanaWritableIds = buildKanaWritableIds(searchIndex);
    const lookup = buildVocabLookup(searchIndex, kanaWritableIds);
    const vocabSet = new Set(lookup.byWrittenForm.keys());

    const tokenizer = await new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>((resolve, reject) =>
        kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => err ? reject(err) : resolve(t)));
    const sentenceTokenizer = new SentenceTokenizer(tokenizer);

    // Eligible points: compiled construction points with at least one
    // high-precision variant. Only those variants are mined.
    const points = fs.readdirSync(POINTS_DIR)
        .map(f => JSON.parse(fs.readFileSync(path.join(POINTS_DIR, f), 'utf-8')) as GrammarPoint)
        .filter(p => p.kind !== 'inflection' && !p.variantOf && p.formation);
    const eligible: { point: GrammarPoint; rules: MiningRule[] }[] = [];
    let deferredCount = 0;
    for (const point of points) {
        const rules = compileFormation(point.formation, point.title).filter(r => isHighPrecision(r) && !isExcluded(point.id, r));
        if (rules.length > 0) eligible.push({ point, rules });
        else deferredCount++;
    }
    const variantCount = eligible.reduce((n, e) => n + e.rules.length, 0);
    console.log(`  ✓ ${eligible.length} eligible points, ${variantCount} mined variants; ${deferredCount} points deferred as low-precision or unminable`);

    // Marker lexicons: how each point's marker morphemes are tokenized and tagged
    // in its own hand-picked examples. A mined occurrence tagged or segmented
    // differently is a homograph (the verb やら, もの+の in 甘いものの量, the
    // compound verb 出かけ) and is rejected; see fitsMarkerLexicon. Literal rules
    // only: morphological ones already pin their tokens down.
    const lexicons = new Map<string, MarkerLexicon>();
    for (const e of eligible) {
        const lexicon: MarkerLexicon = emptyMarkerLexicon();
        const curatedTokens = e.point.examples.map(ex => tokenizer.tokenize(ex.jp).map(toMorphToken));
        for (const rule of e.rules) {
            if (rule.elements.some(el => el.kind !== 'lit')) continue;
            for (const toks of curatedTokens) {
                const m = findMatch(toks, rule);
                if (m) learnMarker(lexicon, toks, m);
            }
        }
        lexicons.set(e.point.id, lexicon);
    }
    console.log(`  ✓ ${[...lexicons.values()].filter(l => l.tags.size > 0).length} points carry a curated marker lexicon`);

    // Unique sentences across all SentenceSets.
    const sentences = new Map<string, { original: string; en: string }>();
    for (const f of fs.readdirSync(SENTENCES_DIR)) {
        const arr = JSON.parse(fs.readFileSync(path.join(SENTENCES_DIR, f), 'utf-8'));
        for (const s of (Array.isArray(arr) ? arr : arr.sentences ?? [])) {
            if (!s?.id || sentences.has(s.id)) continue;
            const en = s.en?.[0]?.text;
            if (!en) continue; // can't prompt a translation quiz without a translation
            sentences.set(s.id, { original: s.original, en });
        }
    }
    console.log(`  ✓ ${sentences.size} unique translated sentences`);

    // Scan: reservoir-sample matchRule hits per point (bounded work). Each point
    // draws from its OWN random stream, seeded on its id: with one shared stream,
    // adding or dropping any eligible point shifted the draws of every point
    // scanned after it, reshuffling ~100 unrelated pools (and the sentences
    // learners had been seeing) on a change that never touched them.
    const rngs = new Map(eligible.map(e => [e.point.id, mulberry32(seedOf(e.point.id))]));
    type Hit = { id: string; rule: MiningRule };
    const hits = new Map<string, Hit[]>();     // pointId -> matched sentences (reservoir), with the variant that matched
    const seen = new Map<string, number>();      // pointId -> total hits seen
    for (const e of eligible) { hits.set(e.point.id, []); seen.set(e.point.id, 0); }
    let n = 0;
    for (const [id, s] of sentences) {
        // Size is a property of the sentence alone: skip transcripts before tokenizing.
        if (!isExampleSized(s.original)) { n++; continue; }
        let toks: ReturnType<typeof toMorphToken>[] | null = null;
        for (const e of eligible) {
            let matched: MiningRule | null = null;
            for (const rule of e.rules) {
                if (!s.original.includes(rule.anchor)) continue;
                if (!toks) toks = tokenizer.tokenize(s.original).map(toMorphToken);
                const lexicon = lexicons.get(e.point.id)!;
                const t = toks;
                const literal = rule.elements.every(el => el.kind === 'lit');
                const sentenceInitial = e.point.slot === 'sentence-initial';
                const accept = (m: RuleMatch) =>
                    (!literal || fitsMarkerLexicon(lexicon, t, m)) && (!sentenceInitial || opensClause(t, m));
                if (findMatch(t, rule, accept)) { matched = rule; break; }
            }
            if (!matched) continue;
            const total = seen.get(e.point.id)! + 1;
            seen.set(e.point.id, total);
            const pool = hits.get(e.point.id)!;
            const hit = { id, rule: matched };
            if (pool.length < PRE_CAP) pool.push(hit);
            else { const j = Math.floor(rngs.get(e.point.id)!() * total); if (j < PRE_CAP) pool[j] = hit; } // reservoir
        }
        if (++n % 25000 === 0) console.log(`  ...scanned ${n}/${sentences.size}`);
    }

    // Verify + place blanks, cap to CAP.
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    let emittedPoints = 0, emittedExamples = 0;
    const poolSizes: number[] = [];
    const dropped = { unlocated: 0, blankOffRule: 0, leak: 0 };
    for (const e of eligible) {
        const examples: GrammarExample[] = [];
        for (const hit of hits.get(e.point.id)!) {
            if (examples.length >= CAP) break;
            const s = sentences.get(hit.id)!;
            const { words, patternWordIndices } = buildExampleWords(
                tokenizer, sentenceTokenizer, vocabSet, lookup, s.original, e.point.formation, e.point.title);
            if (patternWordIndices.length === 0) { dropped.unlocated++; continue; } // pattern couldn't be located - drop
            const example: GrammarExample = { jp: s.original, romaji: '', en: s.en, words, patternWordIndices };
            // The locator runs separately from the miner and can blank a different
            // occurrence (a sentence-initial だから) than the one the rule accepted.
            if (!blankFitsRule(example, hit.rule)) { dropped.blankOffRule++; continue; }
            if (e.point.slot === 'sentence-initial' && !blankOpensClause(example)) { dropped.blankOffRule++; continue; }
            if (leaksAnswer(example)) { dropped.leak++; continue; }
            examples.push(example);
        }
        if (examples.length === 0) continue;
        fs.writeFileSync(path.join(OUTPUT_DIR, `${e.point.id}.json`), JSON.stringify(examples));
        emittedPoints++; emittedExamples += examples.length; poolSizes.push(examples.length);
    }
    poolSizes.sort((a, b) => a - b);
    const median = poolSizes[Math.floor(poolSizes.length / 2)] ?? 0;
    console.log(`\n✅ Mined ${emittedExamples} examples across ${emittedPoints} points (median pool ${median}, max ${poolSizes[poolSizes.length - 1] ?? 0})`);
    console.log(`   full-pool (=${CAP}): ${poolSizes.filter(x => x >= CAP).length}  |  >=10: ${poolSizes.filter(x => x >= 10).length}  |  <10: ${poolSizes.filter(x => x < 10).length}`);
    console.log(`   dropped after matching: ${dropped.unlocated} unlocated, ${dropped.blankOffRule} blank off-rule, ${dropped.leak} answer leaks`);
}
if (import.meta.main) main().catch(e => { console.error(e); process.exit(1); });
