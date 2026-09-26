import fs from 'fs';
import path from 'path';
import type { GrammarChapter, GrammarContrastIndex, GrammarPoint, GrammarTeachingOrder } from '../src/models/grammar.model';

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
 *    near-synonym family, then placing whatever has no family into the authored
 *    THEMES (data/curriculum/themes.json). Above N3 the points are largely
 *    independent idiomatic expressions with no dependency chain, so family
 *    clustering (which is what enables the differentiator to be taught) buys
 *    most of the available benefit and hand-sequencing buys little. The themes
 *    are the coarser second half of that: they do not sequence the points
 *    against each other, they only guarantee a chapter has a subject.
 *
 * Themes replaced an alphabetical `FILL_CHAPTER_SIZE` dump that put 42% of the
 * dataset into 18 buckets of 20 named "Further N2 patterns (3 of 5)" - a bucket
 * held にほかならない, ということ, "whenever", "before" and "based-on" side by
 * side for no reason other than adjacent ids. Anything still unthemed after a
 * dataset rebuild falls back to that bucketing and is listed by name at the end
 * of the run, so a newly-added point is visible rather than silently dumped.
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
const THEMES_PATH = './data/curriculum/themes.json';
const CONTRASTS_PATH = './compiled/grammar/index/contrasts.json';

/** Unthemed points, grouped into fallback chapters of at most this many. */
const FILL_CHAPTER_SIZE = 20;
/** A generated family chapter needs at least this many remaining members to be worth its own chapter. */
const MIN_FAMILY_CHAPTER = 2;

/**
 * The absorb-vs-level-gate rule for an N3-N1 family (the grammar-curriculum
 * issue, section 3). A family spread across levels is taught either as ONE
 * chapter holding the whole ladder, or as one chapter per level.
 *
 * Absorbing is pedagogically ideal - the register ladder is only ever visible
 * whole - but a large family absorbed becomes an unstudiable chapter
 * (concession is 11 forms). So: absorb a ladder of at most this many members,
 * level-gate anything larger, and let the family page carry the full ladder for
 * the level-gated ones.
 *
 * Only a PURE register ladder is eligible. A family with any `constraint`
 * member adds a semantic restriction that can be got wrong, and an escalation
 * ladder of those is exactly what level-gating is for - so one constraint
 * member disqualifies the whole family, regardless of size. The count is over
 * the whole family, not just its register members: splitting a mixed family
 * into an absorbed register half and a level-gated constraint half fragments it
 * worse than either rule alone.
 */
const LADDER_ABSORB_MAX = 6;

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

/**
 * One authored thematic chapter for the N3-N1 points that have no family, from
 * data/curriculum/themes.json. Same shape as an authored chapter minus the
 * absorb directive (a themed point has no family to absorb siblings from).
 *
 * A theme lists every point it WANTS; the build intersects that with what is
 * actually still unplaced, because a point named here can later gain a family
 * in formality.json and get claimed by a family chapter instead. That is a
 * warning, not an error - the family chapter is the better home, and forcing
 * every formality.json edit to be mirrored here by hand would just be a second
 * copy of the same membership.
 */
