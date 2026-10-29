import fs from 'fs';
import path from 'path';
import type { GrammarExample, GrammarPoint } from '../models/grammar.model';
import type { Sentence } from '../models/sentence.model';
import type { Vocabulary } from '../models/vocabulary.model';

export const COMPILED_DIR = './compiled';
export const VOCAB_DIR = path.join(COMPILED_DIR, 'vocab');
export const SENTENCES_DIR = path.join(COMPILED_DIR, 'sentences');
export const GRAMMAR_POINTS_DIR = path.join(COMPILED_DIR, 'grammar', 'points');
export const GRAMMAR_MINED_DIR = path.join(COMPILED_DIR, 'grammar', 'mined');

export function readJson<T>(file: string): T {
    // Compiled output of this repo's own build, already typed by it.
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function jsonFiles(dir: string): string[] {
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
}

export interface CompiledData {
    vocab: Vocabulary[];
    sentencesByVocab: Map<string, Sentence[]>;
    grammarExamples: GrammarExample[];
}

/** The compiled words, their sentences, and every grammar example (authored and mined). */
export function loadCompiled(): CompiledData {
    const vocab = jsonFiles(VOCAB_DIR).map(f => readJson<Vocabulary>(path.join(VOCAB_DIR, f)));
    const sentencesByVocab = new Map<string, Sentence[]>();
    for (const f of jsonFiles(SENTENCES_DIR)) sentencesByVocab.set(path.basename(f, '.json'), readJson<Sentence[]>(path.join(SENTENCES_DIR, f)));
    const grammarExamples: GrammarExample[] = [];
    for (const f of jsonFiles(GRAMMAR_POINTS_DIR)) grammarExamples.push(...readJson<GrammarPoint>(path.join(GRAMMAR_POINTS_DIR, f)).examples);
    for (const f of jsonFiles(GRAMMAR_MINED_DIR)) grammarExamples.push(...readJson<GrammarExample[]>(path.join(GRAMMAR_MINED_DIR, f)));
    return { vocab, sentencesByVocab, grammarExamples };
}
