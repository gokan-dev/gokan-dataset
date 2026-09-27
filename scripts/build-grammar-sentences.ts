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
import { compileFormation, matchRule, toMorphToken, type MiningRule } from '../src/utils/formationMiner';

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

function isHighPrecision(rule: MiningRule): boolean {
    if (rule.elements.some(e => e.kind !== 'lit')) return true; // morphological - proven precise
    const a = rule.anchor;
    if (OVER_MATCHER_3.has(a)) return false;
    if (a.length >= 3) return true;
    return a.length === 2 && DISTINCTIVE_2.has(a);
}

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

    // Eligible points: compiled construction points with a high-precision rule.
    const points = fs.readdirSync(POINTS_DIR)
        .map(f => JSON.parse(fs.readFileSync(path.join(POINTS_DIR, f), 'utf-8')) as GrammarPoint)
        .filter(p => p.kind !== 'inflection' && !p.variantOf && p.formation);
    const eligible: { point: GrammarPoint; rule: MiningRule }[] = [];
    let deferredCount = 0;
    for (const point of points) {
        const rule = compileFormation(point.formation, point.title);
        if (!rule) continue;
        if (isHighPrecision(rule)) eligible.push({ point, rule });
        else deferredCount++;
    }
    console.log(`  ✓ ${eligible.length} eligible points (${eligible.filter(e => e.rule.elements.some(x => x.kind !== 'lit')).length} morphological); ${deferredCount} deferred as low-precision`);

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

    // Scan: reservoir-sample matchRule hits per point (bounded work).
    const rnd = mulberry32(73);
    const hits = new Map<string, string[]>();  // pointId -> sentence ids (reservoir)
    const seen = new Map<string, number>();      // pointId -> total hits seen
    for (const e of eligible) { hits.set(e.point.id, []); seen.set(e.point.id, 0); }
    let n = 0;
    for (const [id, s] of sentences) {
        let toks: ReturnType<typeof toMorphToken>[] | null = null;
        for (const e of eligible) {
            if (!s.original.includes(e.rule.anchor)) continue;
            if (!toks) toks = tokenizer.tokenize(s.original).map(toMorphToken);
            if (!matchRule(toks, e.rule)) continue;
            const total = seen.get(e.point.id)! + 1;
            seen.set(e.point.id, total);
            const pool = hits.get(e.point.id)!;
            if (pool.length < PRE_CAP) pool.push(id);
            else { const j = Math.floor(rnd() * total); if (j < PRE_CAP) pool[j] = id; } // reservoir
        }
        if (++n % 25000 === 0) console.log(`  ...scanned ${n}/${sentences.size}`);
    }

    // Verify + place blanks, cap to CAP.
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    let emittedPoints = 0, emittedExamples = 0;
    const poolSizes: number[] = [];
    for (const e of eligible) {
        const examples: GrammarExample[] = [];
        for (const sid of hits.get(e.point.id)!) {
            if (examples.length >= CAP) break;
            const s = sentences.get(sid)!;
            const { words, patternWordIndices } = buildExampleWords(
                tokenizer, sentenceTokenizer, vocabSet, lookup, s.original, e.point.formation, e.point.title);
            if (patternWordIndices.length === 0) continue; // pattern couldn't be located - drop
            examples.push({ jp: s.original, romaji: '', en: s.en, words, patternWordIndices });
        }
        if (examples.length === 0) continue;
        fs.writeFileSync(path.join(OUTPUT_DIR, `${e.point.id}.json`), JSON.stringify(examples));
        emittedPoints++; emittedExamples += examples.length; poolSizes.push(examples.length);
    }
    poolSizes.sort((a, b) => a - b);
    const median = poolSizes[Math.floor(poolSizes.length / 2)] ?? 0;
    console.log(`\n✅ Mined ${emittedExamples} examples across ${emittedPoints} points (median pool ${median}, max ${poolSizes[poolSizes.length - 1] ?? 0})`);
    console.log(`   full-pool (=${CAP}): ${poolSizes.filter(x => x >= CAP).length}  |  >=10: ${poolSizes.filter(x => x >= 10).length}  |  <10: ${poolSizes.filter(x => x < 10).length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
