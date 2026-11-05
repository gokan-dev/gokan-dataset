#!/usr/bin/env bun
// The text layer's build checks (docs/MULTILINGUAL.md, "Build checks"):
//   1. no text without a lowercase BCP 47 tag, a registered source, match evidence and a status,
//      and no rendering whose id does not match its content;
//   2. no explanation-language text left in a core file;
//   4. every source has a source.json with a compatible licence and a snapshot whose checksums match;
//   5. every derived value names an allowlisted transform and its original;
//   6. every review names a rendering that exists (no reviews are recorded yet).
// Check 7 (schemas) is scripts/check-schemas.ts, 8 (determinism) is check-determinism.ts, 9 (the
// benchmark's floors) is benchmark.ts --check; 3 holds by construction (a rendering has one source).
//
// Run: bun run check:text (after bun run build).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { TextFile } from '../src/models/text.model';
import { isLowercaseTag, licenseProblem, textFileProblems, type SourceInfo } from '../src/text/validate';

const COMPILED_DIR = './compiled';
const TEXT_DIR = path.join(COMPILED_DIR, 'text');
const SOURCES_DIR = './data/sources';
const REVIEWS_DIR = './data/reviews';

const problems: string[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** A text file as the layout stage writes it; textFileProblems checks the rest. */
function isTextFile(value: unknown): value is TextFile {
    return isRecord(value) && typeof value.kind === 'string' && typeof value.lang === 'string' && isRecord(value.entities);
}
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

// ---- 4. the sources registry
const sources = new Map<string, SourceInfo>();
for (const id of fs.readdirSync(SOURCES_DIR).sort()) {
    const file = path.join(SOURCES_DIR, id, 'source.json');
    if (!fs.existsSync(file)) { problems.push(`data/sources/${id}: no source.json`); continue; }
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isRecord(raw) || raw.id !== id || typeof raw.license !== 'string') { problems.push(`${file}: needs "id" (its folder's name) and "license"`); continue; }
    const license = licenseProblem(raw.license);
    if (license) problems.push(`${file}: ${license}`);
    if (raw.license.startsWith('LicenseRef-') && typeof raw.licenseNote !== 'string') problems.push(`${file}: a LicenseRef needs a licenseNote saying what the terms are`);
    const languages = strings(raw.languages);
    for (const lang of languages) if (!isLowercaseTag(lang)) problems.push(`${file}: language "${lang}" is not a lowercase tag`);
    const snapshot = raw.snapshot;
    if (raw.inRepository !== true) {
        if (!isRecord(snapshot) || typeof snapshot.date !== 'string') problems.push(`${file}: needs a snapshot with a date (or "inRepository": true)`);
        else {
            if (isRecord(snapshot.files)) {
                for (const [rel, expected] of Object.entries(snapshot.files)) {
                    if (!fs.existsSync(rel)) { problems.push(`${file}: snapshot file ${rel} is missing`); continue; }
                    const actual = `sha256:${createHash('sha256').update(fs.readFileSync(rel)).digest('hex')}`;
                    if (actual !== expected) problems.push(`${file}: ${rel} does not match its checksum`);
                }
            } else if (typeof snapshot.directory !== 'string' || !fs.existsSync(snapshot.directory)) {
                problems.push(`${file}: the snapshot names neither checksummed files nor an existing directory`);
            }
        }
    }
    sources.set(id, { id, license: raw.license, languages, roles: strings(raw.roles) as SourceInfo['roles'] });
}

// ---- 1, 5. every text file
let renderings = 0;
const counts = new Map<string, number>();
function walk(dir: string, lang: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full, lang); continue; }
        if (!entry.name.endsWith('.json')) continue;
        const raw: unknown = JSON.parse(fs.readFileSync(full, 'utf8'));
        // Index files (entities.json, search.json...) are derived lists, not renderings.
        if (!isTextFile(raw)) continue;
        const file = raw;
        for (const p of textFileProblems(file, lang, sources)) problems.push(`${path.relative(TEXT_DIR, full)}: ${p}`);
        for (const entity of Object.values(file.entities)) {
            for (const r of entity.renderings) {
                renderings++;
                const key = `${lang} ${r.source.source} ${r.status}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
    }
}
for (const lang of fs.existsSync(TEXT_DIR) ? fs.readdirSync(TEXT_DIR).sort() : []) {
    if (!isLowercaseTag(lang)) problems.push(`compiled/text/${lang}: not a lowercase BCP 47 tag`);
    walk(path.join(TEXT_DIR, lang), lang);
}

// ---- 2. no text left in a core file: the fields text used to live in, per split file kind.
const LEGACY_FIELDS: Record<string, string[]> = {
    vocab: ['senses', 'synonyms', 'text'],
    kanji: ['meanings', 'text'],
    sentences: ['en', 'text'],
    'grammar/points': ['shortExplanation', 'longExplanation', 'usageNote', 'formation', 'derives', 'text'],
    media: ['genres', 'tags', 'text'],
};
for (const [dir, fields] of Object.entries(LEGACY_FIELDS)) {
    for (const f of fs.readdirSync(path.join(COMPILED_DIR, dir)).filter(n => n.endsWith('.json')).sort()) {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(COMPILED_DIR, dir, f), 'utf8'));
        for (const item of Array.isArray(raw) ? raw : [raw]) {
            if (!isRecord(item)) continue;
            for (const field of fields) if (field in item) problems.push(`${dir}/${f}: core has "${field}"`);
            const merged = item.mergedVocabs;
            if (Array.isArray(merged) && merged.some(m => isRecord(m) && 'originalGlosses' in m)) problems.push(`${dir}/${f}: core has mergedVocabs[].originalGlosses`);
        }
    }
}
{
    const list: unknown = JSON.parse(fs.readFileSync(path.join(COMPILED_DIR, 'kanji.json'), 'utf8'));
    if (Array.isArray(list) && list.some(k => isRecord(k) && ('meanings' in k || 'text' in k))) problems.push('kanji.json: core has meanings');
    const search: unknown = JSON.parse(fs.readFileSync(path.join(COMPILED_DIR, 'index', 'search.json'), 'utf8'));
    if (Array.isArray(search) && search.some(e => isRecord(e) && 'm' in e)) problems.push('index/search.json: core has glosses ("m")');
}

// ---- 6. reviews
if (fs.existsSync(REVIEWS_DIR) && fs.readdirSync(REVIEWS_DIR).length > 0) {
    problems.push('data/reviews/ has files, but nothing reads reviews yet: add the check that each names a rendering that exists (phase 5)');
}

if (problems.length > 0) {
    console.error(`[check-text] ${problems.length} problem(s), such as:\n  ${problems.slice(0, 20).join('\n  ')}`);
    process.exit(1);
}
const summary = [...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `${k}: ${n}`).join('; ');
console.log(`[check-text] ${sources.size} sources, ${renderings} renderings, no problem (${summary}).`);
