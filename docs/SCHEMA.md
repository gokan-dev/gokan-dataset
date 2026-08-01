# Data format

Everything under `compiled/` is plain, static JSON - no runtime, no auth, no rate limits. Fetch it directly (e.g. via a CDN in front of this repo, or your own copy) or read it from a clone/submodule. Field types below are TypeScript, mirrored exactly in [`src/models/`](../src/models).

## `compiled/vocab/{id}.json` — one file per word

One file per vocabulary entry, keyed by its JMDict word ID (`id` in the filename and in the JSON body agree).

```ts
interface Vocabulary {
  id: string;                    // JMdict word ID (stable)
  writtenForm: {
    kanji: string;                // primary written form
    alternatives: string[];       // alternative kanji writings
    containedKanji: string[];     // the kanji characters used in `kanji`
  };
  reading: {
    primary: string;              // main reading
    alternatives: string[];       // other valid readings (rare/secondary)
  };
  frequency: {
    kanjiRank: number;            // JPDB frequency rank
    kanaRank?: number;
  };
  jlptLevel?: number;             // 1 (N1, hardest) .. 5 (N5, easiest). Most entries have none - JMDict has ~40k+ words, the JLPT list covers ~8k.
  progression: {
    kklcStep: number;             // KKLC (Kanji Kentei) chapter step this word's kanji require. 99999 if its kanji fall outside the KKLC index.
  };
  components?: string[];          // IDs of other vocab entries contained within this one
  parents?: string[];             // IDs of vocab entries this word is a component of
  senses: Sense[];
  usageHints?: {
    examplePattern?: string;      // e.g. "〜中", "Xの中"
    requiresContext: boolean;     // true if the reading is ambiguous without context
  };
  mergedVocabs?: MergedVocabInfo[]; // present if this entry absorbed one or more homographs sharing the same kanji form - see below
  isCommon: boolean;              // true if JMDict marks this word (or an absorbed homograph) as common. Not declared on the shared TS type but present on every emitted file.
}

interface Sense {
  pos: string[];                  // part(s) of speech for this sense
  misc: {
    isAbbreviation?: boolean;
    isSuffix?: boolean;
    isPrefix?: boolean;
    isArchaic?: boolean;
    isRare?: boolean;
    rawTags: string[];             // original JMDict tags, kept for reference
  };
  glosses: string[];               // English meanings for this sense
  related: { compounds: string[] }; // related compound words, e.g. 中学校, 中国
  appliesToReadings?: string[];    // if set, this sense only applies to these specific readings (see mergedVocabs)
}

interface MergedVocabInfo {
  id: string;                      // the original JMDict ID this reading came from, pre-merge
  isBase: boolean;                 // true for the highest-frequency entry that absorbed the others
  originalPrimaryReading: string;
  originalGlosses: string[];
}
```

**Homographs**: JMDict lists some words as separate entries purely because they share a kanji form with different readings/meanings (e.g. 上手, 上手い). The build pipeline merges these into a single `Vocabulary` entry keyed by the highest-frequency reading, keeping each absorbed reading's own senses (tagged via `appliesToReadings`) and a `mergedVocabs` audit trail of what was merged in.

## `compiled/sentences/{vocabId}.json` — example sentences, one file per word

Only vocab with at least one matched sentence get a file (most files: 3-5 sentences; not every word has one).

```ts
type SentenceFile = Sentence[];

interface Sentence {
  id: string;                      // source sentence ID
  original: string;                // Japanese text
  en: { id: string; text: string }[]; // one or more English translations
  indices?: string;                 // reading hints/furigana, if available
  vocabIds: string[];               // every vocab entry (by id) found in this sentence
  matches?: Record<string, { start: number; length: number; reading?: string }[]>;
  // ^ vocabId -> where it occurs in `original` (character offset + length), for highlighting.
  //   An array because a word can appear more than once in the same sentence.
}
```

## `compiled/kanji.json` — flat array, all kanji

```ts
type KanjiFile = Kanji[];

interface Kanji {
  character: string;
  steps: {
    kklc?: number;      // KKLC chapter step
    jlpt?: number;       // 1 (N1) .. 5 (N5) - only ever set for kanji already in the KKLC set
    frequency?: number;  // reserved, currently unused
  };
  frequency?: number;    // JPDB kanji frequency rank
}
```

## `compiled/index/*.json` — lookup indexes

Precomputed so consumers don't have to scan the full `vocab/`/`kanji.json` for common lookups.

| File | Shape | What it's for |
|---|---|---|
| `frequency.json` | `Array<{ id: string; containedKanji: string[] }>` | All vocab, sorted by frequency rank. |
| `kklc.json` | `Record<kklcStep, vocabId[]>` | Vocab grouped by the KKLC step that unlocks them. |
| `kklc-kanji.json` | `Record<kklcStep, character[]>` | Kanji grouped by KKLC step. |
| `jlpt.json` | `Record<jlptLevel, Array<{ id: string; containedKanji: string[] }>>` | Vocab grouped by JLPT level (1=N1..5=N5), frequency-sorted within a level. Levels are keys `"1"`..`"5"`. |
| `kanji-vocab.json` | `Record<character, vocabId[]>` | Reverse index: which vocab entries contain a given kanji, frequency-sorted. |
| `search.json` | `Array<{ id, w: string, r: string, m: string }>` | Compact full-text search index: `w`=kanji, `r`=reading, `m`=first sense's glosses joined by ", ". |
| `merged-map.json` | `Record<oldId, newId>` | Maps a homograph's original JMDict ID to the merged entry's ID it now lives under (see `mergedVocabs` above). |

## Notes for consumers

- IDs are JMDict word IDs (strings, but numeric) - stable across rebuilds unless upstream JMDict removes an entry outright.
- `kklcStep`/kanji `steps.kklc` of `99999` is a sentinel meaning "outside the KKLC index" (falls back to frequency-only ordering), not a real step number.
- This is a snapshot, not a live feed - there's no versioning/changelog per release yet. Pin to a commit SHA (or, once tagged, a release) if you need reproducibility.
- Licensing: see [README.md](../README.md) - this is a derivative of several upstream sources (JMDict, KKLC, JPDB, Tatoeba), each with their own terms.
