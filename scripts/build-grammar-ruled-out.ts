/**
 * Marks, on every grammar example, the family siblings that cannot stand in its
 * blank on the ground of connection (`GrammarExample.ruledOut`): the wrong
 * answers a choice exercise may offer. See src/utils/attachment.ts for the rule
 * and why it is narrow.
 *
 * Runs after build-grammar-sentences.ts, since a point's mined pool is part of
 * the evidence for what it attaches to, and rewrites the assembled points and
 * mined pools in place, as attach-audio.ts does.
 */
import fs from 'fs';
import path from 'path';
import kuromoji from 'kuromoji';
import type { GrammarExample, GrammarPoint } from '../src/models/grammar.model';
import type { LanguageTag } from '../src/models/text.model';
import { proseOf } from '../src/text/renderings';
import { hostFormOf, rulesOut, type AttachmentEvidence, type HostForm } from '../src/utils/attachment';
import { toMorphToken, type MorphToken } from '../src/utils/formationMiner';

const POINTS_DIR = './build/assembled/grammar/points';
const MINED_DIR = './build/assembled/grammar/mined';
/** The language whose formation text names the form before the marker (as in build-grammar-sentences.ts). */
const FORMATION_LANG: LanguageTag = 'en';

type Located = Pick<GrammarExample, 'words' | 'patternWordIndices'>;

/**
 * The token right before the example's pattern, or null when the pattern opens
 * the sentence or starts inside a token (a glued marker carries its own host).
 */
function tokenBeforePattern(tokens: MorphToken[], example: Located): MorphToken | null {
    if (example.patternWordIndices.length === 0) return null;
    const first = Math.min(...example.patternWordIndices);
    const markerStart = example.words.slice(0, first).reduce((n, w) => n + w.surface.length, 0);
    let offset = 0;
    for (const [i, t] of tokens.entries()) {
        if (offset === markerStart) return i > 0 ? tokens[i - 1] : null;
        offset += t.surface.length;
    }
    return null;
}

/** An example's pattern as one string, when its markers are side by side. */
function patternText(example: Located): string | null {
    const indices = example.patternWordIndices;
    if (indices.length === 0 || !indices.every((w, k) => k === 0 || w === indices[k - 1] + 1)) return null;
    return indices.map(i => example.words[i].surface).join('');
}

async function main() {
    console.log('🚫 Marking the siblings each grammar example rules out by connection...');
    const tokenizer = await new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>((resolve, reject) =>
        kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((err, t) => err ? reject(err) : resolve(t)));

    const points = new Map<string, GrammarPoint>();
    const mined = new Map<string, GrammarExample[]>();
    // Sorted: the listing's order differs by filesystem.
    for (const f of fs.readdirSync(POINTS_DIR).sort()) {
        const point = JSON.parse(fs.readFileSync(path.join(POINTS_DIR, f), 'utf-8')) as GrammarPoint;
        points.set(point.id, point);
        const minedPath = path.join(MINED_DIR, f);
        if (fs.existsSync(minedPath)) mined.set(point.id, JSON.parse(fs.readFileSync(minedPath, 'utf-8')) as GrammarExample[]);
    }

    // The form before each example's blank, once: the evidence for its own point
    // and the question asked of its siblings.
    const formOf = new Map<GrammarExample, HostForm | null>();
    const evidence = new Map<string, AttachmentEvidence>();
    for (const point of points.values()) {
        const observed = new Set<HostForm>();
        const markers = new Set<string>();
        for (const example of [...point.examples, ...(mined.get(point.id) ?? [])]) {
            const before = tokenBeforePattern(tokenizer.tokenize(example.jp).map(toMorphToken), example);
            const form = before ? hostFormOf(before) : null;
            formOf.set(example, form);
            if (form) observed.add(form);
            const text = patternText(example);
            if (text) markers.add(text);
        }
        evidence.set(point.id, { formation: proseOf(point.text, FORMATION_LANG, 'formation') ?? '', observed, markers: [...markers] });
    }

    let marked = 0, pointsMarked = 0, pointsWithTwo = 0;
    for (const point of points.values()) {
        // An inflection point has no marker of its own to weigh against a sibling's.
        const siblings = point.kind === 'inflection' ? [] : (point.family?.relatedPoints ?? [])
            .filter(id => points.has(id) && !points.get(id)!.variantOf && points.get(id)!.kind !== 'inflection');
        const pool = mined.get(point.id);
        let any = false, two = false;
        for (const example of [...point.examples, ...(pool ?? [])]) {
            delete example.ruledOut;
            const form = formOf.get(example) ?? null;
            const ruledOut = siblings.filter(id => rulesOut(form, evidence.get(id)!)).sort();
            if (ruledOut.length === 0) continue;
            example.ruledOut = ruledOut;
            marked++; any = true;
            if (ruledOut.length >= 2) two = true;
        }
        if (any) pointsMarked++;
        if (two) pointsWithTwo++;
        fs.writeFileSync(path.join(POINTS_DIR, `${point.id}.json`), JSON.stringify(point));
        if (pool) fs.writeFileSync(path.join(MINED_DIR, `${point.id}.json`), JSON.stringify(pool));
    }
    console.log(`   - ${marked} examples across ${pointsMarked} points rule out a sibling; ${pointsWithTwo} points have an example ruling out two or more`);
}
if (import.meta.main) main().catch(e => { console.error(e); process.exit(1); });
