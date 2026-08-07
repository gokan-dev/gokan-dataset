# gokan-dataset

Open Japanese vocabulary/kanji/sentence dataset extracted from [gokan-srs](https://github.com/gokan-dev/gokan-srs) (see issue [#18](https://github.com/gokan-dev/gokan-srs/issues/18)). Compiles JMDict, KKLC, JPDB frequency data, JLPT level lists, and Tatoeba sentence pairs into flat, static JSON.

**Not just for the app**: `compiled/` is meant to be usable on its own - see [docs/SCHEMA.md](docs/SCHEMA.md) for the full file-by-file format documentation if you want to consume this data directly, without gokan-srs.

## Structure

- `data/raw/` - raw source datasets (JMDict, KKLC, JPDB, JLPT lists, Tatoeba sentence pairs + reading indices, hanabira grammar points). Git LFS tracked.
- `scripts/` - the build pipeline.
- `src/models/` - shared TypeScript types (mirrors the compiled output shape - see [docs/SCHEMA.md](docs/SCHEMA.md)).
- `src/utils/tokenizer.ts` - Kuromoji-based `SentenceTokenizer` used to link sentences to vocabulary.
- `compiled/` - build output: `kanji.json`, `vocab/{id}.json`, `sentences/{vocabId}.json`, `grammar/points/{id}.json`, `index/*.json`. **This is what consumers want.**

## Consuming this data

Clone (or add as a git submodule) and read directly from `compiled/`, or point a static file host / CDN at this repo. There's no build step needed to *read* the data - only to regenerate it from raw sources.

`gokan-srs` consumes this repo as a git submodule and deploys `compiled/` alongside its own app bundle.

## Building

```bash
bun install
bun run build:kanji   # kanji.json + index/kklc-kanji.json
bun run build:data    # the full vocab + sentence pipeline (~1-2 min, tokenizes ~230k sentences)
bun run build:jlpt    # index/jlpt.json (fast post-pass over the compiled vocab)
bun run build:grammar # grammar/points/{id}.json + grammar/index/jlpt.json (needs build:data's search index first)
```

Or `bun run build:data` alone, which chains `build:kanji` and `build:jlpt` around the main build.

## Tests

```bash
bun run test
```

## License

The compiled output (`compiled/`) is a derivative work of several upstream sources, each with their own terms - check before redistributing:

- **JMDict** (dictionary entries, glosses): [EDRDG](https://www.edrdg.org/edrdg/licence.html), Creative Commons Attribution-ShareAlike 4.0. Attribution to the Electronic Dictionary Research and Development Group required.
- **Tatoeba** (example sentences): individual sentences are contributed under varying Creative Commons licenses (mostly CC BY 2.0 FR) - see [tatoeba.org](https://tatoeba.org/en/terms_of_use).
- **KKLC step data**: derived from [ppasupat/vocab-kanji](https://github.com/ppasupat/vocab-kanji) - check that repo's license.
- **JPDB frequency data**: from [jpdb.io](https://jpdb.io) - check their terms before redistributing.
- **JLPT level lists**: derived from [Bluskyo/JLPT_Vocabulary](https://github.com/Bluskyo/JLPT_Vocabulary), itself sourced from tanos.co.uk under CC BY (Jonathan Waller).
- **Grammar points**: derived from [hanabira.org-japanese-content](https://github.com/tristcoil/hanabira.org-japanese-content), Creative Commons, attribution required (link back to hanabira.org).

This repo's own code (build scripts, types) and any originally-authored content is licensed CC BY-SA 4.0, matching JMDict's share-alike terms. If you plan to redistribute the compiled data itself, verify compliance with all of the above, not just this repo's license.
