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

## `compiled/grammar/points/{id}.json` — one file per grammar point

Sourced from [hanabira.org-japanese-content](https://github.com/tristcoil/hanabira.org-japanese-content) (`data/raw/grammar/*.json`, CC license, attribution required). Built by `scripts/build-grammar.ts` (`bun run build:grammar`), which needs `compiled/index/search.json` to already exist (run `build:data` first).

**Word matching reuses `src/utils/tokenizer.ts`'s `SentenceTokenizer`** - the same compound/deinflection-aware matcher `build-data.ts` uses for vocab sentences - rather than a lighter grammar-only pass (an earlier design choice, since reversed for consistency: every sentence in the app, vocab or grammar, is now tokenized identically, so a word click in either place behaves the same way and matches with the same quality). `SentenceTokenizer.extractMatches()` returns dictionary-form matches keyed by term, which `build-grammar.ts` filters to spans covering at least one content-POS token (名詞/動詞/形容詞/副詞 - particles/symbols are never turned into a match even if `SentenceTokenizer` itself would match one), then resolves overlaps exactly like `build-data.ts`'s own vocab pipeline (longest span wins, ties broken by longer literal, then earliest first). As of the last build this resolves 42.1% of tokenized words to a vocab id (up from 39.5% under the old per-token-only matcher), since compounds and conjugated forms (e.g. `通っている` → `通う`, `早かろうが` → `早い`) now merge into one `GrammarExampleWord` instead of being split across several unmatched fragments.

This merging is good for word-to-vocab linking but bad for `patternWordIndices` (below) - a formation's literal marker can get absorbed into the middle of a merged conjugated word and become unfindable. `buildExampleWords` therefore runs `grammar-pattern-matcher.ts`'s `locatePattern` against a **separate, fine-grained** one-word-per-kuromoji-token array (never exposed in the compiled output) and maps the resulting indices back onto the merged `words[]` actually shipped, via a token-to-merged-word index map built while constructing it. This restores pattern-location coverage to exactly its pre-merge baseline (827/828 points, 3248/3310 examples, 99.9%/98.1%) while still getting the word-matching quality improvement.

The upstream `title` bundles the Japanese pattern with a romaji transliteration in a trailing parenthetical (e.g. `"～けど、～ (〜kedo、～)"`) - `build-grammar.ts` splits these apart at build time (`splitTitle`, handling nested parens and full-width（）vs half-width () mismatches) so a consumer can choose independently where to show which, rather than the two being welded into one string. 819/828 points (98.9%) split cleanly as of the last build; the remainder (no trailing parenthetical, or one that sits mid-string rather than at the end) keep their full original string as `title` with no `romaji` rather than a guessed split - logged as a build-time warning, not silently dropped.

`formalityLevel`/`usageNote`/`family` are sourced separately from `data/raw/grammar/formality.json`, a hand-authored, reviewable mapping (`{ [pointId]: { formalityLevel?, usageNote?, family?: { id, name } } }`) merged in at build time rather than computed - most points have no close synonym and simply aren't present in it. A point only declares its own `family.id`/`family.name`; `family.relatedPoints` on the compiled output is DERIVED by grouping every mapping entry that shares the same `family.id` (a build error if the same id is used with two different names - a real authoring mistake, not something to silently accept). Also emitted as `compiled/grammar/index/families.json` (`Record<familyId, { name, memberIds }>`), mirroring `index/jlpt.json`'s shape, so a consumer can list every family without scanning all 828 point files. Written in original wording; specific formality/nuance claims are checked against freely-accessible references (cited in the authoring commit/PR, not embedded in the data) rather than copied from any single copyrighted source. A point id in the mapping that doesn't match any built point logs a build-time warning rather than silently doing nothing.

```ts
interface GrammarPoint {
  id: string;              // assigned at build time, e.g. "n5-001" - the upstream dataset has no ids of its own
  title: string;           // Japanese/pattern portion only, e.g. "～けど、～" - split from the upstream title's trailing romaji parenthetical (see above)
  romaji?: string;         // e.g. "kedo" - absent for the ~1.3% of points with no trailing parenthetical to split
  jlptLevel: number;       // 1 (N1) .. 5 (N5) - every grammar point has one, unlike vocab
  shortExplanation: string;
  longExplanation: string;
  formation: string;       // e.g. "Noun + が + いちばん + Adjective/Verb"
  examples: GrammarExample[];
  formalityLevel?: 'casual' | 'neutral' | 'polite' | 'formal' | 'very-formal-literary'; // register, for points that have one - most don't
  usageNote?: string;      // short, quiz-card-length line covering whatever actually disambiguates this point from its near-synonyms (usually register, sometimes connotation/nuance instead)
  family?: {                // the named near-synonym family this point belongs to, if any
    id: string;              // stable slug, e.g. "contradiction" - shared by every member
    name: string;             // display name, e.g. "Contradiction (But / However)"
    relatedPoints: string[]; // ids of the OTHER points in this family (derived at build time from every entry sharing this family.id, not hand-maintained)
  };
}

interface GrammarExample {
  jp: string;
  romaji: string;
  en: string;
  words: GrammarExampleWord[]; // tokenized `jp`, in order - concatenating every `surface` reconstructs `jp` exactly
  patternWordIndices: number[]; // indices into `words[]` that are this grammar point's literal, invariant markers (が/いちばん for "Noun + が + いちばん + Adjective/Verb") - located at build time by scripts/grammar-pattern-matcher.ts, matching `formation`'s literal Japanese against `words[]` surface/baseForm/reading. Always present; empty when the pattern couldn't be confidently located in this specific example (99.9% of points have at least one non-empty example as of the last build - see the pattern-location issue for the one documented exception and the matching methodology).
}

interface GrammarExampleWord {
  surface: string;
  vocabId: string | null;  // resolved against compiled/index/search.json; null for particles/symbols/unmatched, which are never turned into a fill-in-the-blank
  reading?: string;         // matched vocab's primary reading; only set when vocabId is set
  baseForm?: string;        // kuromoji's dictionary/base form (e.g. "思う" for the conjugated token "思っ"), only set when it differs from `surface`. Lets pattern-location (and any future consumer) match a formation's dictionary-form literal against a conjugated token without fuzzy/edit-distance matching.
}
```

## `compiled/grammar/index/jlpt.json` — grammar points by JLPT level

```ts
type GrammarJlptIndex = Record<number, string[]>; // level (1..5) -> grammar point ids, in the source's original (alphabetical) order - grammar has no frequency data to sort by
```

## `compiled/grammar/index/families.json` — named near-synonym families

```ts
type GrammarFamilyIndex = Record<string, { name: string; memberIds: string[] }>; // familyId -> display name + every member point id
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
