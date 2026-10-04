<div align="center">

# gokan-dataset

**An open, cross-linked Japanese dataset: vocabulary, kanji, grammar, and tokenized example sentences, as flat static JSON.**

35,814 words &middot; 2,300 kanji &middot; 755 grammar points &middot; 31,355 sentence sets

[Format documentation](docs/SCHEMA.md) &nbsp;&middot;&nbsp; [See it in use](https://gokan-srs.com/dictionary/) &nbsp;&middot;&nbsp; [The app it powers](https://github.com/gokan-dev/gokan-srs)

[![License: CC BY-SA 4.0](https://img.shields.io/badge/license-CC%20BY--SA%204.0-blue)](#license)

</div>

## What this is

Several excellent Japanese datasets exist, and none of them talk to each other. JMDict knows what a word means but not how common it is. JPDB knows frequency but not which kanji a learner needs first. Tatoeba has hundreds of thousands of sentences with no link to the words inside them.

This repository does that joining once, at build time, and publishes the result as plain JSON files you can read with `fetch` or `JSON.parse`. No database, no API, no runtime.

For every word you get its readings, meanings, part of speech, JLPT level, frequency rank, the kanji it contains, the words it is built from, the words that contain it, and example sentences with the position of every word inside them already resolved.

## Quick look

```bash
curl https://raw.githubusercontent.com/gokan-dev/gokan-dataset/main/compiled/vocab/1589350.json
```

```jsonc
{
  "id": "1589350",
  "writtenForm": { "kanji": "思う", "alternatives": ["想う", "憶う"], "containedKanji": ["思"] },
  "reading": { "primary": "おもう", "alternatives": [] },
  "frequency": { "kanjiRank": 191 },
  "jlptLevel": 4,
  "senses": [
    { "pos": ["v5u", "vt"], "glosses": ["to think", "to consider", "to believe"] }
  ]
}
```

Sentences carry the offsets of every word they contain, so you can render a sentence with each word linked or glossed without tokenizing anything yourself:

```jsonc
{
  "original": "長い目で見れば違ってくると思います。",
  "en": [{ "text": "I suppose it's different when you think about it over the long term." }],
  "matches": {
    "1589350": [{ "start": 12, "length": 3, "reading": "おもい" }]
  }
}
```

## Layout

```
compiled/                 build output, and the only thing most consumers need
  kanji.json              all 2,300 kanji with KKLC step, JLPT level, frequency
  vocab/{id}.json         one file per word, keyed by JMDict id
  sentences/{id}.json     example sentences for that word, with match offsets
  grammar/points/{id}.json  grammar point with formation, explanation, examples
  media/index.json        the anime in the listening library
  media/library.json      every title's whole-series vocabulary, for ranking them
  media/{id}.json         one file per anime: each episode's vocabulary, with counts
  index/
    frequency.json        word ids in frequency order
    jlpt.json             JLPT level to word ids
    kklc.json             KKLC step to word ids
    kanji-vocab.json      kanji to the words containing it
    search.json           compact search index: written form, reading, gloss
data/raw/                 upstream sources, Git LFS tracked
scripts/                  the build pipeline
src/models/               TypeScript types mirroring the compiled shape
```

[docs/SCHEMA.md](docs/SCHEMA.md) documents every file and field.

[docs/JLPT_COVERAGE.md](docs/JLPT_COVERAGE.md) lists every JLPT vocabulary entry no compiled word answers, grouped by why (no kanji spelling, dropped by the build, not in JMdict). Regenerated on every `bun run build:data`.

For the grammar half specifically, three docs answer different questions:

- **[docs/GRAMMAR_TEACHING_MODEL.md](docs/GRAMMAR_TEACHING_MODEL.md)** explains the model in plain English: what a point, chapter, family, lesson and case each are, how they relate, and why the curriculum is arranged the way it is. Start here.
- **[docs/CURRICULUM.md](docs/CURRICULUM.md)** is the generated inventory: every chapter, the points in it, and the lessons it unlocks. Regenerated on every `bun run build:grammar`, so it cannot drift.
- **[docs/SCHEMA.md](docs/SCHEMA.md)** has the exact field names and validation rules.

## Using it

Read `compiled/` directly. Clone it, add it as a submodule, or point a CDN at it:

```bash
git clone --depth 1 https://github.com/gokan-dev/gokan-dataset.git
```

There is no build step required to read the data, only to regenerate it from source. `gokan-srs` consumes this repository as a git submodule and ships `compiled/` alongside its own bundle.

If you are building a Japanese learning tool, a reading assistant, a frequency-ordered study list, or anything that needs vocabulary joined to kanji and real sentences, this is meant to save you the assembly work.

## Rebuilding from source

Only needed if you are changing the pipeline. It reads from `data/raw/`, which is Git LFS tracked.

```bash
bun install
bun run build:kanji    # kanji.json and index/kklc-kanji.json
bun run build:data     # the full vocabulary and sentence pipeline, roughly 1 to 2 minutes
bun run build:jlpt     # index/jlpt.json, a fast pass over compiled vocabulary
bun run build:jlpt-coverage  # docs/JLPT_COVERAGE.md, the JLPT entries no compiled word answers
bun run build:grammar  # grammar points, requires build:data to have run first
bun run build:media    # media/, from the committed Jiten snapshots, offline
bun run select:media   # add Jiten's easiest anime to the selection (network, run by hand)
bun run fetch:media    # snapshot selected titles that have none yet (network, run by hand; --refresh for all)
bun run fetch:covers   # record each title's AniList cover URL (network, run by hand, after fetch:media)
```

`bun run build:data` chains `build:kanji`, `build:jlpt` and `build:jlpt-coverage` around the main build, and `build:media` after it, so it is usually the only one you need.

The anime in `media/` are listed in `data/raw/media/selection.json`: a few picked by hand, plus Jiten's 100 easiest eligible anime added by `select:media` (Adult and Ecchi genres and titles over 52 episodes are skipped). Adding one by hand means adding its Jiten deck id there, running `bun run fetch:media <id>` to snapshot it into `data/raw/media/jiten/`, then `bun run fetch:covers` and `bun run build:media`. Only selected titles are fetched: Jiten's terms rule out mirroring its whole database.

Sentence linking runs through a Kuromoji-based tokenizer (`src/utils/tokenizer.ts`) that handles compounds and deinflection, so 通っている resolves to 通う rather than splitting into fragments.

```bash
bun run test
```

## License

The code in this repository, meaning the build scripts and types, is CC BY-SA 4.0.

The compiled output is a derivative work of several upstream sources, each with its own terms. Check them before redistributing:

| Source | Provides | Terms |
|---|---|---|
| [JMDict](https://www.edrdg.org/edrdg/licence.html) | Dictionary entries, glosses | CC BY-SA 4.0, attribution to EDRDG required |
| [Tatoeba](https://tatoeba.org/en/terms_of_use) | Example sentences | Per-sentence, mostly CC BY 2.0 FR |
| [ppasupat/vocab-kanji](https://github.com/ppasupat/vocab-kanji) | KKLC step data | See that repository |
| [JPDB](https://jpdb.io) | Frequency data | See their terms |
| [Bluskyo/JLPT_Vocabulary](https://github.com/Bluskyo/JLPT_Vocabulary) | JLPT level lists | CC BY, Jonathan Waller, via tanos.co.uk |
| [hanabira.org-japanese-content](https://github.com/tristcoil/hanabira.org-japanese-content) | Grammar points | Creative Commons, link back to hanabira.org |
| [Jiten](https://jiten.moe) | Per-episode anime vocabulary and speech statistics (`media/`) | [CC BY-SA 4.0](https://jiten.moe/terms), attribution required |
| [AniList](https://anilist.co) | Cover image URLs in `media/` (`cover`) | URLs only, the images stay on AniList's CDN. The artwork belongs to each title's studio and is **not** covered by this repository's license |

If you redistribute the compiled data, verify compliance with all of the above, not only this repository's own license.
