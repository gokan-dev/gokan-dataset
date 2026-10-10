# JLPT vocabulary lists

Two copies of Jonathan Waller's JLPT vocabulary lists ([tanos.co.uk](http://www.tanos.co.uk/jlpt/), CC BY), the
data jisho.org shows. There is no official list since 2010; Waller's is the reference learners meet.
`scripts/jlpt-levels.ts` explains how the two are combined.

| Folder | Source | Snapshot | Licence |
|---|---|---|---|
| `waller-ids/` | [stephenmk/yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab) `original_data/` | `b062d4e38c4bdd0950ae1d4ec55f04b176182e03` | CC BY-SA 4.0 |
| `waller-decks/` | [jamsinclair/open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) `src/` | `1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0` | MIT (data: Waller, CC BY) |

- `waller-ids`: `jmdict_seq,kana,kanji,waller_definition`. Every entry carries a hand-assigned JMdict id. The
  authority for levels.
- `waller-decks`: `expression,reading,meaning,tags,guid`. Waller's Anki decks. Only fills entries the id list
  lacks (顔, 母, 父, 頑張る); its N3 is a looser revision, so it never moves a level. Its `Genki_Ln.N` and
  `Intermediate_Japanese_Ln.N` tags become each word's `textbooks`.

To update, replace the CSVs with a newer snapshot, update the commit above, and run `bun run build:data`. The
build fails on any correction in `data/raw/vocab/jlpt-corrections.json` that no longer matches the lists.
