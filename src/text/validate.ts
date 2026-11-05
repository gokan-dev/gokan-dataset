// The text layer's build checks (docs/MULTILINGUAL.md, "Build checks"), as pure functions over
// one rendering, one text file and one source description. scripts/check-text.ts runs them over
// compiled/ and data/sources/.
import type { EntityKind, LanguageTag, Rendering, TextFile } from '../models/text.model';
import { renderingId } from './renderings';

/** What the registry says about one source (data/sources/<id>/source.json). */
export interface SourceInfo {
    id: string;
    license: string;
    languages: LanguageTag[];
    roles: Rendering['role'][];
}

/** A BCP 47 tag, written in lowercase (decision D2): `en`, `zh-hans`, `nan`. */
const LOWERCASE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

const STATUSES = new Set(['imported', 'corroborated', 'reviewed', 'rejected']);
const MATCHES = new Set(['id', 'spelling+reading', 'spelling']);
const TRANSFORMS = new Set(['script:hant-to-hans']);

/**
 * Licences a source may carry under the dataset's CC BY-SA 4.0. A `LicenseRef-` names terms
 * that are not an SPDX licence; its source.json then says what they are (`licenseNote`).
 */
const COMPATIBLE_LICENSES = new Set(['CC-BY-SA-4.0', 'CC-BY-4.0', 'CC-BY-2.0', 'CC0-1.0', 'MIT']);

export function isLowercaseTag(tag: string): boolean {
    return LOWERCASE_TAG.test(tag);
}

export function licenseProblem(license: string): string | null {
    if (COMPATIBLE_LICENSES.has(license) || /^LicenseRef-[A-Za-z0-9.-]+$/.test(license)) return null;
    return `licence ${license} is not an SPDX id known to be compatible with CC-BY-SA-4.0`;
}

function values(rendering: Rendering): unknown[] {
    switch (rendering.role) {
        case 'definition':
            return rendering.senses.flatMap(s => s.glosses);
        case 'equivalent':
        case 'translation':
        case 'label':
        case 'prose':
        case 'note':
            return [rendering.value];
    }
}

/** Every problem with one rendering of one entity in a file of the given language. */
export function renderingProblems(rendering: Rendering, kind: EntityKind, entityId: string, fileLang: LanguageTag, sources: Map<string, SourceInfo>): string[] {
    const problems: string[] = [];
    const lang = rendering.lang ?? fileLang;
    if (rendering.lang !== undefined && (rendering.lang === fileLang || !isLowercaseTag(rendering.lang))) {
        problems.push(`lang "${rendering.lang}" must be a lowercase tag other than the file's`);
    }
    const source = sources.get(rendering.source.source);
    if (!source) problems.push(`source "${rendering.source.source}" is not in data/sources/`);
    else {
        if (!source.languages.includes(lang)) problems.push(`source ${source.id} does not list language ${lang}`);
        if (!source.roles.includes(rendering.role)) problems.push(`source ${source.id} does not list role ${rendering.role}`);
    }
    if (!MATCHES.has(rendering.match)) problems.push(`match "${rendering.match}" is not a known evidence`);
    if (!STATUSES.has(rendering.status)) problems.push(`status "${rendering.status}" is not a known status`);
    for (const value of values(rendering)) {
        if (typeof value === 'string') continue;
        if (typeof value !== 'object' || value === null || !('derivedFrom' in value)) { problems.push('a value is neither text nor a derived value'); continue; }
        const derived = value.derivedFrom as { transform?: string; value?: unknown };
        if (!TRANSFORMS.has(derived.transform ?? '') || typeof derived.value !== 'string') problems.push(`derived value without an allowlisted transform and its original`);
    }
    // A rendering carried for another entity (`of`) is identified as that entity's.
    const { id, ...unidentified } = rendering;
    const owner = rendering.of ?? { kind, id: entityId };
    if (id !== renderingId(owner.kind, owner.id, fileLang, unidentified)) problems.push(`id ${id} does not match its content`);
    return problems;
}

/** Every problem with one text file found at compiled/text/<lang>/<relative>. */
export function textFileProblems(file: TextFile, folderLang: LanguageTag, sources: Map<string, SourceInfo>): string[] {
    const problems: string[] = [];
    if (file.lang !== folderLang) problems.push(`lang "${file.lang}" is not its folder's, ${folderLang}`);
    if (!isLowercaseTag(file.lang)) problems.push(`lang "${file.lang}" is not a lowercase BCP 47 tag`);
    for (const [entityId, entity] of Object.entries(file.entities)) {
        const seen = new Set<string>();
        for (const rendering of entity.renderings) {
            if (seen.has(rendering.id)) problems.push(`${entityId}: rendering ${rendering.id} appears twice`);
            seen.add(rendering.id);
            for (const p of renderingProblems(rendering, file.kind, entityId, file.lang, sources)) problems.push(`${entityId}: ${p}`);
        }
    }
    return problems;
}
