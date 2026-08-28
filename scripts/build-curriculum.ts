import fs from 'fs';
import path from 'path';
import type { GrammarChapter, GrammarPoint, GrammarTeachingOrder } from '../src/models/grammar.model';

/**
 * Compiles the authored curriculum spine (data/curriculum/chapters.json) into
 * `compiled/grammar/index/teaching-order.json` - the sequence in which grammar
 * points should be INTRODUCED, replacing the upstream files' alphabetical order
 * for that purpose. See the grammar-curriculum issue.
 *
 * Runs after build-grammar.ts, because it reads the compiled points to know
 * which ids survived deduplication and what each one's family/axis is.
 *
 * Two tiers, deliberately:
 *
 *  - N5 and N4 are HAND-SEQUENCED in chapters.json, because at those levels the
 *    points genuinely depend on each other (`Verb た ことがある` is unteachable
 *    before the た-form) and the upstream alphabetical order actively inverts
 *    that - it puts seven near-synonymous connectives first and the case
 *    particles at #40+.
 *
 *  - N3/N2/N1 chapters are GENERATED here by clustering the remaining points by
 *    near-synonym family, then sweeping up whatever has no family into
 *    level-ordered "further patterns" chapters. Above N3 the points are largely
 *    independent idiomatic expressions with no dependency chain, so family
 *    clustering (which is what enables the differentiator to be taught) buys
 *    most of the available benefit and hand-sequencing buys little. This tier is
 *    intentionally coarser and is the obvious place to improve later.
 *
 * The register-absorb rule is the interesting part. A chapter may declare
 * `absorbRegisterFamilies`, which pulls in every `axis: 'register'` member of
 * those families FROM ANY LEVEL. That is what lets だが (N2) be taught beside
 * でも (N5): a register sibling adds no new structure, so gating it behind three
 * JLPT levels buys nothing, while teaching it next to its siblings is the only
 * way the register ladder is ever visible. Members with `axis: 'constraint'`
 * are deliberately NOT absorbed - those add a semantic restriction that can be
 * got wrong, and stay gated at their own level.
 *
 * Run: `bun run build:curriculum` (chained from `bun run build:grammar`).
 */

const POINTS_DIR = './compiled/grammar/points';
const OUTPUT_PATH = './compiled/grammar/index/teaching-order.json';
const SPINE_PATH = './data/curriculum/chapters.json';

/** Points with no family, grouped into chapters of at most this many. */
const FILL_CHAPTER_SIZE = 20;
/** A generated family chapter needs at least this many remaining members to be worth its own chapter. */
const MIN_FAMILY_CHAPTER = 2;

/**
 * How many JLPT levels a register sibling may be pulled forward.
 *
 * Guardrails over an imperfect signal, not pedagogy for its own sake. The
 * `axis` values are seeded from the wording of each point's `usageNote`, and
 * that heuristic over-assigns `register` to anything whose note happens to
 * mention only formality - which catches genuinely archaic, structurally
 * different forms. `Verbる べからざる Noun` (N1) reads as "formal, literary"
 * and so classified as a register sibling of なければならない, but it is an
 * archaic noun-modifying form, not a politer way to say "must", and has no
 * business in an N4 chapter.
 *
 * 3 is the smallest cap that still allows the case the whole rule exists for:
 * だが (N2) taught beside でも (N5). Literary registers get a tighter cap,
 * because "formal, literary" is exactly where the heuristic is least reliable
 * and where a mistake is most jarring for an early learner.
 *
 * These caps should shrink to irrelevance once `axis` has had a hand pass -
 * see the grammar-axis issue.
 */
const MAX_ABSORB_LEVEL_DISTANCE = 3;
const MAX_ABSORB_LEVEL_DISTANCE_LITERARY = 2;

interface AuthoredChapter {
    id: string;
    jlptLevel: number;
    title: string;
    summary: string;
    points: string[];
    /**
     * Family ids whose `axis: 'register'` members should be folded into this
     * chapter regardless of their own JLPT level - see the header comment.
     */
    absorbRegisterFamilies?: string[];
}

const LEVEL_NAMES: Record<number, string> = { 5: 'N5', 4: 'N4', 3: 'N3', 2: 'N2', 1: 'N1' };

function loadPoints(): Map<string, GrammarPoint> {
    if (!fs.existsSync(POINTS_DIR)) {
        throw new Error(`${POINTS_DIR} not found. Run 'bun run build:grammar' first.`);
    }
    const points = new Map<string, GrammarPoint>();
    for (const file of fs.readdirSync(POINTS_DIR)) {
        if (!file.endsWith('.json')) continue;
        const point: GrammarPoint = JSON.parse(fs.readFileSync(path.join(POINTS_DIR, file), 'utf-8'));
        points.set(point.id, point);
    }
    return points;
}

