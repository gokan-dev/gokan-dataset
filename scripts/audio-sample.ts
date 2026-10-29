import fs from 'fs';
import path from 'path';
import { AUDIO_FORMATS, DEFAULT_PARAMS, sha256Hex, type AudioFormat } from '../src/audio/config';
import { loadCompiled } from '../src/audio/compiled';
import { encode } from '../src/audio/encode';
import { planInput, type InputPlan, type Pronounce } from '../src/audio/plan';
import { rankForNewLearner } from '../src/audio/ranking';
import { grammarItem, selectScope, sentenceItem, wordItem, type AudioItem } from '../src/audio/scope';
import { cachedAnalysis, DEFAULT_ENGINE_URL, Voicevox } from '../src/audio/voicevox';
import type { Sentence } from '../src/models/sentence.model';
import type { Vocabulary } from '../src/models/vocabulary.model';

/**
 * The listening test of gokan-srs#164: a page of clips in a few VOICEVOX voices, the
 * forced-reading variant, and the format check, for a person to choose the voice by ear.
 * Run by hand, with the engine running:
 *
 *   docker run -d --rm -p 127.0.0.1:50021:50021 voicevox/voicevox_engine:cpu-latest
 *   bun scripts/audio-sample.ts [--engine URL] [--per-level 6] [--grammar 5] [--words 15]
 *   bun scripts/audio-sample.ts --measure 1000     # only the misreading measurement
 *
 * Writes data/audio/.sample/index.html (clips embedded, one file), rewritten as clips are
 * made so listening can start early; --measure writes measure.json instead: how often the
 * engine reads one of our words differently, over a fixed sample of the whole scope.
 *
 * Which words the engine misreads does not depend on the voice (the text analysis is the
 * same), so the forced variant is made in the first voice only.
 */

const VOICES = [
    { speaker: '冥鳴ひまり', style: 'ノーマル' },
    { speaker: '春日部つむぎ', style: 'ノーマル' },
    { speaker: '四国めたん', style: 'ノーマル' },
    { speaker: '玄野武宏', style: 'ノーマル' },
];
const FORMAT_TEST = 6;
/** Pairs told apart only by pitch, and words often misread out of context. */
const CHOSEN_WORDS = ['箸', '橋', '端', '雨', '飴', '柿', '牡蠣', '神', '紙', '酒', '鮭', '花', '鼻', '今', '居間', '熱い', '厚い', '日本', '一日', '今日', '明日', '大人', '上手', '人気', '方'];
const OUT_DIR = './data/audio/.sample';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A fixed, unbiased order: by the hash of a key, so the sample is the same on every run. */
function byHash<T>(items: readonly T[], key: (x: T) => string): T[] {
    return items.map(x => ({ h: sha256Hex(key(x)), x })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0)).map(({ x }) => x);
}

interface SampleItem {
    item: AudioItem;
    kind: 'sentence' | 'grammar' | 'word';
    label: string;
    reading: string;
    english: string;
    level?: number;
    plan?: InputPlan;
}

function pickSentences(vocab: Vocabulary[], sentencesByVocab: Map<string, Sentence[]>, perLevel: number): SampleItem[] {
    const picked: SampleItem[] = [];
    const seen = new Set<string>();
    for (const level of [5, 4, 3, 2, 1]) {
        const words = byHash(vocab.filter(v => v.jlptLevel === level && (sentencesByVocab.get(v.id)?.length ?? 0) > 0), v => v.id);
        // Half from words whose reading depends on context, where a misreading is likeliest.
        const ordered = [...words.filter(v => v.usageHints?.requiresContext), ...words.filter(v => !v.usageHints?.requiresContext)];
        const quota = [Math.ceil(perLevel / 2), perLevel];
        let count = 0;
        for (const v of ordered) {
            if (count >= (v.usageHints?.requiresContext ? quota[0] : quota[1])) continue;
            const top = rankForNewLearner(v.id, sentencesByVocab.get(v.id) ?? [])[0];
            if (!top || seen.has(top.id)) continue;
            seen.add(top.id);
            const item = sentenceItem(top);
            picked.push({ item, kind: 'sentence', label: top.original, reading: '', english: top.en[0]?.text ?? '', level });
            count++;
            if (count >= perLevel) break;
        }
    }
    return picked;
}

