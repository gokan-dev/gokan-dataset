// Reviews (docs/MULTILINGUAL.md, "Corroboration and review"): decisions about renderings, a gold
// set of acceptable equivalents, and notes for one audience, written by hand in data/reviews/ as
// JSON Lines. They are untrusted input, so each line is narrowed here, once; past this module the
// records are typed. build:text applies them to the renderings it assembles, check:text verifies
// the compiled output against them and the benchmark scores the gold set with them.
//
// Files, by name: `<lang>.jsonl` holds verdicts on renderings in that language, `gold-<lang>.jsonl`
// the gold set written in it, `notes-<lang>.jsonl` its notes. Any other file is an error, so a
// misnamed file is never silently ignored.
import type { EntityKind, LanguageTag, Note, Rendering, ReviewProvenance, TextByLanguage, TextStatus } from '../models/text.model';
import { rendering } from './renderings';
import { isLowercaseTag } from './validate';

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const GOLD_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;
export type GoldLevel = (typeof GOLD_LEVELS)[number];

export type ReviewDecision = 'reviewed' | 'rejected';

/** Who wrote a record, how, and how sure they were. */
export interface ReviewRecordProvenance extends ReviewProvenance {
    confidence: Confidence;
}

/** A decision about one rendering, identified by its content hash (see renderingId). */
export interface Verdict extends ReviewRecordProvenance {
    /** The language of the file the rendering is in, from the review file's name. */
    lang: LanguageTag;
    rendering: string;
    /** Only words are reviewed so far; another kind fails parsing until something applies it. */
    entity: { kind: Extract<EntityKind, 'vocab'>; id: string };
    decision: ReviewDecision;
    reason?: string;
    /** The status the rendering had when it was reviewed: what the benchmark's precision is measured by. */
    seen: TextStatus;
    source: string;
    /** The rendering's text, for a person reading the file; the id is what identifies it. */
    value: string;
}

export interface GoldSense {
    /** The sense as JMdict writes it in English, to say which meaning `accept` is for. */
    sense: string;
    /** The words a learner reading that sense should accept, in the gold file's language. */
    accept: string[];
}

/** One word of the gold set, with its acceptable equivalents per main sense. */
export interface GoldWord extends ReviewRecordProvenance {
    lang: LanguageTag;
    word: string;
    headword: string;
    reading: string;
    level: GoldLevel;
    senses: GoldSense[];
}

/** A note for one audience (a false friend), which build:text emits as a `note` rendering. */
export interface ReviewNote extends ReviewRecordProvenance {
    lang: LanguageTag;
    word: string;
    headword: string;
    value: string;
}

export interface Reviews {
    verdicts: Verdict[];
    gold: GoldWord[];
    notes: ReviewNote[];
}

export type ReviewFileKind = 'verdicts' | 'gold' | 'notes';

