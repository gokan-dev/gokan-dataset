import fs from 'fs';
import path from 'path';
import type {
    AssembledGrammarBrowseRow, GrammarBrowseIndex, GrammarBrowseText, GrammarConjugations, GrammarPoint, GrammarSlot, GrammarTeachingOrder,
} from '../src/models/grammar.model';
import type { LanguageTag, TextByLanguage } from '../src/models/text.model';
import { romajiIn, slotLabelsIn, titleIn } from '../src/text/grammarSlots';
import { labelsOf, languagesOf, proseOf } from '../src/text/renderings';

/**
 * Emits `compiled/grammar/index/browse.json`: one summary row per point, plus
 * dataset-wide counts.
 *
 * Exists so a consumer can render a searchable, filterable view of the whole
 * dataset without fetching 788 individual point files. Everything a browse card
 * needs is here; the full point (examples, longExplanation) is still one fetch
 * away on the detail route.
 *
 * Like index/search.json, a row keeps its language-neutral fields, and its text
 * in each language as plain strings (`text`), which the layout writes to that
 * language's own browse index.
 *
 * Runs last, because it joins the outputs of every earlier pass: the teaching
 * order and chapters, the variant groups, the kinds, and the conjugation drills.
 *
 * Run: `bun run build:browse` (chained from `bun run build:grammar`).
 */

const POINTS_DIR = './build/assembled/grammar/points';
const INDEX_DIR = './build/assembled/grammar/index';
const CONJUGATIONS_PATH = './build/assembled/grammar/conjugations.json';
const SLOTS_PATH = './build/assembled/grammar/slots.json';
const OUTPUT_PATH = './build/assembled/grammar/index/browse.json';

function readJson<T>(file: string): T {
    // Output of this repository's own earlier grammar stages, already typed by them.
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

/** What a browse card shows of a point in one language, as plain strings. */
function browseText(p: GrammarPoint, lang: LanguageTag, slots: GrammarSlot[], chapterText: TextByLanguage | undefined): GrammarBrowseText {
    const labels = slotLabelsIn(slots, lang);
    const fields: GrammarBrowseText = {
        title: titleIn(p, lang, labels),
        romaji: romajiIn(p, lang, labels),
        derives: labelsOf(p.text, lang, { field: 'derives' })[0],
        formation: proseOf(p.text, lang, 'formation'),
        shortExplanation: proseOf(p.text, lang, 'shortExplanation'),
        usageNote: proseOf(p.text, lang, 'usageNote'),
        familyName: labelsOf(p.text, lang, { field: 'family' })[0],
        chapterTitle: labelsOf(chapterText, lang, { field: 'title' })[0],
    };
    // Absent rather than undefined, so the text index holds only what the language has.
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function main() {
    console.log('🔎 Building grammar browse index...');

    const order = readJson<GrammarTeachingOrder>(path.join(INDEX_DIR, 'teaching-order.json'));
    const variantGroups = readJson<Record<string, { id: string }[]>>(path.join(INDEX_DIR, 'variant-groups.json'));
    const conjugations: GrammarConjugations = fs.existsSync(CONJUGATIONS_PATH) ? readJson<GrammarConjugations>(CONJUGATIONS_PATH) : {};
    const slots = readJson<GrammarSlot[]>(SLOTS_PATH);

    const orderIndexOf = new Map(order.order.map((id, i) => [id, i]));
    const chapterOf = new Map<string, { id: string; text: TextByLanguage }>();
    for (const chapter of order.chapters) {
        for (const id of chapter.points) chapterOf.set(id, { id: chapter.id, text: chapter.text });
    }

    const rows: AssembledGrammarBrowseRow[] = [];
    for (const file of fs.readdirSync(POINTS_DIR).sort()) {
        if (!file.endsWith('.json')) continue;
        const p = readJson<GrammarPoint>(path.join(POINTS_DIR, file));
        const chapter = chapterOf.get(p.id);
        const text: Record<LanguageTag, GrammarBrowseText> = {};
        for (const lang of languagesOf(p.text)) text[lang] = browseText(p, lang, slots, chapter?.text);

        rows.push({
            id: p.id,
            title: p.title,
            ...(p.romaji !== undefined ? { romaji: p.romaji } : {}),
            jlptLevel: p.jlptLevel,
            kind: p.kind,
            ...(p.formalityLevel ? { formalityLevel: p.formalityLevel } : {}),
            ...(p.family ? { familyId: p.family.id } : {}),
            ...(p.family?.axis ? { axis: p.family.axis } : {}),
            ...(p.variantOf ? { variantOf: p.variantOf } : {}),
            ...(p.variantRelation ? { variantRelation: p.variantRelation } : {}),
            orderIndex: orderIndexOf.get(p.id) ?? null,
            ...(chapter ? { chapterId: chapter.id } : {}),
            exampleCount: p.examples.length,
            anchoredExampleCount: p.examples.filter(e => e.patternWordIndices.length > 0).length,
            ...(conjugations[p.id] ? { conjugationItems: conjugations[p.id].items.length } : {}),
            text,
        });
    }

    // Introduction order first, then the excluded variants, so a consumer that
    // renders the array as-is already reads sensibly.
    rows.sort((a, b) => {
        if (a.orderIndex === null && b.orderIndex === null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

    const families = new Map<string, { members: number; variants: number }>();
    for (const row of rows) {
        if (!row.familyId) continue;
        const entry = families.get(row.familyId) ?? { members: 0, variants: 0 };
        entry.members++;
        if (row.variantOf) entry.variants++;
        families.set(row.familyId, entry);
    }

    const output: GrammarBrowseIndex<AssembledGrammarBrowseRow> = {
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