interface AuthoredTheme {
    id: string;
    jlptLevel: number;
    title: string;
    summary: string;
    points: string[];
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

/**
 * Stamp each authored contrast lesson with the chapter its lesson can first be
 * taught in, and enforce the one invariant a contrast lesson has to satisfy:
 * a case teaches the learner to reach for `focus` INSTEAD OF its `vs` siblings,
 * so `focus` may never be introduced before them. If it were, the lesson would
 * fire contrasting a word the learner has just met against several they have
 * not, which is the abstract-before-the-fact failure the lesson exists to avoid.
 *
 * Runs here rather than in build-grammar.ts (where the rest of the contrast
 * validation lives) because the teaching order is only known at this step.
 *
 * See GrammarContrastLesson.taughtInChapterId for why a lesson is allowed to span
 * chapters at all.
 */
function anchorLessons(
    order: string[],
    placed: Map<string, string>,
): { crossChapter: number; anchoredLessons: number } {
    if (!fs.existsSync(CONTRASTS_PATH)) return { crossChapter: 0, anchoredLessons: 0 };

    const contrasts: GrammarContrastIndex = JSON.parse(fs.readFileSync(CONTRASTS_PATH, 'utf-8'));
    const position = new Map(order.map((id, i) => [id, i]));
    let crossChapter = 0;
    let anchoredLessons = 0;

    for (const [familyId, family] of Object.entries(contrasts)) {
        for (const lesson of family.lessons ?? []) {
            for (const case_ of lesson.cases) {
                const focusAt = position.get(case_.focus);
                if (focusAt === undefined) {
                    throw new Error(`contrasts.json: family "${familyId}" lesson "${lesson.id}" teaches "${case_.focus}", which is in no chapter (a realization variant is never introduced on its own).`);
                }
                for (const sibling of case_.vs) {
                    const siblingAt = position.get(sibling);
                    if (siblingAt === undefined) {
                        throw new Error(`contrasts.json: family "${familyId}" lesson "${lesson.id}" contrasts against "${sibling}", which is in no chapter.`);
                    }
                    if (siblingAt > focusAt) {
                        throw new Error(
                            `contrasts.json: family "${familyId}" lesson "${lesson.id}" teaches "${case_.focus}" instead of "${sibling}", ` +
                            `but "${sibling}" is introduced LATER in the teaching order. Flip the case's direction, or move one of them.`
                        );
                    }
                }
            }

            const placedMembers = lesson.points.filter(id => position.has(id));
            if (placedMembers.length === 0) continue;
            const anchor = placedMembers.reduce((a, b) => (position.get(a)! >= position.get(b)! ? a : b));
            lesson.taughtInChapterId = placed.get(anchor);
            anchoredLessons++;
            if (new Set(placedMembers.map(id => placed.get(id))).size > 1) crossChapter++;
        }
    }

    fs.writeFileSync(CONTRASTS_PATH, JSON.stringify(contrasts));
    return { crossChapter, anchoredLessons };
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
    const themes: { themes: AuthoredTheme[] } = fs.existsSync(THEMES_PATH)
        ? JSON.parse(fs.readFileSync(THEMES_PATH, 'utf-8'))
        : { themes: [] };

    const chapters: GrammarChapter[] = [];
    const placed = new Map<string, string>(); // point id -> chapter id that claimed it
    let absorbedTotal = 0;
    const skippedTooFar: string[] = [];
    /** Points a theme lists that a family chapter claimed first - see AuthoredTheme. */
    const stolenByFamily: string[] = [];
    /** Points no theme covers, which fell back to alphabetical bucketing. */
    const unthemed: string[] = [];

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

    // --- Tier 2a: absorbed register ladders, before the per-level sweep -------
    // A pure register ladder small enough to study in one sitting is taught as a
    // single chapter at its easiest member's level, rather than as one wave per
    // level that never shows the learner the ladder whole. See LADDER_ABSORB_MAX.
    const unplacedByFamily = new Map<string, GrammarPoint[]>();
    for (const point of points.values()) {
        if (placed.has(point.id) || !point.family) continue;
        const bucket = unplacedByFamily.get(point.family.id) ?? [];
        bucket.push(point);
        unplacedByFamily.set(point.family.id, bucket);
    }

    const absorbedLadders: string[] = [];
    const levelGatedLadders = new Map<string, number>(); // family id -> member count
    for (const familyId of [...unplacedByFamily.keys()].sort()) {
        const familyMembers = unplacedByFamily.get(familyId)!;
        if (familyMembers.length < MIN_FAMILY_CHAPTER) continue;
        const levels = new Set(familyMembers.map(p => p.jlptLevel));
        // A single-level family is already one chapter under the per-level sweep
        // below; absorbing it would only rename the chapter.
        if (levels.size < 2) continue;
        const hasConstraint = familyMembers.some(p => p.family?.axis === 'constraint');
        if (hasConstraint || familyMembers.length > LADDER_ABSORB_MAX) {
            levelGatedLadders.set(familyId, familyMembers.length);
            continue;
        }

        // Easiest first (jlptLevel 5 = N5), then by id for determinism - the same
        // ordering the tier-1 absorb uses, so the base form is met before its
        // higher-register siblings.
        const ordered = familyMembers.slice().sort((a, b) => b.jlptLevel - a.jlptLevel || a.id.localeCompare(b.id));
        const placeAt = ordered[0].jlptLevel;
        const id = `${LEVEL_NAMES[placeAt].toLowerCase()}-fam-${familyId}`;
        for (const member of ordered) claim(member.id, id);
        chapters.push({
            id,
            title: ordered[0].family!.name,
            summary: `The whole ${ordered[0].family!.name.replace(/\s*\(.*\)$/, '').toLowerCase()} ladder in one place, easiest register first. These differ only by formality, so they are taught together rather than one level at a time: once you know the first, each of the rest is a one-line register fact.`,
            jlptLevel: placeAt,
            points: ordered.map(m => m.id),
        });
        absorbedLadders.push(`${familyId} (${ordered.length} members, N${[...levels].sort((a, b) => b - a).map(l => l).join('/N')} -> ${id})`);
    }

    // --- Tier 2b: generated chapters for whatever is left, easiest level first -
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
            // A level-gated family gets its level in the title, because the same
            // family name would otherwise head two or three chapters with no way
            // to tell them apart in a chapter list.
            const split = levelGatedLadders.has(familyId);
            chapters.push({
                id,
                title: split ? `${LEVEL_NAMES[level]}: ${members[0].family!.name}` : members[0].family!.name,
                summary: split
                    ? `The ${LEVEL_NAMES[level]} members of this family. The rest of it is taught at other levels - these ${members.length} are the ones worth telling apart from each other now, and the family page carries the full set.`
                    : `${members.length} ways to express this at ${LEVEL_NAMES[level]}. What separates them is in each point's usage note - read that before drilling them, or they blur together.`,
                jlptLevel: level,
                points: members.map(m => m.id),
            });
        }

