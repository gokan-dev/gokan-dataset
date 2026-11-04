# Multilingual benchmark: research scripts and outputs

The scripts and results behind "What the benchmark measured" in [../MULTILINGUAL.md](../MULTILINGUAL.md), run on 2026-11-03 and 2026-11-04 against the compiled dataset of that week. They are research code, kept so the work is not lost:
- **Phase 4** turns them into the pipeline's benchmark stage, and replaces the shortcuts noted below.
- **Phase 5** starts the gold-set review from `review-sheet.tsv`.

They are not part of the build. They sit outside `tsconfig.json`'s `include`, so nothing typechecks or tests them.

## Files

| File | Measures | Reads | Writes |
|---|---|---|---|
| `tatoeba-zh-coverage.ts` | Japanese-Mandarin pairs kept by the direction rule; words with a first-hand Chinese sentence, per JLPT level | `<compiledDir>`, `<tatoebaDir>` | stdout |
| `wikt-zh-coverage.ts` | Words matching a Chinese Wiktionary entry by spelling and reading, with a sample to check by hand | `<compiledDir>`, the two Chinese Wiktionary files | stdout |
| `fetch-wiki-sources.ts` | Fetches Wikidata lexemes linked to a concept, and that concept's Chinese labels | `<compiledDir>` | `<outDir>/wikidata.json` |
| `fetch-wikipedia-links.ts` | Fetches the Chinese article linked to each JLPT headword's Japanese article, through Wikidata's sitelinks | `<compiledDir>` | `<outDir>/wikipedia.json` |
| `zh-benchmark.ts` | Coverage per source and level, what each source adds, agreement between sources, corroboration of Chinese Wiktionary | `<compiledDir>`, `<root>` (layout below) | stdout, `<root>/benchmark/review-sheet.tsv` |
| `report.txt` | `zh-benchmark.ts`'s output from the 2026-11-04 run | | |
| `review-sheet.tsv` | The 300 words of the gold-set draft (60 per JLPT level, seed 20261104), with what every source says about each | | |

Each script prints its usage line when it is run without arguments.

## Inputs

None of these are committed. They are large, and phase 4 decides how snapshots are stored (see Open questions in the design).

- **Tatoeba**, the week of 2026-11-03: `jpn_sentences.tsv`, `cmn_sentences.tsv` and `jpn-cmn_links.tsv` from `https://downloads.tatoeba.org/exports/per_language/`, and `sentences_base.csv` from `https://downloads.tatoeba.org/exports/sentences_base.tar.bz2`.
- **Chinese Wiktionary's Japanese entries**, kaikki.org's extraction of the 2026-11-01 dump:
  - [日語](https://kaikki.org/zhwiktionary/%E6%97%A5%E8%AA%9E/index.html), saved as `ja-trad.jsonl`;
  - [日语](https://kaikki.org/zhwiktionary/%E6%97%A5%E8%AF%AD/index.html), saved as `ja-simp.jsonl`.
- **Japanese Wiktionary**, the same dump:
  - [日本語](https://kaikki.org/jawiktionary/%E6%97%A5%E6%9C%AC%E8%AA%9E/index.html), saved as `ja.jsonl`, for the translation tables;
  - [中国語](https://kaikki.org/jawiktionary/%E4%B8%AD%E5%9B%BD%E8%AA%9E/index.html), saved as `zh.jsonl`, for the Chinese entries read backwards.
- **Wikidata**, queried by the two fetch scripts.

`zh-benchmark.ts` expects them under one `<root>`:

```
<root>/wiktionary/ja-trad.jsonl, ja-simp.jsonl
<root>/jawiktionary/ja.jsonl, zh.jsonl
<root>/sources/wikidata.json, wikipedia.json
```

## Shortcuts to replace in phase 4

- **Script conversion runs on Windows only.** `zh-benchmark.ts` converts Traditional characters to Simplified by calling Windows' `StrConv` through PowerShell, character by character. Phase 4 uses whatever transform decision D3 allows.
- **The Wikipedia part of `fetch-wiki-sources.ts` was rate-limited** by the Wikipedia API. `fetch-wikipedia-links.ts`, which goes through Wikidata's SPARQL endpoint instead, is the one that produced `wikipedia.json`.
- **JSON is cast, not parsed.** The scripts read every input with `JSON.parse(...) as T`. A build stage parses its inputs at the boundary, as the rest of the pipeline does.
