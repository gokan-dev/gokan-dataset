import fs from 'fs';
import path from 'path';
import { applyClip, serializeLike } from '../src/audio/attach';
import { AUDIO_FORMATS, configHash, parseVoiceConfig, type VoiceConfig } from '../src/audio/config';
import { GRAMMAR_MINED_DIR, GRAMMAR_POINTS_DIR, SENTENCES_DIR, VOCAB_DIR, COMPILED_DIR } from '../src/audio/compiled';
import { MANIFEST_PATH, VOICE_PATH, attachableClip, parseManifest, type ClipManifest } from '../src/audio/manifest';
import { grammarItem, sentenceItem, wordItem, type AudioItem } from '../src/audio/scope';
import type { AudioIndex } from '../src/models/audio.model';
import type { GrammarExample, GrammarPoint } from '../src/models/grammar.model';
import type { Sentence } from '../src/models/sentence.model';
import type { Vocabulary } from '../src/models/vocabulary.model';

/**
 * Writes `audio` on every word, sentence and grammar example that has a clip in
 * data/audio/clips.json, removes it from those that no longer do, and writes
 * index/audio.json (the voice and its credit) when any clip is attached. Offline: it reads
 * only the committed manifest, never the bucket. Runs at the end of build:data and
 * build:grammar, and by hand after build:audio. Rewrites only files whose clips changed,
 * in their own formatting.
 */

const AUDIO_INDEX_PATH = path.join(COMPILED_DIR, 'index', 'audio.json');

function jsonFiles(dir: string): string[] {
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
}

/** Reads a compiled file, lets `update` change it, and writes it back only if it changed. */
function rewrite<T>(file: string, update: (value: T) => boolean): boolean {
    const original = fs.readFileSync(file, 'utf8');
    // Compiled output of this repo's own build, already typed by it.
    const value = JSON.parse(original) as T;
    if (!update(value)) return false;
    fs.writeFileSync(file, serializeLike(original, value));
    return true;
}

function main(): void {
    const config: VoiceConfig | null = fs.existsSync(VOICE_PATH) ? parseVoiceConfig(JSON.parse(fs.readFileSync(VOICE_PATH, 'utf8'))) : null;
    const manifest: ClipManifest | null = fs.existsSync(MANIFEST_PATH) ? parseManifest(JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))) : null;
    const current = config ? configHash(config) : null;
    if (manifest && manifest.config !== current) console.log('clips.json was made with another voice config: no clip is attached until build:audio makes them again.');

    let attached = 0;
    let files = 0;
    const clipFor = (item: AudioItem): string | undefined => {
        const clip = attachableClip(manifest, current, item);
        if (clip) attached++;
        return clip;
    };

    for (const f of jsonFiles(VOCAB_DIR)) {
        if (rewrite<Vocabulary>(path.join(VOCAB_DIR, f), v => applyClip(v, clipFor(wordItem(v))))) files++;
    }

    // A grammar example that is one of our sentences shares that sentence's clip.
    const sentenceByText = new Map<string, Sentence>();
    for (const f of jsonFiles(SENTENCES_DIR)) {
        if (rewrite<Sentence[]>(path.join(SENTENCES_DIR, f), sentences => {
            let changed = false;
            for (const s of sentences) {
                sentenceByText.set(s.original, s);
                changed = applyClip(s, clipFor(sentenceItem(s))) || changed;
            }
            return changed;
        })) files++;
    }
    const exampleClip = (e: GrammarExample): string | undefined => {
        const sentence = sentenceByText.get(e.jp);
        return clipFor(sentence ? sentenceItem(sentence) : grammarItem(e));
    };
    const updateExamples = (examples: GrammarExample[]): boolean => {
        let changed = false;
        for (const e of examples) changed = applyClip(e, exampleClip(e)) || changed;
        return changed;
    };
    for (const f of jsonFiles(GRAMMAR_POINTS_DIR)) {
        if (rewrite<GrammarPoint>(path.join(GRAMMAR_POINTS_DIR, f), point => updateExamples(point.examples))) files++;
    }
    for (const f of jsonFiles(GRAMMAR_MINED_DIR)) {
        if (rewrite<GrammarExample[]>(path.join(GRAMMAR_MINED_DIR, f), updateExamples)) files++;
    }

    if (config && attached > 0) {
        const format = AUDIO_FORMATS[config.format];
        const index: AudioIndex = {
            engine: config.engine,
            engineVersion: config.engineVersion,
            voice: config.speaker,
            style: config.style,
            credit: config.credit,
            termsUrl: config.termsUrl,
            extension: format.extension,
            contentType: format.contentType,
        };
        const next = JSON.stringify(index, null, 2);
        if (!fs.existsSync(AUDIO_INDEX_PATH) || fs.readFileSync(AUDIO_INDEX_PATH, 'utf8') !== next) fs.writeFileSync(AUDIO_INDEX_PATH, next);
    } else if (fs.existsSync(AUDIO_INDEX_PATH)) {
        fs.rmSync(AUDIO_INDEX_PATH);
    }
    console.log(`attach:audio: ${attached} words, sentences and examples carry a clip; ${files} files rewritten.`);
}

main();
