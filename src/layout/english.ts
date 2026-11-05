// The dataset's English view: every compiled file in the shape it had before the text layer,
// built from its core and its English text. The apps that read English (gokan-srs, and
// gokan-dictionary until it shows other languages) read the dataset through this, so their code
// is unchanged; scripts/check-legacy.ts proves it gives back exactly the old files. Node only
// (it reads compiled/ from disk), and nothing here is a second source of truth: it is a view.
import fs from 'node:fs';
import path from 'node:path';
import type { GrammarBrowseIndex, GrammarBrowseTexts, GrammarSlot, GrammarVariantGroups } from '../models/grammar.model';
import type { SearchGlosses, SearchIndexEntry } from '../models/index.model';
import type { Kanji } from '../models/kanji.model';
import type { MediaIndexEntry } from '../models/media.model';
import type { Sentence } from '../models/sentence.model';
import type { TextFile } from '../models/text.model';
import type { Vocabulary } from '../models/vocabulary.model';
import { slotLabelsIn, type SlotLabels } from '../text/grammarSlots';
import {
    legacyGrammarBrowse, legacyGrammarConjugations, legacyGrammarContrasts, legacyGrammarExamples, legacyGrammarFamilies, legacyGrammarPoint,
    legacyGrammarTeachingOrder, legacyGrammarVariantGroups, legacyKanji, legacyMediaEntry, legacyMediaTitle, legacySentence, legacyVocab,
    type GrammarContrastsCore, type GrammarConjugationsCore, type GrammarExampleCore, type GrammarFamiliesCore, type GrammarPointCore,
    type GrammarTeachingOrderCore,
} from './legacy';

/** Files new with the text layer: the old layout never had them, so the English view has none. */
export const NEW_FILES = new Set(['grammar/slots.json', 'datapackage.json']);

export interface EnglishView {
    /** Every file of the old layout, relative to compiled/, sorted. */
    files(): string[];
    /** One JSON file of the old layout, parsed, as it was; other files are compiled/'s own bytes. */
    json(relative: string): unknown;
}

export function englishView(compiledDir: string): EnglishView {
    const enDir = path.join(compiledDir, 'text', 'en');
    const read = <T>(file: string): T => {
        // Output of this repository's own build, already typed by it.
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    };
    const core = <T>(relative: string): T => read<T>(path.join(compiledDir, relative));
    const english = (relative: string): TextFile | undefined => {
        const file = path.join(enDir, relative);
        return fs.existsSync(file) ? read<TextFile>(file) : undefined;
    };

    let slots: SlotLabels | undefined;
    const slotLabels = (): SlotLabels => {
        const en = english('grammar/slots.json');
        slots ??= slotLabelsIn(core<Omit<GrammarSlot, 'text'>[]>('grammar/slots.json').map(s => ({ ...s, text: { en: en?.entities[s.code] ?? { renderings: [] } } })), 'en');
        return slots;
    };
    const point = (relative: string) => legacyGrammarPoint(core<GrammarPointCore>(relative), english(relative), slotLabels());
    let titles: Map<string, string> | undefined;
    const titleOf = (pointId: string): string | undefined => {
        titles ??= new Map(fs.readdirSync(path.join(compiledDir, 'grammar', 'points')).filter(f => f.endsWith('.json')).sort()
            .map(f => { const legacy = point(`grammar/points/${f}`); return [legacy.id, legacy.title] as const; }));
        return titles.get(pointId);
    };

    /** The files whose shape changed, by exact path. */
    const byPath: Record<string, (relative: string) => unknown> = {
        'kanji.json': p => {
            const en = english(p);
            return core<Omit<Kanji, 'text'>[]>(p).map(k => legacyKanji(k, en?.entities[k.character]));
        },
        'index/search.json': p => {
            const glosses = fs.existsSync(path.join(enDir, p)) ? read<SearchGlosses>(path.join(enDir, p)) : {};
            return core<SearchIndexEntry[]>(p).map(({ u, ...e }) => ({ ...e, m: glosses[e.id] ?? '', ...(u ? { u } : {}) }));
        },
        'grammar/conjugations.json': p => legacyGrammarConjugations(core<GrammarConjugationsCore>(p), english(p)),
        'grammar/index/families.json': p => legacyGrammarFamilies(core<GrammarFamiliesCore>(p), english(p)),
        'grammar/index/contrasts.json': p => legacyGrammarContrasts(core<GrammarContrastsCore>(p), english(p)),
        'grammar/index/teaching-order.json': p => legacyGrammarTeachingOrder(core<GrammarTeachingOrderCore>(p), english(p)),
        'grammar/index/browse.json': p => legacyGrammarBrowse(core<GrammarBrowseIndex>(p), fs.existsSync(path.join(enDir, p)) ? read<GrammarBrowseTexts>(path.join(enDir, p)) : undefined),
        'grammar/index/variant-groups.json': p => legacyGrammarVariantGroups(core<GrammarVariantGroups>(p), titleOf),
        'media/index.json': p => {
            const en = english(p);
            return core<Omit<MediaIndexEntry, 'text'>[]>(p).map(e => legacyMediaEntry(e, en?.entities[e.id]));
        },
        'media/library.json': p => core(p),
    };
    /** The files whose shape changed, by directory: every file in it. */
    const byDir: Record<string, (relative: string) => unknown> = {
        vocab: p => { const c = core<Omit<Vocabulary, 'text'>>(p); return legacyVocab(c, english(p)?.entities[c.id]); },
        kanji: p => { const c = core<Omit<Kanji, 'text'>>(p); return legacyKanji(c, english(p)?.entities[c.character]); },
        sentences: p => { const en = english(p); return core<Omit<Sentence, 'text'>[]>(p).map(s => legacySentence(s, en?.entities[s.id])); },
        'grammar/points': point,
        'grammar/mined': p => legacyGrammarExamples(path.basename(p, '.json'), core<GrammarExampleCore[]>(p), english(p)),
        media: p => legacyMediaTitle(core<Parameters<typeof legacyMediaTitle>[0]>(p), english(p)),
    };

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
            const exact = byPath[relative];
            if (exact) return exact(relative);
            const project = byDir[path.posix.dirname(relative)];
            return project ? project(relative) : core(relative);
        },
    };
}
