// The dataset's English view: every compiled file in the shape it had before the text layer,
// built from its core and its English text. The apps that read English (gokan-srs, and
// gokan-dictionary until it shows other languages) read the dataset through this, so their code
// is unchanged; scripts/check-english.ts proves it changes only on purpose. This file is the disk
// half (Node only: it lists and reads compiled/); what each file becomes is englishFile.ts, which
// runs anywhere. Nothing here is a second source of truth: it is a view.
import fs from 'node:fs';
import path from 'node:path';
import { englishFile, englishInputs } from './englishFile';

/** Files new with the text layer: the old layout never had them, so the English view has none. */
export const NEW_FILES = new Set(['grammar/slots.json', 'datapackage.json']);

export interface EnglishView {
    /** Every file of the old layout, relative to compiled/, sorted. */
    files(): string[];
    /** One JSON file of the old layout, parsed, as it was; other files are compiled/'s own bytes. */
    json(relative: string): unknown;
}

/** The English view over a compiled/ directory on disk: englishFile's inputs, read from it. */
export function englishView(compiledDir: string): EnglishView {
    const read = (relative: string): unknown => JSON.parse(fs.readFileSync(path.join(compiledDir, relative), 'utf8'));
    const shared = new Map<string, unknown>();
    const sharedFor = (paths: readonly string[]): Map<string, unknown> => new Map(paths.map(p => {
        if (!shared.has(p)) shared.set(p, read(p));
        return [p, shared.get(p)] as const;
    }));

    const walk = (relative: string): string[] =>
        fs.readdirSync(path.join(compiledDir, relative), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap(entry => {
            const rel = relative ? `${relative}/${entry.name}` : entry.name;
            // text/ is what the view folds back in; schemas/ describes the new layout's files.
            if (entry.isDirectory()) return rel === 'text' || rel === 'schemas' ? [] : walk(rel);
            return NEW_FILES.has(rel) || entry.name.endsWith('.log') ? [] : [rel];
        });

    return {
        files: () => walk(''),
        json: relative => {
            const inputs = englishInputs(relative);
            const text = inputs.text !== undefined && fs.existsSync(path.join(compiledDir, inputs.text)) ? read(inputs.text) : undefined;
            return englishFile(relative, { core: read(inputs.core), text, shared: sharedFor(inputs.shared) });
        },
    };
}