        // Then everything with no family (or a family too small for its own
        // chapter), into the authored themes for this level. A theme is not
        // sequenced internally - it only guarantees the chapter has a subject.
        for (const theme of themes.themes.filter(t => t.jlptLevel === level)) {
            const claimable = theme.points.filter(id => {
                if (!points.has(id)) {
                    if (allPoints.get(id)?.variantOf) return false;
                    throw new Error(`${THEMES_PATH}: theme "${theme.id}" lists "${id}", which is not a compiled grammar point (dropped as a duplicate, or a typo).`);
                }
                if (placed.has(id)) {
                    stolenByFamily.push(`${id} (theme "${theme.id}" -> chapter "${placed.get(id)}")`);
                    return false;
                }
                return true;
            });
            if (claimable.length === 0) continue;
            for (const id of claimable) claim(id, theme.id);
            chapters.push({
                id: theme.id,
                title: theme.title,
                summary: theme.summary,
                jlptLevel: level,
                points: claimable,
            });
        }

        // Anything still unplaced falls back to the old alphabetical bucketing,
        // and is named in the run's output so it can be themed - see the header.
        const leftovers = remaining.filter(p => !placed.has(p.id));
        unthemed.push(...leftovers.map(p => p.id));
        for (let i = 0; i < leftovers.length; i += FILL_CHAPTER_SIZE) {
            const lesson = leftovers.slice(i, i + FILL_CHAPTER_SIZE);
            const part = Math.floor(i / FILL_CHAPTER_SIZE) + 1;
            const total = Math.ceil(leftovers.length / FILL_CHAPTER_SIZE);
            const id = `${LEVEL_NAMES[level].toLowerCase()}-more-${String(part).padStart(2, '0')}`;
            for (const point of lesson) claim(point.id, id);
            chapters.push({
                id,
                title: `Further ${LEVEL_NAMES[level]} patterns (${part} of ${total})`,
                summary: `Independent ${LEVEL_NAMES[level]} patterns with no close synonym in the set. Not sequenced against each other - order here carries no pedagogical claim.`,
                jlptLevel: level,
                points: lesson.map(p => p.id),
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

    const duplicateChapterIds = chapters.map(c => c.id).filter((id, i, all) => all.indexOf(id) !== i);
    if (duplicateChapterIds.length > 0) {
        throw new Error(`Duplicate chapter id(s): ${[...new Set(duplicateChapterIds)].join(', ')} - a theme id in ${THEMES_PATH} collides with a generated chapter id.`);
    }

    const order = chapters.flatMap(c => c.points);
    if (order.length !== points.size) {
        throw new Error(`Teaching order has ${order.length} entries for ${points.size} points - duplicated somewhere.`);
    }

    const teachingOrder: GrammarTeachingOrder = { order, chapters };
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(teachingOrder));

    const { crossChapter, anchoredLessons } = anchorLessons(order, placed);

    const authoredCount = spine.chapters.length;
    const themedCount = chapters.filter(c => themes.themes.some(t => t.id === c.id)).length;
    console.log(`✅ Teaching order written to ${OUTPUT_PATH}`);
    console.log(`   - Chapters: ${chapters.length} (${authoredCount} hand-authored N5/N4, ${themedCount} authored N3-N1 themes, ${chapters.length - authoredCount - themedCount} generated)`);
    console.log(`   - Register ladders absorbed across levels: ${absorbedLadders.length}`);
    absorbedLadders.forEach(s => console.log(`       ${s}`));
    if (levelGatedLadders.size > 0) {
        console.log(`   - Families left level-gated (too large, or not a pure register ladder): ${levelGatedLadders.size}`);
    }
    if (stolenByFamily.length > 0) {
        console.log(`   - Themed points claimed by a family chapter instead: ${stolenByFamily.length}`);
        stolenByFamily.forEach(s => console.log(`       ${s}`));
    }
    console.log(`   - Contrast lessons anchored to a chapter: ${anchoredLessons} (${crossChapter} span more than one chapter)`);
    if (unthemed.length > 0) {
        console.log(`   - UNTHEMED, fell back to alphabetical buckets: ${unthemed.length}`);
        console.log(`       ${unthemed.join(' ')}`);
    }
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
