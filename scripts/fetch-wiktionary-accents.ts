#!/usr/bin/env bun
// data/raw/accents/wiktionary.tsv: every accented {{ja-pron}} on the pages of Wiktionary's
// "Japanese terms with IPA pronunciation with pitch accent" category (CC BY-SA 4.0), read
// through the MediaWiki API 50 pages a request. About 900 requests, some 15 minutes at the pace
// below; it resumes from data/raw/accents/.wiktionary-fetch/ when stopped.
//
// Run: bun run fetch:accents:wiktionary. attach:accent reads the snapshot offline.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { formatSnapshot, type AccentRow } from '../src/accent/snapshot';
import { accentRowsOf } from '../src/accent/wiktionary';

const OUT = 'data/raw/accents/wiktionary.tsv';
const WORK = 'data/raw/accents/.wiktionary-fetch';
const API = 'https://en.wiktionary.org/w/api.php';
const CATEGORY = 'Category:Japanese terms with IPA pronunciation with pitch accent';
const USER_AGENT = 'gokan-dataset/1.0 (https://github.com/gokan-dev/gokan-dataset)';

interface Page { title: string; revisions?: { slots: { main: { content: string } } }[] }

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A query response's pages and continuation, narrowed from the API's JSON. */
function parseResponse(value: unknown): { pages: Page[]; next: Record<string, string> | null } {
    if (!isRecord(value)) throw new Error('Wiktionary API: expected an object');
    if (isRecord(value.error)) throw new Error(`Wiktionary API: ${JSON.stringify(value.error)}`);
    const query = isRecord(value.query) ? value.query : {};
    const pages: Page[] = Array.isArray(query.pages) ? query.pages.flatMap((p: unknown) => {
        if (!isRecord(p) || typeof p.title !== 'string') return [];
        const revision: unknown = Array.isArray(p.revisions) ? p.revisions[0] : undefined;
        const slots = isRecord(revision) && isRecord(revision.slots) ? revision.slots : {};
        const main = isRecord(slots.main) ? slots.main : {};
        return typeof main.content === 'string' ? [{ title: p.title, revisions: [{ slots: { main: { content: main.content } } }] }] : [{ title: p.title }];
    }) : [];
    const next = isRecord(value.continue)
        ? Object.fromEntries(Object.entries(value.continue).filter((e): e is [string, string] => typeof e[1] === 'string'))
        : null;
    return { pages, next };
}

async function main(): Promise<void> {
    fs.mkdirSync(WORK, { recursive: true });
    const statePath = path.join(WORK, 'continue.json');
    const rowsPath = path.join(WORK, 'rows.jsonl');
    let cont: Record<string, string> = {};
    if (fs.existsSync(statePath)) {
        // Our own file, written below.
        cont = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, string>;
    } else {
        fs.writeFileSync(rowsPath, '');
    }

    let pages = 0;
    for (;;) {
        const params = new URLSearchParams({
            action: 'query', format: 'json', formatversion: '2', maxlag: '5',
            generator: 'categorymembers', gcmtitle: CATEGORY, gcmlimit: '50', gcmnamespace: '0',
            prop: 'revisions', rvprop: 'content', rvslots: 'main', ...cont,
        });
        const response = await fetch(`${API}?${params.toString()}`, { headers: { 'User-Agent': USER_AGENT } });
        if (!response.ok) {
            console.warn(`Wiktionary API ${response.status}: retrying in 10s`);
            await sleep(10_000);
            continue;
        }
        const { pages: batch, next } = parseResponse(await response.json());
        const rows = batch.flatMap(p => accentRowsOf(p.title, p.revisions?.[0]?.slots.main.content ?? ''));
        fs.appendFileSync(rowsPath, rows.map(r => JSON.stringify(r) + '\n').join(''));
        pages += batch.length;
        if (!next) break;
        cont = next;
        fs.writeFileSync(statePath, JSON.stringify(cont));
        if (pages % 2000 < 50) console.log(`fetch:accents:wiktionary: ${pages} pages`);
        await sleep(300);
    }

    // Our own file, written above.
    const rows = fs.readFileSync(rowsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as AccentRow);
    const day = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(OUT, formatSnapshot([
        `Wiktionary (en), CC BY-SA 4.0: {{ja-pron}} accents of "${CATEGORY}", fetched ${day}.`,
        'form <TAB> reading <TAB> accents as written (acc=, acc2= ...). See src/accent/.',
    ], rows));
    fs.rmSync(WORK, { recursive: true, force: true });
    console.log(`fetch:accents:wiktionary: ${rows.length} rows from ${pages} pages -> ${OUT}`);
}

await main();
