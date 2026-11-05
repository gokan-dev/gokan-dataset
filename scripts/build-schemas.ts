#!/usr/bin/env bun
// compiled/schemas/ (decision D9): a JSON Schema for every compiled file type, generated from
// the TypeScript types in src/models/compiled.model.ts, so a schema cannot say something the
// build's own types do not. Objects are closed (no property a type does not declare), so a field
// that leaks into a file without being typed is caught by check-schemas, not shipped silently.
//
// Run: bun run build:schemas (part of bun run build, after build:layout).
import fs from 'node:fs';
import path from 'node:path';
import { createGenerator } from 'ts-json-schema-generator';
import { RESOURCES, schemaPath } from '../src/layout/resources';

const COMPILED_DIR = './compiled';

const generator = createGenerator({
    path: 'src/models/compiled.model.ts',
    tsconfig: 'tsconfig.json',
    type: '*',
    additionalProperties: false,
    expose: 'none',
    topRef: false,
    jsDoc: 'basic',
    skipTypeCheck: true,
});

const types = [...new Set(RESOURCES.map(r => r.type))].sort();
fs.rmSync(path.join(COMPILED_DIR, 'schemas'), { recursive: true, force: true });
for (const type of types) {
    const schema = generator.createSchema(type);
    const file = path.join(COMPILED_DIR, schemaPath(type));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ ...schema, $id: schemaPath(type) }, null, 2)}\n`);
}
console.log(`[schemas] ${types.length} schemas -> ${path.join(COMPILED_DIR, 'schemas')}`);
