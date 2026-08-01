# gokan-dataset

Open, CC BY-SA 4.0-licensed Japanese vocabulary/kanji/sentence dataset, extracted from [gokan-srs](https://github.com/gokan-dev/gokan-srs) (see issue [#18](https://github.com/gokan-dev/gokan-srs/issues/18)).

Compiles JMDict, KKLC, JPDB frequency data, JLPT level lists, and Tatoeba sentence pairs into the flat JSON files `gokan-srs` (and eventually `gokan-dictionary`) serve as static data.

**Status**: Phase 1 of the split (this repo's pipeline reproduces `gokan-srs`'s current compiled output byte-for-byte, verified against all 67,177 files) - `gokan-srs` still owns and deploys its own copy of this data for now. This repo isn't consumed by anything yet.

## Structure

- `data/raw/` - raw source datasets (JMDict, KKLC, JPDB, JLPT lists, sentence/reading TSV+CSV). Git LFS tracked.
- `scripts/` - the build pipeline.
- `src/models/` - shared TypeScript types for the compiled output shape.
- `src/utils/tokenizer.ts` - Kuromoji-based `SentenceTokenizer` used to link sentences to vocabulary.
- `public/data/compiled/` - build output (`kanji.json`, `vocab/{id}.json`, `sentences/{vocabId}.json`, `index/*.json`).

## Building

```bash
bun install
bun run build:kanji   # kanji.json + index/kklc-kanji.json
bun run build:data    # the full vocab + sentence pipeline (~1-2 min, tokenizes ~230k sentences)
bun run build:jlpt    # index/jlpt.json (fast post-pass over the compiled vocab)
```

Or `bun run build:data` alone, which chains `build:kanji` and `build:jlpt` around the main build.

## Tests

```bash
bun run test
```
