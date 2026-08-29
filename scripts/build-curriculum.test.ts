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