/** What a file of data/reviews/ holds, from its name; undefined for a name no reader knows. */
export function reviewFileKind(name: string): { kind: ReviewFileKind; lang: LanguageTag } | undefined {
    const match = /^(?:(gold|notes)-)?([a-z0-9-]+)\.jsonl$/.exec(name);
    const lang = match?.[2];
    if (!match || lang === undefined || !isLowercaseTag(lang)) return undefined;
    return { kind: match[1] === 'gold' ? 'gold' : match[1] === 'notes' ? 'notes' : 'verdicts', lang };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isStatus = (value: unknown): value is TextStatus => value === 'imported' || value === 'corroborated' || value === 'reviewed' || value === 'rejected';
const isDecision = (value: unknown): value is ReviewDecision => value === 'reviewed' || value === 'rejected';
const isConfidence = (value: unknown): value is Confidence => CONFIDENCES.some(c => c === value);
const goldLevel = (value: unknown): GoldLevel | undefined => GOLD_LEVELS.find(l => l === value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The provenance every record carries, or the first thing wrong with it. */
function provenance(raw: Record<string, unknown>): ReviewRecordProvenance | string {
    const { by, basis, date, confidence } = raw;
    if (!isString(by) || !isString(basis)) return 'needs "by" and "basis"';
    if (!isString(date) || !DATE.test(date)) return 'needs a YYYY-MM-DD "date"';
    if (!isConfidence(confidence)) return `"confidence" must be one of ${CONFIDENCES.join(', ')}`;
    return { by, basis, date, confidence };
}

function parseVerdict(raw: Record<string, unknown>, lang: LanguageTag): Verdict | string {
    const from = provenance(raw);
    if (typeof from === 'string') return from;
    const { rendering: id, entity, decision, reason, seen, source, value } = raw;
    if (!isString(id) || !/^[0-9a-f]{16}$/.test(id)) return '"rendering" must be a rendering id (16 hex digits)';
    if (!isRecord(entity) || !isString(entity.id)) return '"entity" must be { kind, id }';
    if (entity.kind !== 'vocab') return `entity kind "${String(entity.kind)}" is not reviewed yet: only "vocab" verdicts are applied`;
    if (!isDecision(decision)) return '"decision" must be "reviewed" or "rejected"';
    if (reason !== undefined && !isString(reason)) return '"reason", when given, must be text';
    if (!isStatus(seen)) return '"seen" must be a status';
    if (!isString(source) || typeof value !== 'string') return 'needs "source" and "value"';
    return { lang, rendering: id, entity: { kind: 'vocab', id: entity.id }, decision, ...(reason === undefined ? {} : { reason }), seen, source, value, ...from };
}

function parseGold(raw: Record<string, unknown>, lang: LanguageTag): GoldWord | string {
    const from = provenance(raw);
    if (typeof from === 'string') return from;
    const { word, headword, reading, level, senses } = raw;
    if (!isString(word) || !isString(headword) || !isString(reading)) return 'needs "word", "headword" and "reading"';
    const known = goldLevel(level);
    if (!known) return `"level" must be one of ${GOLD_LEVELS.join(', ')}`;
    if (!Array.isArray(senses) || senses.length === 0) return 'needs at least one sense';
    const parsed: GoldSense[] = [];
    for (const s of senses) {
        if (!isRecord(s) || !isString(s.sense) || !Array.isArray(s.accept)) return 'each sense needs "sense" and "accept"';
        const accept = s.accept.filter(isString);
        if (accept.length !== s.accept.length || accept.length === 0) return `sense "${s.sense}": "accept" must be a non-empty list of words`;
        parsed.push({ sense: s.sense, accept });
    }
    return { lang, word, headword, reading, level: known, senses: parsed, ...from };
}

function parseNote(raw: Record<string, unknown>, lang: LanguageTag): ReviewNote | string {
    const from = provenance(raw);
    if (typeof from === 'string') return from;
    const { word, headword, value } = raw;
    if (raw.lang !== lang) return `"lang" must be the file's, ${lang}`;
    if (!isString(word) || !isString(headword) || !isString(value)) return 'needs "word", "headword" and "value"';
    return { lang, word, headword, value, ...from };
}

export function emptyReviews(): Reviews {
    return { verdicts: [], gold: [], notes: [] };
}

/**
 * One review file's records, added to `into`, and its problems, each naming the file and line.
 * A line that does not parse is a problem, never skipped: a decision silently lost is a text
 * silently shown.
 */
export function parseReviewFile(name: string, content: string, into: Reviews): string[] {
    const file = reviewFileKind(name);
    if (!file) return [`data/reviews/${name}: not a review file (<lang>.jsonl, gold-<lang>.jsonl or notes-<lang>.jsonl)`];
    const problems: string[] = [];
    content.split('\n').forEach((line, i) => {
        if (line.trim() === '') return;
        const where = `data/reviews/${name}:${i + 1}`;
        let raw: unknown;
        try { raw = JSON.parse(line); } catch { problems.push(`${where}: not JSON`); return; }
        if (!isRecord(raw)) { problems.push(`${where}: not an object`); return; }
        switch (file.kind) {
            case 'verdicts': {
                const v = parseVerdict(raw, file.lang);
                if (typeof v === 'string') problems.push(`${where}: ${v}`); else into.verdicts.push(v);
                return;
            }
            case 'gold': {
                const g = parseGold(raw, file.lang);
                if (typeof g === 'string') problems.push(`${where}: ${g}`); else into.gold.push(g);
                return;
            }
            case 'notes': {
                const n = parseNote(raw, file.lang);
                if (typeof n === 'string') problems.push(`${where}: ${n}`); else into.notes.push(n);
                return;
            }
        }
    });
    return problems;
}

const verdictKey = (lang: LanguageTag, renderingId: string): string => `${lang}\u0000${renderingId}`;

/** The verdicts by language and rendering, for build:text to look up as it assembles each word. */
export interface VerdictIndex {
    byKey: Map<string, Verdict>;
    /** The verdicts some rendering took; the rest name a rendering that does not exist. */
    applied: Set<string>;
    /**
     * Verdicts applied to a rendering whose status is no longer the one reviewed (`seen`): the
     * decision still holds, since the id says the text is the same, but the benchmark's precision
     * by status reads `seen`, so the build reports how many.
     */
    statusChanged: number;
}

/** The index, and a problem for each rendering judged twice in one language (which decision would hold?). */
export function verdictIndex(verdicts: Verdict[]): { index: VerdictIndex; problems: string[] } {
    const byKey = new Map<string, Verdict>();
    const problems: string[] = [];
    for (const v of verdicts) {
        const key = verdictKey(v.lang, v.rendering);
        if (byKey.has(key)) problems.push(`data/reviews/${v.lang}.jsonl: rendering ${v.rendering} has two verdicts; keep one line`);
        else byKey.set(key, v);
    }
    return { index: { byKey, applied: new Set(), statusChanged: 0 }, problems };
}

export const reviewOf = (v: ReviewProvenance): ReviewProvenance => ({ by: v.by, basis: v.basis, date: v.date });

/**
 * A word's text with each rendering a verdict names set to the verdict's status, with who decided
 * it. Nothing else changes, so the id stays valid. A rejected rendering stays: it can be inspected
 * and reviewed again, and every reader that chooses text skips it.
 */
export function applyVerdicts(text: TextByLanguage, kind: EntityKind, entityId: string, index: VerdictIndex): TextByLanguage {
    const out: TextByLanguage = {};
    for (const [lang, entity] of Object.entries(text)) {
        out[lang] = {
            ...entity,
            renderings: entity.renderings.map((r): Rendering => {
                const key = verdictKey(lang, r.id);
                const v = index.byKey.get(key);
                // A rendering carried for another entity (`of`) is reviewed as that entity's, where it lives.
                if (!v || r.of !== undefined || v.entity.kind !== kind || v.entity.id !== entityId) return r;
                if (!index.applied.has(key) && r.status !== v.seen) index.statusChanged++;
                index.applied.add(key);
                return { ...r, status: v.decision, review: reviewOf(v) };
            }),
        };
    }
    return out;
}

/** A problem for every verdict no rendering took: its text changed at the source, or the line is wrong. */
export function staleVerdicts(index: VerdictIndex): string[] {
    return [...index.byKey].filter(([key]) => !index.applied.has(key)).map(([, v]) =>
        `data/reviews/${v.lang}.jsonl: no rendering ${v.rendering} of ${v.entity.kind} ${v.entity.id} in ${v.lang} ("${v.value}", ${v.source}); the source may have changed the text: review it again or remove the line`);
}

/** What a word must be for a gold or note record to name it: its id, with its spellings and readings. */
export interface ReviewedWord {
    forms: string[];
}

/** A problem for every gold or note record naming a word that does not exist, or by a headword it does not have. */
export function unknownWords(reviews: Reviews, words: ReadonlyMap<string, ReviewedWord>): string[] {
    const problems: string[] = [];
    const check = (file: string, record: { word: string; headword: string }): void => {
        const word = words.get(record.word);
        if (!word) problems.push(`data/reviews/${file}: word ${record.word} (${record.headword}) does not exist`);
        else if (!word.forms.includes(record.headword)) problems.push(`data/reviews/${file}: word ${record.word} is not written ${record.headword} (${word.forms.join(', ')})`);
    };
    for (const g of reviews.gold) check(`gold-${g.lang}.jsonl`, g);
    for (const n of reviews.notes) check(`notes-${n.lang}.jsonl`, n);
    const seen = new Set<string>();
    for (const g of reviews.gold) {
        const key = `${g.lang}\u0000${g.word}`;
        if (seen.has(key)) problems.push(`data/reviews/gold-${g.lang}.jsonl: word ${g.word} appears twice`);
        seen.add(key);
    }
    return problems;
}

/** The source Gokan's own writing is filed under. */
export const NOTE_SOURCE = 'gokan';

/**
 * A word's notes as renderings, one per note in its language. Written by an AI and not yet checked
 * by a person, so `imported` (decision D4); a verdict on the note's id reviews it like any text.
 */
export function noteRenderings(notes: ReviewNote[]): Map<string, { lang: LanguageTag; renderings: Note[] }[]> {
    const byWord = new Map<string, { lang: LanguageTag; renderings: Note[] }[]>();
    for (const n of notes) {
        const note = rendering<Note>('vocab', n.word, n.lang, { role: 'note', source: { source: NOTE_SOURCE }, match: 'id', status: 'imported', value: n.value });
        const list = byWord.get(n.word) ?? [];
        const same = list.find(l => l.lang === n.lang);
        if (same) same.renderings.push(note); else list.push({ lang: n.lang, renderings: [note] });
        byWord.set(n.word, list);
    }
    return byWord;
}

/** Whether a rendering is a note this stage emitted, so a rerun removes it before adding it again. */
export function isReviewNote(r: Rendering, noteLanguages: ReadonlySet<LanguageTag>, lang: LanguageTag): boolean {
    return r.role === 'note' && r.source.source === NOTE_SOURCE && noteLanguages.has(lang);
}

/** Every way the compiled renderings disagree with the verdicts: a rendering missing, or a status or review not the verdict's. */
export function compiledVerdictProblems(verdicts: Verdict[], find: (v: Verdict) => Rendering | undefined): string[] {
    const problems: string[] = [];
    for (const v of verdicts) {
        const r = find(v);
        const where = `data/reviews/${v.lang}.jsonl: rendering ${v.rendering} of ${v.entity.kind} ${v.entity.id}`;
        if (!r) { problems.push(`${where} is not in compiled/text/${v.lang}/`); continue; }
        if (r.status !== v.decision) problems.push(`${where} is ${r.status}, not ${v.decision}`);
        const review = r.review;
        if (!review || review.by !== v.by || review.basis !== v.basis || review.date !== v.date) problems.push(`${where} does not record its review (${v.by}, ${v.basis}, ${v.date})`);
    }
    return problems;
}
