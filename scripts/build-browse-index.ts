import fs from 'fs';
import path from 'path';
import type { GrammarPoint, GrammarTeachingOrder } from '../src/models/grammar.model';

/**
 * Emits `compiled/grammar/index/browse.json`: one summary row per point, plus
 * dataset-wide counts.
 *
 * Exists so a consumer can render a searchable, filterable view of the whole
 * dataset without fetching 788 individual point files. Everything a browse card
 * needs is here; the full point (examples, longExplanation) is still one fetch
 * away on the detail route.
 *
 * Runs last, because it joins the outputs of every earlier pass: the teaching
 * order and chapters, the variant groups, the kinds, and the conjugation drills.
 *
 * Run: `bun run build:browse` (chained from `bun run build:grammar`).
 */

const POINTS_DIR = './compiled/grammar/points';
const INDEX_DIR = './compiled/grammar/index';
const CONJUGATIONS_PATH = './compiled/grammar/conjugations.json';
const OUTPUT_PATH = './compiled/grammar/index/browse.json';

interface BrowseRow {
    id: string;
    title: string;
    romaji?: string;
    jlptLevel: number;
    /** Which exercise can test this point: 'construction' | 'inflection' | 'lexical'. */
    kind: string;
    /** For an inflection point, the derivation it teaches. */
    derives?: string;
    formation: string;
    shortExplanation: string;
    formalityLevel?: string;
    usageNote?: string;
    familyId?: string;
    familyName?: string;
    /** What this member adds over its family siblings: register | constraint | variant. */
    axis?: string;
    /** Set when this point is a realization variant taught via its canonical. */
    variantOf?: string;
    variantRelation?: string;
    /**
     * Zero-based position in the introduction order, or null when the point is
     * deliberately excluded from it (a realization variant).
     */
    orderIndex: number | null;
    chapterId?: string;
    chapterTitle?: string;
    exampleCount: number;
    /** Examples whose pattern was located; the rest fall back to a vocab-only blank. */
    anchoredExampleCount: number;
    /** Drill items available, for an inflection point. */
    conjugationItems?: number;
}

function main() {
    console.log('🔎 Building grammar browse index...');

    const order: GrammarTeachingOrder = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'teaching-order.json'), 'utf-8'));
    const variantGroups: Record<string, { id: string }[]> = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'variant-groups.json'), 'utf-8'));
    const conjugations: Record<string, { items: unknown[] }> = fs.existsSync(CONJUGATIONS_PATH)
        ? JSON.parse(fs.readFileSync(CONJUGATIONS_PATH, 'utf-8'))
        : {};

    const orderIndexOf = new Map(order.order.map((id, i) => [id, i]));
    const chapterOf = new Map<string, { id: string; title: string }>();
    for (const chapter of order.chapters) {
        for (const id of chapter.points) chapterOf.set(id, { id: chapter.id, title: chapter.title });
    }

    const rows: BrowseRow[] = [];
    for (const file of fs.readdirSync(POINTS_DIR)) {
        if (!file.endsWith('.json')) continue;
        const p: GrammarPoint = JSON.parse(fs.readFileSync(path.join(POINTS_DIR, file), 'utf-8'));
        const chapter = chapterOf.get(p.id);

        rows.push({
            id: p.id,
            title: p.title,
            ...(p.romaji ? { romaji: p.romaji } : {}),
            jlptLevel: p.jlptLevel,
            kind: p.kind,
            ...(p.derives ? { derives: p.derives } : {}),
            formation: p.formation,
            shortExplanation: p.shortExplanation,
            ...(p.formalityLevel ? { formalityLevel: p.formalityLevel } : {}),
            ...(p.usageNote ? { usageNote: p.usageNote } : {}),
            ...(p.family ? { familyId: p.family.id, familyName: p.family.name } : {}),
            ...(p.family?.axis ? { axis: p.family.axis } : {}),
            ...(p.variantOf ? { variantOf: p.variantOf } : {}),
            ...(p.variantRelation ? { variantRelation: p.variantRelation } : {}),
            orderIndex: orderIndexOf.has(p.id) ? orderIndexOf.get(p.id)! : null,
            ...(chapter ? { chapterId: chapter.id, chapterTitle: chapter.title } : {}),
            exampleCount: p.examples.length,
            anchoredExampleCount: p.examples.filter(e => e.patternWordIndices.length > 0).length,
            ...(conjugations[p.id] ? { conjugationItems: conjugations[p.id].items.length } : {}),
        });
    }

    // Introduction order first, then the excluded variants, so a consumer that
    // renders the array as-is already reads sensibly.
    rows.sort((a, b) => {
        if (a.orderIndex === null && b.orderIndex === null) return a.id.localeCompare(b.id);
        if (a.orderIndex === null) return 1;
        if (b.orderIndex === null) return -1;
        return a.orderIndex - b.orderIndex;
    });

    const byLevel: Record<number, number> = {};
    const byKind: Record<string, number> = {};
    const byAxis: Record<string, number> = {};
    for (const row of rows) {
        byLevel[row.jlptLevel] = (byLevel[row.jlptLevel] ?? 0) + 1;
        byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
        if (row.axis) byAxis[row.axis] = (byAxis[row.axis] ?? 0) + 1;
    }

    const families = new Map<string, { name: string; members: number; variants: number }>();
    for (const row of rows) {
        if (!row.familyId) continue;
        const entry = families.get(row.familyId) ?? { name: row.familyName ?? row.familyId, members: 0, variants: 0 };
        entry.members++;
        if (row.variantOf) entry.variants++;
        families.set(row.familyId, entry);
    }

    const output = {
        points: rows,
        stats: {
            points: rows.length,
            introduced: rows.filter(r => r.orderIndex !== null).length,
            variants: rows.filter(r => r.variantOf).length,
            variantGroups: Object.keys(variantGroups).length,
            families: families.size,
            unfamilied: rows.filter(r => !r.familyId).length,
            chapters: order.chapters.length,
            byLevel,
            byKind,
            byAxis,
        },
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));

    const bytes = fs.statSync(OUTPUT_PATH).size;
    console.log(`✅ Browse index written to ${OUTPUT_PATH}`);
    console.log(`   - Rows: ${rows.length} (${output.stats.introduced} introduced, ${output.stats.variants} realization variants)`);
    console.log(`   - Families: ${families.size}, unfamilied points: ${output.stats.unfamilied}`);
    console.log(`   - Size: ${(bytes / 1024).toFixed(0)} KB`);
}

if (import.meta.main) {
    try {
        main();
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
}
