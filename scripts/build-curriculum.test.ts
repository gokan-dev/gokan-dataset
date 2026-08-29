import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { GrammarPoint, GrammarTeachingOrder } from '../src/models/grammar.model';

/**
 * Invariant tests over the COMPILED curriculum output, rather than unit tests of
 * build-curriculum.ts's internals. The valuable properties here are all
 * whole-dataset ones ("every point is introduced exactly once", "no alias
 * dangles"), and a bug in any of them is invisible at runtime - a point missing
 * from the order is simply never taught, and nothing errors.
 *
 * Skips itself when compiled/grammar is absent, so a fresh clone that hasn't run
 * `bun run build:grammar` yet doesn't fail the suite.
 */
const POINTS_DIR = './compiled/grammar/points';
const ORDER_PATH = './compiled/grammar/index/teaching-order.json';
const ALIASES_PATH = './compiled/grammar/index/aliases.json';
const built = fs.existsSync(ORDER_PATH) && fs.existsSync(POINTS_DIR);

describe.skipIf(!built)('compiled teaching order', () => {
    let order: GrammarTeachingOrder;
    let points: Map<string, GrammarPoint>;
    let aliases: Record<string, string>;

    beforeAll(() => {
        order = JSON.parse(fs.readFileSync(ORDER_PATH, 'utf-8'));
        aliases = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf-8'));
        points = new Map();
        for (const file of fs.readdirSync(POINTS_DIR)) {
            if (!file.endsWith('.json')) continue;
            const point: GrammarPoint = JSON.parse(fs.readFileSync(path.join(POINTS_DIR, file), 'utf-8'));
            points.set(point.id, point);
        }
    });

    it('introduces every non-variant point exactly once', () => {
        const seen = new Set<string>();
        const duplicated: string[] = [];
        for (const id of order.order) {
            if (seen.has(id)) duplicated.push(id);
            seen.add(id);
        }
        expect(duplicated).toEqual([]);

        // Realization variants are deliberately absent: the canonical member
        // carries the chapter slot and the SRS entry.
        const teachable = [...points.values()].filter(p => !p.variantOf);
        const missing = teachable.filter(p => !seen.has(p.id)).map(p => p.id).sort();
        expect(missing).toEqual([]);
        expect(order.order).toHaveLength(teachable.length);
    });

    it('keeps realization variants out of the order entirely', () => {
        const inOrder = new Set(order.order);
        const leaked = [...points.values()].filter(p => p.variantOf && inOrder.has(p.id)).map(p => p.id);
        expect(leaked).toEqual([]);
    });

    it('keeps every variant canonical IN the order', () => {
        // A group whose canonical was dropped would make the whole rule unteachable.
        const inOrder = new Set(order.order);
        const orphaned = [...points.values()]
            .filter(p => p.variantOf && !inOrder.has(p.variantOf))
            .map(p => `${p.id} -> ${p.variantOf}`);
        expect(orphaned).toEqual([]);
    });

    it('never points a variant at another variant, or at a missing point', () => {
        const byId = new Map([...points.values()].map(p => [p.id, p]));
        for (const p of points.values()) {
            if (!p.variantOf) continue;
            const canonical = byId.get(p.variantOf);
            expect(canonical, `${p.id} points at missing ${p.variantOf}`).toBeDefined();
            expect(canonical!.variantOf, `${p.id} -> ${p.variantOf} is a chain`).toBeUndefined();
            expect(p.variantRelation, `${p.id} has no named relation`).toBeTruthy();
        }
    });

    it('orders only ids that actually resolve to a point', () => {
        expect(order.order.filter(id => !points.has(id))).toEqual([]);
    });

    it('flattens chapters into exactly the order array', () => {
        expect(order.chapters.flatMap(c => c.points)).toEqual(order.order);
    });

    it('gives every chapter a unique id and at least one point', () => {
        const ids = order.chapters.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(order.chapters.filter(c => c.points.length === 0)).toEqual([]);
    });

    it('never aliases a dropped id to another dropped id, or to a missing point', () => {
        for (const [dropped, canonical] of Object.entries(aliases)) {
            expect(points.has(dropped), `${dropped} is aliased but still emitted`).toBe(false);
            expect(points.has(canonical), `${dropped} aliases missing point ${canonical}`).toBe(true);
            expect(aliases[canonical], `${dropped} -> ${canonical} is a chain`).toBeUndefined();
        }
    });

    it('teaches the structural particles before the discourse connectives', () => {
        // The regression this whole curriculum exists to prevent: the upstream
        // alphabetical order put seven near-synonymous "but"/"well then"
        // connectives first and は/を/て at positions 40+.
        const at = (id: string) => order.order.indexOf(id);
        const wa = at('n5-040');   // Noun は
        const wo = at('n5-043');   // Noun を
        expect(wa).toBeGreaterThanOrEqual(0);
        expect(wo).toBeGreaterThanOrEqual(0);
        expect(wa).toBeLessThan(10);
        expect(wo).toBeLessThan(20);
        // でも / しかし / けれども must all come after the case particles.
        for (const connective of ['n5-008', 'n5-003', 'n5-002']) {
            expect(at(connective)).toBeGreaterThan(wo);
        }
    });

    it('only ever pulls a register sibling forward, never a constraint one', () => {
        // A chapter may legitimately contain harder points than its own level,
        // but only where the point adds nothing but formality. A 'constraint'
        // sibling carries a restriction that needs its own exposure and must
        // stay at its own level.
        const offenders: string[] = [];
        for (const chapter of order.chapters) {
            for (const id of chapter.points) {
                const point = points.get(id)!;
                if (point.jlptLevel >= chapter.jlptLevel) continue;
                if (point.family?.axis !== 'register') {
                    offenders.push(`${id} (N${point.jlptLevel}, axis=${point.family?.axis ?? 'none'}) in ${chapter.id} (N${chapter.jlptLevel})`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe.skipIf(!built)('point kinds', () => {
    let points: GrammarPoint[];

    beforeAll(() => {
        points = fs.readdirSync(POINTS_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => JSON.parse(fs.readFileSync(path.join(POINTS_DIR, f), 'utf-8')));
    });

    it('gives every point a kind', () => {
        expect(points.filter(p => !p.kind).map(p => p.id)).toEqual([]);
    });

    it('only uses known kinds', () => {
        const known = new Set(['construction', 'inflection', 'lexical']);
        expect(points.filter(p => !known.has(p.kind)).map(p => p.id)).toEqual([]);
    });

    it('gives every inflection point a `derives`', () => {
        // The transformation quiz keys off `derives`; an inflection without one
        // is classified but unteachable.
        const missing = points.filter(p => p.kind === 'inflection' && !p.derives).map(p => p.id);
        expect(missing).toEqual([]);
    });

    it('never puts `derives` on a non-inflection point', () => {
        expect(points.filter(p => p.kind !== 'inflection' && p.derives).map(p => p.id)).toEqual([]);
    });

    it('classifies the load-bearing derivations as inflection', () => {
        // Regression guard on the specific points that motivated the field. If any
        // of these silently becomes a 'construction', it goes back to being drilled
        // by blanking a fixed kana instead of asking for the conjugation.
        const byId = new Map(points.map(p => [p.id, p]));
        for (const id of ['n5-046', 'n4-021', 'n4-063', 'n4-020', 'n1-178']) {
            expect(byId.get(id)?.kind, `${id} should be an inflection`).toBe('inflection');
        }
    });

    it('keeps points that merely CONSUME a form as constructions', () => {
        // The distinction the field exists to make: `Verb たほうがいい` presupposes
        // the past tense but its answer key is always ほうがいい.
        const byId = new Map(points.map(p => [p.id, p]));
        for (const id of ['n4-025', 'n5-047', 'n5-049', 'n4-029']) {
            expect(byId.get(id)?.kind, `${id} should be a construction`).toBe('construction');
        }
    });
});

describe.skipIf(!built)('banned glyphs', () => {
    /**
     * The em dash and the Unicode arrows render inconsistently across the app's
     * fonts and are banned from every user-facing value project-wide. The
     * upstream snapshot uses both freely, so `sanitizeGlyphs` strips them at
     * build time - this asserts the output, which is what actually reaches the
     * UI, rather than trusting the transform.
     */
    const BANNED = /[—→←↑↓⇒]/;
    const RENDERED: (keyof GrammarPoint)[] = [
        'title', 'romaji', 'shortExplanation', 'longExplanation', 'formation', 'usageNote', 'derives',
    ];

    it('leaves none in any rendered field of any compiled point', () => {
        const offenders: string[] = [];
        for (const file of fs.readdirSync(POINTS_DIR)) {
            if (!file.endsWith('.json')) continue;
            const point: GrammarPoint = JSON.parse(fs.readFileSync(path.join(POINTS_DIR, file), 'utf-8'));
            for (const field of RENDERED) {
                const value = point[field];
                if (typeof value === 'string' && BANNED.test(value)) offenders.push(`${point.id}.${field}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('leaves none in a chapter title or summary', () => {
        const order: GrammarTeachingOrder = JSON.parse(fs.readFileSync(ORDER_PATH, 'utf-8'));
        const offenders = order.chapters
            .filter(c => BANNED.test(c.title) || BANNED.test(c.summary ?? ''))
            .map(c => c.id);
        expect(offenders).toEqual([]);
    });
});

describe.skipIf(!built)('upstream corrections', () => {
    /**
     * overrides.json corrects the vendored snapshot at build time rather than by
     * editing it. Both operations fail silently if they stop applying - a
     * `removeExamples` entry that no longer matches leaves the bad sentence in
     * place, and a `formation` override that is ignored leaves locatePattern
     * anchoring against the wrong attachment. The build throws on drift; this
     * asserts the output.
     */
    const OVERRIDES_PATH = './data/raw/grammar/overrides.json';
    const hasOverrides = fs.existsSync(OVERRIDES_PATH);
    let overrides: [string, { formation?: string; removeExamples?: string[] }][];
    let points: Map<string, GrammarPoint>;

    beforeAll(() => {
        const raw: Record<string, { formation?: string; removeExamples?: string[] }> =
            hasOverrides ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8')) : {};
        overrides = Object.entries(raw).filter(([id]) => !id.startsWith('_'));
        points = new Map();
        for (const file of fs.readdirSync(POINTS_DIR)) {
            if (!file.endsWith('.json')) continue;
            const point: GrammarPoint = JSON.parse(fs.readFileSync(path.join(POINTS_DIR, file), 'utf-8'));
            points.set(point.id, point);
        }
    });

    it.skipIf(!hasOverrides)('targets only points that actually survive to the output', () => {
        // An override on a point dropped by duplicates.json can never apply.
        expect(overrides.filter(([id]) => !points.has(id)).map(([id]) => id)).toEqual([]);
    });

    it.skipIf(!hasOverrides)('removes every example it says it removes', () => {
        const survivors: string[] = [];
        for (const [id, entry] of overrides) {
            for (const jp of entry.removeExamples ?? []) {
                if (points.get(id)!.examples.some(ex => ex.jp === jp)) survivors.push(`${id}: ${jp}`);
            }
        }
        expect(survivors).toEqual([]);
    });

    it.skipIf(!hasOverrides)('uses the corrected formation, not the upstream one', () => {
        for (const [id, entry] of overrides) {
            if (!entry.formation) continue;
            // Compared after glyph sanitisation, which also runs on formation.
            expect(points.get(id)!.formation.replace(/\s+/g, ' '))
                .toBe(entry.formation.replace(/\s+/g, ' '));
        }
    });

    it('never leaves a point with fewer than two examples', () => {
        // Removals are the only thing that can drive a point below its upstream
        // four, and one example means the same sentence forever.
        const thin = [...points.values()].filter(p => p.examples.length < 2).map(p => `${p.id} (${p.examples.length})`);
        expect(thin).toEqual([]);
    });
});

describe.skipIf(!built)('contrast merges', () => {
    /**
     * A 'contrast' entry in duplicates.json collapses a pair that is NOT the
     * same pattern - た vs る, affirmative vs negative, destination vs purpose -
     * on the grounds that the cloze blanks a byte-identical string in both, so
     * the difference is never the thing being asked. That trade is only safe if
     * two things hold, and neither is visible at runtime if it breaks: the
     * dropped side's examples must survive on the canonical (they are the only
     * place the other setting appears at all), and the canonical must state the
     * difference outright.
     */
    const DUPLICATES_PATH = './data/raw/grammar/duplicates.json';
    let contrast: [string, { canonical: string; differentiator?: string }][];
    let points: Map<string, GrammarPoint>;

    beforeAll(() => {
        const map: Record<string, { canonical: string; relation?: string; differentiator?: string }> =
            JSON.parse(fs.readFileSync(DUPLICATES_PATH, 'utf-8'));
        contrast = Object.entries(map).filter(([, e]) => e.relation === 'contrast') as typeof contrast;
        points = new Map();
        for (const file of fs.readdirSync(POINTS_DIR)) {
            if (!file.endsWith('.json')) continue;
            const point: GrammarPoint = JSON.parse(fs.readFileSync(path.join(POINTS_DIR, file), 'utf-8'));
            points.set(point.id, point);
        }
    });

    it('has at least one, so the rest of this block is not vacuous', () => {
        expect(contrast.length).toBeGreaterThan(0);
    });

    it('keeps every canonical, and drops every donor', () => {
        for (const [donor, entry] of contrast) {
            expect(points.has(entry.canonical), `${donor}'s canonical ${entry.canonical} is missing`).toBe(true);
            expect(points.has(donor), `${donor} was absorbed but still emitted`).toBe(false);
        }
    });

    it('absorbs the donated examples rather than discarding them', () => {
        // Four per raw entry upstream, so a canonical with one donor carries 8.
        const donorsPerCanonical = new Map<string, number>();
        for (const [, entry] of contrast) {
            donorsPerCanonical.set(entry.canonical, (donorsPerCanonical.get(entry.canonical) ?? 0) + 1);
        }
        for (const [canonicalId, donors] of donorsPerCanonical) {
            const point = points.get(canonicalId)!;
            expect(point.examples.length, `${canonicalId} absorbed ${donors} donor(s)`)
                .toBeGreaterThan(4 * donors);
        }
    });

    it('states the differentiator on the surviving point', () => {
        for (const [donor, entry] of contrast) {
            expect(entry.differentiator, `${donor} has no differentiator`).toBeTruthy();
            const note = points.get(entry.canonical)?.usageNote ?? '';
            expect(note, `${entry.canonical} does not carry ${donor}'s differentiator`)
                .toContain(entry.differentiator!);
        }
    });

    it('never uses a banned glyph in a differentiator', () => {
        // usageNote renders in the app, and em dashes / arrow glyphs are banned
        // in user-facing values.
        for (const [donor, entry] of contrast) {
            expect(entry.differentiator!, `${donor}`).not.toMatch(/[—→←↑↓⇒]/);
        }
    });
});

describe.skipIf(!fs.existsSync('./compiled/grammar/index/browse.json'))('browse index', () => {
    let browse: {
        points: { id: string; kind: string; orderIndex: number | null; variantOf?: string; jlptLevel: number }[];
        stats: Record<string, unknown> & { points: number; introduced: number; variants: number; byKind: Record<string, number> };
    };
    let pointIds: Set<string>;

    beforeAll(() => {
        browse = JSON.parse(fs.readFileSync('./compiled/grammar/index/browse.json', 'utf-8'));
        pointIds = new Set(fs.readdirSync(POINTS_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
    });

    it('has exactly one row per compiled point', () => {
        expect(browse.points).toHaveLength(pointIds.size);
        const ids = new Set(browse.points.map(p => p.id));
        expect(ids.size).toBe(browse.points.length);
        expect([...pointIds].filter(id => !ids.has(id))).toEqual([]);
    });

    it('agrees with the teaching order about what is introduced', () => {
        // The browse page shows "not introduced" from this field, so a drift here
        // would misreport the dataset rather than merely look wrong.
        const order: GrammarTeachingOrder = JSON.parse(fs.readFileSync(ORDER_PATH, 'utf-8'));
        const introduced = browse.points.filter(p => p.orderIndex !== null);
        expect(introduced).toHaveLength(order.order.length);

        for (const row of browse.points) {
            if (row.orderIndex === null) continue;
            expect(order.order[row.orderIndex], `${row.id} claims order index ${row.orderIndex}`).toBe(row.id);
        }
    });

    it('marks exactly the realization variants as excluded from the order', () => {
        const excluded = browse.points.filter(p => p.orderIndex === null).map(p => p.id).sort();
        const variants = browse.points.filter(p => p.variantOf).map(p => p.id).sort();
        expect(excluded).toEqual(variants);
    });

    it('reports stats that match its own rows', () => {
        expect(browse.stats.points).toBe(browse.points.length);
        expect(browse.stats.introduced).toBe(browse.points.filter(p => p.orderIndex !== null).length);
        expect(browse.stats.variants).toBe(browse.points.filter(p => p.variantOf).length);

        const kindCounts: Record<string, number> = {};
        for (const row of browse.points) kindCounts[row.kind] = (kindCounts[row.kind] ?? 0) + 1;
        expect(browse.stats.byKind).toEqual(kindCounts);
    });

    it('is sorted introduction-order first, variants last', () => {
        const firstNull = browse.points.findIndex(p => p.orderIndex === null);
        if (firstNull === -1) return;
        expect(browse.points.slice(firstNull).every(p => p.orderIndex === null)).toBe(true);
    });
});