function pickWords(vocab: Vocabulary[], count: number): SampleItem[] {
    const byForm = new Map<string, Vocabulary>();
    for (const v of [...vocab].sort((a, b) => a.frequency.kanjiRank - b.frequency.kanjiRank)) {
        if (!byForm.has(v.writtenForm.kanji)) byForm.set(v.writtenForm.kanji, v);
    }
    const chosen = CHOSEN_WORDS.flatMap(w => byForm.get(w) ?? []);
    const rest = byHash(vocab.filter(v => v.jlptLevel && v.usageHints?.requiresContext && !chosen.includes(v)), v => v.id);
    return [...chosen, ...rest].slice(0, count).map(v => ({
        item: wordItem(v),
        kind: 'word' as const,
        label: v.writtenForm.kanji || v.reading.primary,
        reading: v.reading.primary,
        english: v.senses[0]?.glosses.slice(0, 3).join(', ') ?? '',
        level: v.jlptLevel,
    }));
}

interface Clip { id: string; bytes: number; dataUri: string }

/** Without listening: how often the engine reads one of our words differently, over a fixed sample of the whole scope. */
async function measure(engineVersion: string, scope: AudioItem[], count: number, pronounce: Pronounce): Promise<void> {
    console.log(`Measuring misreadings over ${count} items of ${scope.length}...`);
    const sample = byHash(scope, i => i.id).slice(0, count);
    const started = performance.now();
    const blank = () => ({ items: 0, misread: 0, spans: 0, spansMisread: 0 });
    const tally = { word: blank(), sentence: blank(), grammar: blank() };
    for (const item of sample) {
        const kind = item.id.startsWith('w:') ? 'word' : item.id.startsWith('s:') ? 'sentence' : 'grammar';
        const plan = await planInput(item, pronounce);
        tally[kind].items++;
        tally[kind].spans += item.readings.length;
        tally[kind].spansMisread += plan.misread.length;
        if (plan.misread.length > 0) tally[kind].misread++;
    }
    const result = {
        engineVersion,
        scopeItems: scope.length,
        scopeByKind: { word: scope.filter(i => i.id.startsWith('w:')).length, sentence: scope.filter(i => i.id.startsWith('s:')).length, grammar: scope.filter(i => i.id.startsWith('g:')).length },
        misreadings: tally,
        planningSecondsPerItem: (performance.now() - started) / 1000 / sample.length,
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'measure.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
}

async function main(): Promise<void> {
    const engine = new Voicevox(arg('engine') ?? DEFAULT_ENGINE_URL);
    const measureCount = Number(arg('measure') ?? 0);
    const engineVersion = await engine.version();
    const speakers = await engine.speakers();
    const voices = await Promise.all(VOICES.map(async v => {
        const speaker = speakers.find(s => s.name === v.speaker);
        const style = speaker?.styles.find(s => s.name === v.style);
        if (!speaker || !style) throw new Error(`No voice ${v.speaker} (${v.style}) in this engine`);
        return { ...v, uuid: speaker.uuid, styleId: style.id, policy: await engine.policy(speaker.uuid) };
    }));

    console.log(`VOICEVOX ${engineVersion}; loading the compiled dataset...`);
    const data = loadCompiled();
    const analysis = cachedAnalysis(engine, voices[0].styleId);
    if (measureCount > 0) {
        const scope = selectScope({ vocab: data.vocab, sentencesByVocab: data.sentencesByVocab, grammarExamples: data.grammarExamples, topSentences: 3 });
        await measure(engineVersion, scope, measureCount, analysis.pronounce);
        return;
    }
    const sentenceTexts = new Set([...data.sentencesByVocab.values()].flat().map(s => s.original));
    const grammar = byHash(data.grammarExamples.filter(e => !sentenceTexts.has(e.jp)), e => e.jp).slice(0, Number(arg('grammar') ?? 5))
        .map(e => ({ item: grammarItem(e), kind: 'grammar' as const, label: e.jp, reading: '', english: e.en }));
    const items: SampleItem[] = [
        ...pickSentences(data.vocab, data.sentencesByVocab, Number(arg('per-level') ?? 6)),
        ...grammar,
        ...pickWords(data.vocab, Number(arg('words') ?? 15)),
    ];
    for (const s of items) s.plan = await planInput(s.item, analysis.pronounce);

    const clips = new Map<string, Clip>();
    let synthMs = 0;
    const make = async (id: string, input: string, styleId: number, format: AudioFormat): Promise<void> => {
        const started = performance.now();
        const wav = await engine.synthesis(await engine.audioQuery(input, styleId), styleId, DEFAULT_PARAMS);
        synthMs += performance.now() - started;
        const bytes = await encode(wav, format);
        clips.set(id, { id, bytes: bytes.length, dataUri: `data:${AUDIO_FORMATS[format].contentType};base64,${Buffer.from(bytes).toString('base64')}` });
    };
    const formatItems = items.filter(s => s.kind === 'sentence').slice(0, FORMAT_TEST);
    const write = (): void => {
        fs.mkdirSync(OUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUT_DIR, 'index.html'), page(items, voices, clips, formatItems, engineVersion, synthMs / 1000 / Math.max(1, clips.size)));
    };

    // The format check first, so a phone can be tried while the rest is made.
    for (const s of formatItems) {
        await make(`${s.item.id}|${voices[0].styleId}|written`, s.plan!.written, voices[0].styleId, 'opus-24k');
        await make(`${s.item.id}|${voices[0].styleId}|aac`, s.plan!.written, voices[0].styleId, 'aac-32k');
    }
    write();
    // Every voice reads each item as written; the first voice also with our reading where the engine misreads a word.
    for (const [n, s] of items.entries()) {
        for (const voice of voices) await make(`${s.item.id}|${voice.styleId}|written`, s.plan!.written, voice.styleId, 'opus-24k');
        if (s.plan!.misread.length > 0) await make(`${s.item.id}|${voices[0].styleId}|forced`, s.plan!.forced, voices[0].styleId, 'opus-24k');
        if (n % 5 === 4) {
            write();
            console.log(`${n + 1}/${items.length} items, ${clips.size} clips`);
        }
    }
    write();
    console.log(`Wrote ${OUT_DIR}/index.html (${(fs.statSync(path.join(OUT_DIR, 'index.html')).size / 1e6).toFixed(1)} MB), ${clips.size} clips`);
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/** The text with our misread words marked, and their reading after them. */
function markedText(s: SampleItem): string {
    const spans = s.plan?.misread ?? [];
    let out = '';
    let cursor = 0;
    for (const span of spans) {
        out += escapeHtml(s.item.text.slice(cursor, span.start));
        out += `<mark title="We read it ${escapeHtml(span.reading)}">${escapeHtml(s.item.text.slice(span.start, span.start + span.length))}<span class="rd">${escapeHtml(span.reading)}</span></mark>`;
        cursor = span.start + span.length;
    }
    return out + escapeHtml(s.item.text.slice(cursor));
}

type SampleVoice = { speaker: string; style: string; styleId: number; policy: string };

function page(items: SampleItem[], voices: SampleVoice[], clips: Map<string, Clip>, formatItems: SampleItem[], engineVersion: string, secondsPerClip: number): string {
    const clipData = Object.fromEntries([...clips.values()].map(c => [c.id, c.dataUri]));
    const opus = [...clips.values()].filter(c => !c.id.endsWith('|aac'));
    const meanKb = opus.length === 0 ? 0 : opus.reduce((n, c) => n + c.bytes, 0) / opus.length / 1000;
    const button = (id: string, label: string) => clips.has(id)
        ? `<span class="clip"><button type="button" data-clip="${escapeHtml(id)}">${escapeHtml(label)}</button><label class="flag"><input type="checkbox" data-flag="${escapeHtml(id)}"> wrong</label></span>`
        : '';
    const row = (s: SampleItem) => `
        <li class="item">
            <p class="jp" lang="ja">${markedText(s)}</p>
            ${s.reading ? `<p class="meta" lang="ja">${escapeHtml(s.reading)}</p>` : ''}
            <p class="en">${escapeHtml(s.english)}${s.level ? ` <span class="meta">N${s.level}</span>` : ''}</p>
            <div class="clips">${voices.map(v => button(`${s.item.id}|${v.styleId}|written`, v.speaker)).join('')}</div>
            ${(s.plan?.misread.length ?? 0) > 0 ? `<div class="clips forced"><span class="meta">With our reading:</span>${button(`${s.item.id}|${voices[0].styleId}|forced`, voices[0].speaker)}</div>` : ''}
        </li>`;
    const pending = items.filter(s => !clips.has(`${s.item.id}|${voices[voices.length - 1].styleId}|written`)).length;
    return `<title>Gokan Voice Test</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Noto+Sans+JP:wght@400;500&family=Noto+Serif+JP:wght@500&display=swap">
<style>
/* One reading column; each item is a sentence, its English, then one button per voice. */
:root {
    --bg: #F5F0E8; --surface: #FFFFFF; --ink: #1a1a2e; --muted: #5C5A55; --line: #E8E0D0; --accent: #3D5A80; --mark: #E9DFC9; --flag: #9B3D2E;
    --sans: "Inter", "Noto Sans JP", system-ui, sans-serif; --mincho: "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif; --gothic: "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #12110F; --surface: #1C1B18; --ink: #E8E4DC; --muted: #A8A29A; --line: #2C2A26; --accent: #6B8FA8; --mark: #3A3326; --flag: #D98C7A; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #12110F; --surface: #1C1B18; --ink: #E8E4DC; --muted: #A8A29A; --line: #2C2A26; --accent: #6B8FA8; --mark: #3A3326; --flag: #D98C7A; color-scheme: dark; }
body { background: var(--bg); color: var(--ink); font: 15px/1.6 var(--sans); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
main { max-width: 46rem; margin: 0 auto; padding-block: 32px 64px; display: grid; gap: 40px; }
h1, h2 { font-weight: 600; text-wrap: balance; margin: 0; }
h1 { font-size: 1.6rem; } h2 { font-size: 1.15rem; }
section { display: grid; gap: 12px; min-width: 0; }
p { margin: 0; }
.meta { color: var(--muted); font-size: 0.85rem; }
.lead { color: var(--muted); max-width: 65ch; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; width: 100%; }
td, th { text-align: left; padding: 6px 12px 6px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
.scroll { overflow-x: auto; }
ul.items { list-style: none; margin: 0; padding: 0; display: grid; gap: 24px; }
.item { display: grid; gap: 6px; padding-bottom: 24px; border-bottom: 1px solid var(--line); min-width: 0; }
.jp { font-family: var(--mincho); font-size: 1.3rem; line-height: 1.9; overflow-wrap: anywhere; }
.en { color: var(--muted); }
mark { background: var(--mark); color: inherit; border-radius: 4px; padding: 0 2px; }
.rd { font-family: var(--gothic); font-size: 0.7em; margin-left: 4px; color: var(--muted); }
.clips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.clip { display: inline-flex; align-items: center; gap: 6px; }
button { font: 500 0.9rem var(--gothic); color: var(--accent); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; min-height: 40px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.playing { background: var(--accent); color: var(--surface); }
.flag { font-size: 0.8rem; color: var(--muted); display: inline-flex; gap: 4px; align-items: center; }
.flag:has(input:checked) { color: var(--flag); }
.policy { white-space: pre-wrap; font-family: var(--gothic); font-size: 0.85rem; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 12px; overflow-wrap: anywhere; }
.tally { font-variant-numeric: tabular-nums; }
</style>
<main>
    <header style="display:grid;gap:8px">
        <h1>Gokan voice test</h1>
        <p class="lead">Listen for wrong readings, wrong pitch accent and unnatural pauses. Tick "wrong" on any clip with a fault: the counts below add up per voice and are kept in this browser. Words the engine reads differently from our reading are marked, with our reading after them, and get a second clip in ${escapeHtml(voices[0].speaker)}'s voice that sends our reading instead (which words are misread does not depend on the voice).</p>
        ${pending > 0 ? `<p class="meta">Still being made: ${pending} of ${items.length} items. This page fills in as clips are made.</p>` : ''}
    </header>
    <section>
        <h2>Faults marked, per voice</h2>
        <div class="scroll"><table class="tally"><thead><tr><th>Voice</th><th>As written</th><th>With our reading</th></tr></thead><tbody>
        ${voices.map((v, i) => `<tr><td lang="ja">${escapeHtml(v.speaker)}</td><td data-count="${v.styleId}|written">0</td><td ${i === 0 ? `data-count="${v.styleId}|forced"` : ''}>${i === 0 ? '0' : 'not made'}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="meta">VOICEVOX ${escapeHtml(engineVersion)} on this machine's CPU: ${secondsPerClip.toFixed(1)} s per clip; ${meanKb.toFixed(1)} KB per Opus clip.</p>
    </section>
    <section>
        <h2>Format check</h2>
        <p class="lead">Play these on an iPhone (Safari) and an Android phone (Chrome). The first column is Ogg Opus at 24 kbps, the second AAC at 32 kbps. If an Opus button stays silent on a phone, the clips are made in AAC.</p>
        <ul class="items">${formatItems.map(s => `<li class="item"><p class="jp" lang="ja">${escapeHtml(s.item.text)}</p><div class="clips">${button(`${s.item.id}|${voices[0].styleId}|written`, 'Opus')}${button(`${s.item.id}|${voices[0].styleId}|aac`, 'AAC')}</div></li>`).join('')}</ul>
    </section>
    <section>
        <h2>Sentences</h2>
        <ul class="items">${items.filter(s => s.kind === 'sentence').map(row).join('')}</ul>
    </section>
    <section>
        <h2>Grammar examples</h2>
        <ul class="items">${items.filter(s => s.kind === 'grammar').map(row).join('')}</ul>
    </section>
    <section>
        <h2>Words</h2>
        <p class="lead">The first ones are pairs told apart only by pitch (箸 and 橋, 雨 and 飴): listen for the accent.</p>
        <ul class="items">${items.filter(s => s.kind === 'word').map(row).join('')}</ul>
    </section>
    <section>
        <h2>The voices' terms</h2>
        ${voices.map(v => `<div style="display:grid;gap:6px"><p lang="ja"><strong>${escapeHtml(v.speaker)}</strong> (${escapeHtml(v.style)}, style ${v.styleId})</p><div class="policy" lang="ja">${escapeHtml(v.policy)}</div></div>`).join('')}
    </section>
</main>
<script>
const CLIPS = ${JSON.stringify(clipData)};
const player = new Audio();
let current = null;
function stop() { player.pause(); if (current) current.classList.remove('playing'); current = null; }
document.addEventListener('click', e => {
    const b = e.target.closest('button[data-clip]');
    if (!b) return;
    if (current === b) { stop(); return; }
    stop();
    player.src = CLIPS[b.dataset.clip];
    current = b;
    b.classList.add('playing');
    player.play().catch(() => { b.classList.remove('playing'); b.textContent += ' (cannot play)'; current = null; });
});
player.addEventListener('ended', stop);
const KEY = 'gokan-voice-test-flags';
let flags = {};
try { flags = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
function tally() {
    const counts = {};
    for (const [id, on] of Object.entries(flags)) { if (!on) continue; const [, style, variant] = id.split('|'); const k = style + '|' + variant; counts[k] = (counts[k] || 0) + 1; }
    document.querySelectorAll('[data-count]').forEach(td => { td.textContent = counts[td.dataset.count] || 0; });
}
document.querySelectorAll('input[data-flag]').forEach(box => {
    box.checked = !!flags[box.dataset.flag];
    box.addEventListener('change', () => { flags[box.dataset.flag] = box.checked; try { localStorage.setItem(KEY, JSON.stringify(flags)); } catch {} tally(); });
});
tally();
</script>
`;
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
