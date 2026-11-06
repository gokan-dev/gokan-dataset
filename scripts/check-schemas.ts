#!/usr/bin/env bun
// Build check 7 (docs/MULTILINGUAL.md, "Build checks"): every compiled file validates against
// its file type's JSON Schema (compiled/schemas/, see build-schemas.ts), and no compiled file is
// of a type that has none.
//
// Run: bun run check:schemas (after bun run build).
import fs from 'node:fs';
import path from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import { resourceOf, schemaPath } from '../src/layout/resources';

const COMPILED_DIR = './compiled';
/** Files describing the dataset rather than being part of it. */
const DESCRIPTIONS = new Set(['datapackage.json']);

const ajv = new Ajv({ allErrors: false, strict: false });
const validators = new Map<string, ValidateFunction>();
function validatorFor(type: string): ValidateFunction {
    let validate = validators.get(type);
    if (!validate) {
        const schema: unknown = JSON.parse(fs.readFileSync(path.join(COMPILED_DIR, schemaPath(type)), 'utf8'));
        if (typeof schema !== 'object' || schema === null) throw new Error(`${schemaPath(type)} is not a schema`);
        validate = ajv.compile(schema);
        validators.set(type, validate);
    }
    return validate;
}

function walk(relative: string): string[] {
    return fs.readdirSync(path.join(COMPILED_DIR, relative), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap(entry => {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return rel === 'schemas' ? [] : walk(rel);
        return DESCRIPTIONS.has(rel) ? [] : [rel];
    });
}

const problems: string[] = [];
const counts = new Map<string, number>();
for (const file of walk('')) {
    const resource = resourceOf(file);
    if (!resource) { problems.push(`${file}: no file type in src/layout/resources.ts matches it`); continue; }
    const validate = validatorFor(resource.type);
    const value: unknown = JSON.parse(fs.readFileSync(path.join(COMPILED_DIR, file), 'utf8'));
    if (!validate(value)) {
        const error = validate.errors?.[0];
        problems.push(`${file} (${resource.type}): ${error ? `${error.instancePath || '/'} ${error.message ?? ''} ${JSON.stringify(error.params)}` : 'invalid'}`);
    }
    counts.set(resource.type, (counts.get(resource.type) ?? 0) + 1);
}

if (problems.length > 0) {
    console.error(`[check-schemas] ${problems.length} file(s) do not validate, such as:\n  ${problems.slice(0, 20).join('\n  ')}`);
    process.exit(1);
}
const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(`[check-schemas] all ${total} compiled files validate against their schema (${counts.size} file types).`);
