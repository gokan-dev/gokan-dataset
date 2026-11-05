# Multilingual benchmark

Two things live here: the benchmark the build runs (build check 9 in [../MULTILINGUAL.md](../MULTILINGUAL.md)), and the research scripts and results it came from, run on 2026-11-03 and 2026-11-04 against the compiled dataset of that week.

## The build's benchmark (phase 4)

| File | What it is |
|---|---|
| `report.md` | Written by `bun run build:benchmark` (the last step of `bun run build`) from `compiled/`: coverage per source and JLPT level, corroboration across communities, first-hand sentence coverage. No date, so an unchanged dataset leaves it unchanged. Do not edit it: rebuild. |
| `floors.json` | Each guarded number's floor. `bun run check:benchmark` fails when a number falls below its floor. Set from a run with `bun scripts/benchmark.ts --set-floors` (a percentage one point below the measured value, a count 2% below), and changed only on purpose, in a reviewed diff. |

The code is `scripts/benchmark.ts` (reads `compiled/`) and `src/text/benchmark.ts` (the numbers, pure and tested). The sources it measures are read by `bun run build:text` (`scripts/build-text.ts`) from their snapshots in `data/sources/`.

## The research behind it (2026-11-03 and 2026-11-04)

Kept so the work is not lost; **phase 5** starts the gold-set review from `review-sheet.tsv`. These scripts are not part of the build: they sit outside `tsconfig.json`'s `include`, so nothing typechecks or tests them, and the build's benchmark replaced them.

| File | Measures | Reads | Writes |
|---|---|---|---|
| `tatoeba-zh-coverage.ts` | Japanese-Mandarin pairs kept by the direction rule; words with a first-hand Chinese sentence, per JLPT level | `<compiledDir>`, `<tatoebaDir>` | stdout |
| `wikt-zh-coverage.ts` | Words matching a Chinese Wiktionary entry by spelling and reading, with a sample to check by hand | `<compiledDir>`, the two Chinese Wiktionary files | stdout |
| `zh-benchmark.ts` | Coverage per source and level, what each source adds, agreement between sources, corroboration of Chinese Wiktionary | `<compiledDir>`, `<root>` (layout below) | stdout, `<root>/benchmark/review-sheet.tsv` |
| `report.txt` | `zh-benchmark.ts`'s output from the 2026-11-04 run | | |
| `review-sheet.tsv` | The 300 words of the gold-set draft (60 per JLPT level, seed 20261104), with what every source says about each | | |

The two fetch scripts that queried Wikidata moved to `scripts/` as the sources' fetch scripts, `scripts/fetch-wikidata-lexemes.ts` and `scripts/fetch-wikipedia-links.ts`; they now write the snapshots in `data/sources/wikidata/` and `data/sources/wikipedia/`. The research version's Wikipedia API part, rate-limited and never used, was dropped.

Each research script prints its usage line when it is run without arguments. They read the same inputs as the build, uncompressed, under one `<root>`:

```
<root>/wiktionary/ja-trad.jsonl, ja-simp.jsonl     (data/sources/zhwiktionary/kaikki-ja-trad.jsonl.gz, kaikki-ja-simp.jsonl.gz)
<root>/jawiktionary/ja.jsonl, zh.jsonl             (data/sources/jawiktionary/kaikki-ja.jsonl.gz, kaikki-zh.jsonl.gz)
<root>/sources/wikidata.json, wikipedia.json       (data/sources/wikidata/lexemes-zh.json.gz, data/sources/wikipedia/ja-zh-sitelinks.json.gz)
<tatoebaDir>/*.tsv, sentences_base.csv             (data/sources/tatoeba-cmn/)
```

### What the build does differently

- **Script conversion** is Unihan's kSimplifiedVariant, character by character, on every machine (decision D3), not Windows' `StrConv`.
- **Inputs are parsed at the boundary** (`src/text/kaikki.ts`, `wikimedia.ts`), not cast.
- **The reverse dictionary attaches on a whole gloss or a whole 、-separated part only**, as the design says; the research script split glosses at every punctuation mark, which attached 久闊 to また (又).
- **A verbal noun read as its verb** (検索 as けんさくする, in both Wiktionaries) is read as the noun.