function main() {
    console.log('🗂️  Building grammar teaching order...');

    const allPoints = loadPoints();

    // Realization variants are excluded from the order: the canonical member
    // teaches the rule and the quiz rotates through the realizations against one
    // SRS entry, so introducing each separately is the redundancy this removes
    // (the どこにも chapter was six points for one rule). They stay in
    // compiled/grammar/points/ and remain browsable.
    const points = new Map([...allPoints].filter(([, p]) => !p.variantOf));
    const variantCount = allPoints.size - points.size;
    const spine: { chapters: AuthoredChapter[] } = JSON.parse(fs.readFileSync(SPINE_PATH, 'utf-8'));

    const chapters: GrammarChapter[] = [];
    const placed = new Map<string, string>(); // point id -> chapter id that claimed it
    let absorbedTotal = 0;
    const skippedTooFar: string[] = [];

    const claim = (id: string, chapterId: string) => {
        const existing = placed.get(id);
        if (existing) {
            throw new Error(`${SPINE_PATH}: point "${id}" is claimed by both "${existing}" and "${chapterId}".`);
        }
        placed.set(id, chapterId);
    };

    // --- Tier 1: the authored N5/N4 spine ------------------------------------
    // Two passes on purpose. Every explicitly-listed point is claimed first, so
    // an absorb directive can never steal a point that another chapter names
    // outright - e.g. the `giving` family's register members are absorbed into
    // n5-c20, but n4-c04 teaches the honorific giving verbs explicitly and must
    // keep them.
    const members = new Map<string, string[]>();

    for (const authored of spine.chapters) {
        members.set(authored.id, []);
        for (const id of authored.points) {
            // A spine entry that is now a realization variant is silently skipped:
            // its canonical carries the chapter slot. Authored before variants
            // existed, and re-listing every group by hand would just duplicate
            // variants.json.
            if (allPoints.get(id)?.variantOf) continue;
            if (!points.has(id)) {
                throw new Error(
                    `${SPINE_PATH}: chapter "${authored.id}" lists "${id}", which is not a compiled grammar point ` +
                    `(dropped as a duplicate, or a typo).`
                );
            }
            claim(id, authored.id);
            members.get(authored.id)!.push(id);
        }
    }

    for (const authored of spine.chapters) {
        // Register siblings from any level, appended after the chapter's own
        // points so the learner meets the base pattern before its variants.
        for (const familyId of authored.absorbRegisterFamilies ?? []) {
            const siblings = [...points.values()]
                .filter(p => p.family?.id === familyId && p.family.axis === 'register' && !placed.has(p.id))
                .filter(p => {
                    // jlptLevel counts DOWN with difficulty (5 = N5), so a
                    // harder sibling has the smaller number.
                    const distance = authored.jlptLevel - p.jlptLevel;
                    if (distance <= 0) return true;
                    const cap = p.formalityLevel === 'very-formal-literary'
                        ? MAX_ABSORB_LEVEL_DISTANCE_LITERARY
                        : MAX_ABSORB_LEVEL_DISTANCE;
                    if (distance > cap) {
                        skippedTooFar.push(`${p.id} (N${p.jlptLevel}, ${p.formalityLevel ?? 'no register'}) -> ${authored.id} (N${authored.jlptLevel})`);
                        return false;
                    }
                    return true;
                })
                // Easiest first (jlptLevel 5 = N5), then by id for determinism.
                .sort((a, b) => b.jlptLevel - a.jlptLevel || a.id.localeCompare(b.id));

            for (const sibling of siblings) {
                claim(sibling.id, authored.id);
                members.get(authored.id)!.push(sibling.id);
                if (sibling.jlptLevel < authored.jlptLevel) absorbedTotal++;
            }
        }
    }

    for (const authored of spine.chapters) {
        chapters.push({
            id: authored.id,
            title: authored.title,
            summary: authored.summary,
            jlptLevel: authored.jlptLevel,
            points: members.get(authored.id)!,
        });
    }

    // --- Tier 2: generated chapters for whatever is left, easiest level first -
    for (const level of [5, 4, 3, 2, 1]) {
        const remaining = [...points.values()]
            .filter(p => p.jlptLevel === level && !placed.has(p.id))
            .sort((a, b) => a.id.localeCompare(b.id));
        if (remaining.length === 0) continue;

        // Family clusters first - grouping near-synonyms is what makes the
        // differentiator teachable, which is the whole point of clustering.
        const byFamily = new Map<string, GrammarPoint[]>();
        for (const point of remaining) {
            if (!point.family) continue;
            const bucket = byFamily.get(point.family.id) ?? [];
            bucket.push(point);
            byFamily.set(point.family.id, bucket);
        }

        const familyIds = [...byFamily.keys()].sort();
        for (const familyId of familyIds) {
            const members = byFamily.get(familyId)!;
            if (members.length < MIN_FAMILY_CHAPTER) continue;
            const id = `${LEVEL_NAMES[level].toLowerCase()}-fam-${familyId}`;
            for (const member of members) claim(member.id, id);
            chapters.push({
                id,
                title: members[0].family!.name,
                summary: `${members.length} ways to express this at ${LEVEL_NAMES[level]}. What separates them is in each point's usage note - read that before drilling them, or they blur together.`,
                jlptLevel: level,
                points: members.map(m => m.id),
            });
        }

        // Then everything with no family (or a family too small for its own
        // chapter), in source order, chunked into study-sized chapters. This
        // tier is not sequenced - see the header comment.
        const leftovers = remaining.filter(p => !placed.has(p.id));
        for (let i = 0; i < leftovers.length; i += FILL_CHAPTER_SIZE) {
            const chunk = leftovers.slice(i, i + FILL_CHAPTER_SIZE);
            const part = Math.floor(i / FILL_CHAPTER_SIZE) + 1;
            const total = Math.ceil(leftovers.length / FILL_CHAPTER_SIZE);
            const id = `${LEVEL_NAMES[level].toLowerCase()}-more-${String(part).padStart(2, '0')}`;
            for (const point of chunk) claim(point.id, id);
            chapters.push({
                id,
                title: `Further ${LEVEL_NAMES[level]} patterns (${part} of ${total})`,
                summary: `Independent ${LEVEL_NAMES[level]} patterns with no close synonym in the set. Not sequenced against each other - order here carries no pedagogical claim.`,
                jlptLevel: level,
                points: chunk.map(p => p.id),
            });
        }
    }

    // --- Coverage: every surviving point in exactly one chapter --------------
    // A point missing from the order would silently never be introduced, which
    // is invisible at runtime - so this is a hard failure, not a warning.
    // Coverage is asserted over non-variant points only; a variant is
    // deliberately absent from the order.
    const misplacedVariants = [...allPoints.values()].filter(p => p.variantOf && placed.has(p.id)).map(p => p.id);
    if (misplacedVariants.length > 0) {
        throw new Error(
            `${misplacedVariants.length} realization variant(s) were placed in a chapter: ${misplacedVariants.join(', ')}. ` +
            `Only the canonical member belongs in the introduction order.`
        );
    }

    const unplaced = [...points.keys()].filter(id => !placed.has(id)).sort();
    if (unplaced.length > 0) {
        throw new Error(
            `${unplaced.length} compiled grammar point(s) are in no chapter: ${unplaced.join(', ')}`
        );
    }

    const order = chapters.flatMap(c => c.points);
    if (order.length !== points.size) {
        throw new Error(`Teaching order has ${order.length} entries for ${points.size} points - duplicated somewhere.`);
    }

    const teachingOrder: GrammarTeachingOrder = { order, chapters };
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(teachingOrder));

    const authoredCount = spine.chapters.length;
    console.log(`✅ Teaching order written to ${OUTPUT_PATH}`);
    console.log(`   - Chapters: ${chapters.length} (${authoredCount} hand-authored N5/N4, ${chapters.length - authoredCount} generated N3-N1)`);
    console.log(`   - Points ordered: ${order.length}/${points.size}  (${variantCount} realization variants excluded)`);
    console.log(`   - Register siblings pulled forward from a harder level: ${absorbedTotal}`);
    if (skippedTooFar.length > 0) {
        // Visible, not silent: each of these is a point the axis heuristic called
        // a register sibling but that sits too many levels away to pull forward.
        // Every line is a candidate for a hand correction to `axis`.
        console.log(`   - Register siblings left at their own level (too far to pull forward): ${skippedTooFar.length}`);
        skippedTooFar.forEach(s => console.log(`       ${s}`));
    }
    const sizes = chapters.map(c => c.points.length);
    console.log(`   - Chapter size: min ${Math.min(...sizes)}, max ${Math.max(...sizes)}, median ${sizes.slice().sort((a, b) => a - b)[Math.floor(sizes.length / 2)]}`);
}

if (import.meta.main) {
    try {
        main();
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
}
