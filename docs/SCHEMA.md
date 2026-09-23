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
  jlptLevel?: number;             // 1 (N1, hardest) .. 5 (N5, easiest). Most entries have none - JMDict has ~40k+ words, the JLPT list covers ~8k. Matched on any of the word's written forms, then on its primary reading (for usually-kana words the JLPT list files under kana, e.g. 鞄 as かばん); see resolveJlptLevel.
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
  kind: 'construction' | 'inflection' | 'lexical'; // the NATURE of the point - which exercise can test it. See below.
  derives?: string;        // inflection only: which derivation it teaches, e.g. "て-form"
  examples: GrammarExample[];
  formalityLevel?: 'casual' | 'neutral' | 'polite' | 'formal' | 'very-formal-literary'; // register, for points that have one - most don't
  usageNote?: string;      // short, quiz-card-length line covering whatever actually disambiguates this point from its near-synonyms (usually register, sometimes connotation/nuance instead)
  family?: {                // the named near-synonym family this point belongs to, if any
    id: string;              // stable slug, e.g. "contradiction" - shared by every member
    name: string;             // display name, e.g. "Contradiction (But / However)"
    relatedPoints: string[]; // ids of the OTHER points in this family (derived at build time from every entry sharing this family.id, not hand-maintained)
    axis?: 'register' | 'constraint' | 'variant'; // WHAT this member adds over its siblings - see below
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

### `kind` — the nature of a point, and which exercise can test it

The discriminating test is about the **answer key**, not the text:

> **Can you write the correct answer without knowing which word it attaches to?**

| kind | test | example | testable by |
|---|---|---|---|
| `construction` | **yes** — identity is a fixed string | `ので`, `しか〜ない`, `ことがある` | cloze on the marker |
| `inflection` | **no** — identity is an operation; the answer differs per input word | て-form: 飲む→飲んで, 食べる→食べて, する→して | transformation drill only |
| `lexical` | yes, but the answer is one dictionary word | `いつも`, `ほとんど` | cloze (arguably vocabulary) |

Counts as of the last build: **768 construction, 20 inflection, 0 lexical** (`lexical` not yet populated).

**Presupposing a form is not the same as teaching one.** 339 of 788 points have a `formation` that presupposes a conjugated form; only 20 teach a derivation. `Verb たほうがいい` consumes the past tense — its answer key is always `ほうがいい`, so it is a construction. `Verb て～` *is* the て-form — its answer key is a different string for every verb, so it is an inflection.

That is why the classification is hand-authored in `data/raw/grammar/kinds.json` and not detected. Mechanical signals were measured and all over-fire, because most Japanese grammar attaches to a conjugated word:

```
anchor surface varies across examples : 284 / 788
anchor includes a conjugated word     : 386 / 788
formation mentions a stem/form        : 135 / 788
union of the above                    : 464 / 788  (59% - useless)
```

Only explicit derivation language (`→`, `Replace`, `Group 1/2/3`, `godan`/`ichidan`) narrows it to a reviewable 40 candidates, of which 20 survive the answer-key test.

Why it matters: `inflection` points cannot be tested by the cloze quiz, and the dataset proves it — `n1-178` (the potential form) is the **only** point in 828 with no locatable pattern, and it is a conjugation rule. The other 19 do get an anchor, but it is the wrong thing: `n5-046` (the て-form, presupposed by 74 later points) anchors on `て`, so the quiz blanks a fixed kana instead of asking for the conjugation.

Authoring rules: only non-`construction` points appear in `kinds.json`; anything absent defaults to `construction`. An `inflection` entry **must** carry `derives` (the build fails otherwise), because that is what a transformation quiz keys off. An id in the file that no point was built for is also a build failure.

### `family.axis` — what a member adds over its siblings

70 of the 84 families span more than one JLPT level, so level alone cannot say whether two siblings may be taught together. `axis` records what the member actually adds, which does:

| value | meaning | consequence |
|---|---|---|
| `register` | differs ONLY by formality | groups **across** levels - だが (N2) belongs beside でも (N5), because once you know でも it is a one-line register fact with no new structure |
| `constraint` | adds a semantic restriction that can be got wrong | stays level-gated as an escalation ladder (だけ → しか〜ない → しかない → に過ぎない) |
| `variant` | no differentiator exists; siblings are interchangeable stylistic choices | one recognition set, not N independent points |

`constraint` is the deliberate default for anything ambiguous, because it is the conservative choice: it leaves the point where its JLPT level puts it. `variant` is detected exactly (the `usageNote` is byte-identical to a sibling's - 9 of the 12 `regardless-a-or-b` members share one verbatim). The `register`/`constraint` split is seeded from the wording of each `usageNote` and **has not yet had a full hand pass**; see the grammar-axis issue.

`axis` also tells a consumer *what to say* when introducing the point, which is the other half of making adjacency safe: proximity without a stated differentiator is worse than scattering.

## `compiled/grammar/conjugations.json` — drill items for the inflection points

Answer keys for the transformation quiz, one entry per `kind: 'inflection'` point. Built by `scripts/build-conjugations.ts` (`bun run build:conjugations`, chained from `build:grammar`).

```ts
type GrammarConjugations = Record<string, {   // grammar point id
  form: ConjugationForm;      // 'te' | 'tai' | 'zu' | 'chatta' | 'toku' | 'causative'
                              // | 'causative-passive' | 'passive' | 'potential'
                              // | 'i-adj-adverbial' | 'i-adj-te'
                              // | 'i-adj-negative-polite' | 'na-adj-adverbial'
  formLabel: string;          // shown to the learner, e.g. "て-form"
  items: {
    vocabId: string;          // keyed on the vocab id, not the surface, so 入る (はいる/いる) is unambiguous
    lemma: string;            // 飲む
    lemmaReading: string;     // のむ
    target: string;           // 飲んで
    targetReading: string;    // のんで  - accepted as an alternative answer
    alternatives?: string[];  // other correct answers, e.g. 書かされる for the causative-passive
    wordClass: 'godan' | 'ichidan' | 'irregular' | 'i-adjective' | 'na-adjective';
  }[];
}>;
```

**No authored Japanese.** Lemmas come from the frequency-ordered vocab index; targets are computed by `src/utils/conjugator.ts`, which is tested per form × class.

Class detection uses kuromoji's `conjugated_type`, which already encodes the て/た euphony subtype — the part that makes Japanese conjugation hard:

```
書く → 五段・カ行イ音便   (書いて)      行く → 五段・カ行促音便   (行って)
買う → 五段・ワ行促音便   (買って)      帰る → 五段・ラ行  走る → 五段・ラ行
```

Four things it cannot do, handled explicitly:

- **`する` comes back as 五段・ラ行**, colliding with 擦る (a real godan ラ行 verb also read する). Irregulars come from a hardcoded table. `する` is also *injected* into the inventory, since the vocab index carries it as 為る at position ~18,200.
- **な-adjectives are 名詞 with `conjugated_type: '*'`** — detected from `pos_detail_1 === '形容動詞語幹'`.
- **Passive and potential exclude ichidan verbs.** 食べられる is *both*, so an ichidan item cannot say which form was asked. Godan keeps them distinct (書かれる vs 書ける).
- **Morphology cannot judge plausibility.** 見えたい is derivable and is not Japanese, because 見える is already stative. Stative verbs are excluded from the forms needing a volitional agent (たい, causative, causative-passive, potential). 分かる is also excluded from the potential, where 分かれる collides with 分かれる/別れる.

Build guards: every inflection point must have a form mapping and at least 6 items, and a target identical to its lemma fails the build.

## `compiled/grammar/index/aliases.json` — deduplicated point ids

40 points in the upstream files are the same pattern ingested twice, usually at two different JLPT levels (`～ても` appears as both `n3-052` and `n4-097`; `Verb ることができる` as both `n5-059` and `n4-065`). They are self-documented: the authored `usageNote` on each flags it. `data/raw/grammar/duplicates.json` (`{ [droppedId]: { canonical, note } }`) maps each one to the surviving point, and the build emits the flattened mapping here.

The **canonical is the member a learner meets first** - the easiest level, i.e. the *highest* `jlptLevel` (5 = N5). Ties resolve to the lower id. Chains are collapsed when the file is authored (three existed: `n3-114` → `n3-112` → `n4-059`, all `ように`), and the build hard-errors if any canonical is itself a duplicate, or if a canonical names a point that was never built.

```ts
type GrammarAliasIndex = Record<string, string>; // dropped point id -> surviving canonical id
```

**Ids are never renumbered.** They are positional (`n5-001` = first entry in the N5 raw file), so dropping a duplicate leaves the id space sparse rather than shifting its neighbours. Consumers store these ids against user progress, so this is a guarantee, not an implementation detail. A consumer holding progress against a dropped id should transfer it to the canonical rather than stranding an item it can no longer load.

Dropped points are not emitted to `points/`, do not appear in `index/jlpt.json`, and are excluded from `family.relatedPoints` and `families.json`.

## `compiled/grammar/index/teaching-order.json` — the curriculum

The order in which points should be **introduced**, replacing `index/jlpt.json`'s alphabetical order for that purpose. Built by `scripts/build-curriculum.ts` (`bun run build:curriculum`, chained from `build:grammar`) from the authored spine at `data/curriculum/chapters.json` and the authored themes at `data/curriculum/themes.json`.

```ts
interface GrammarTeachingOrder {
  order: string[];              // every surviving point id, in introduction order (the flattening of `chapters`)
  chapters: GrammarChapter[];
}

interface GrammarChapter {
  id: string;                   // stable slug, e.g. "n5-c17" - safe to store against user progress
  title: string;                // e.g. "But: one meaning, many registers"
  summary: string;              // what the chapter teaches, and why these points sit together
  jlptLevel: number;            // the chapter's POSITION in the curriculum, not a claim about every member's own level
  points: string[];             // member ids, in teaching order
}
```

Why this exists: `index/jlpt.json` follows the upstream files' alphabetical order, which puts the superlative first, then seven near-synonymous connectives (five of them meaning "well then"), and the case particles at positions 40+ (`Noun は` #40, `Noun を` #43, `Verb て` #46). For comparison, Genki reaches は and basic verb conjugation in chapter 3 of 23.

Two tiers, deliberately:

- **N5 and N4 are hand-sequenced** in `chapters.json` (40 chapters), because at those levels points genuinely depend on each other - `Verb た ことがある` is unteachable before the た-form.
- **N3/N2/N1 chapters are generated** by clustering the remainder by family, then placing unfamilied points into the authored **themes** at `data/curriculum/themes.json`. Above N3 the points are largely independent idiomatic expressions with no dependency chain. This tier is intentionally coarser: a theme does not sequence its points against each other, it only guarantees the chapter has a subject.

Themes replaced an alphabetical dump that put 315 points (42% of the dataset) into 18 buckets of 20 named "Further N2 patterns (3 of 5)" - one bucket held `にほかならない`, `ということ`, "whenever", "before" and "based-on" side by side for no reason beyond adjacent ids. That fallback still exists in `build-curriculum.ts` and anything unthemed lands in it, but it is **empty** against the dataset as it stands, and the build names every unthemed point so a newly-added one is visible rather than silently dumped. Current shape: **145 chapters, median 5 points, max 12** (was 117 chapters, max 20).

A tier-1 chapter may declare `absorbRegisterFamilies`, which folds in the `axis: 'register'` members of those families **from any level** - the mechanism that puts だが (N2) in an N5 chapter. Absorption is capped at 3 levels of distance (2 for `very-formal-literary`), a guardrail over the not-yet-hand-reviewed `axis` values: `Verbる べからざる Noun` (N1) reads as "formal, literary" and was classified `register`, but it is an archaic noun-modifying form with no place in an N4 chapter. Points held back this way are listed at build time as hand-correction candidates. `constraint` members are never absorbed.

In tier 2 the same question is settled automatically, per family, by the **absorb-vs-level-gate rule**. A family spread across N3-N1 is taught either as one chapter holding the whole ladder, or as one chapter per level:

- **Absorbed** when it is a *pure register ladder* (no `constraint` member) of **at most 6** members. The chapter is placed at its easiest member's level, easiest register first. This is the only way the ladder is ever visible whole.
- **Level-gated** otherwise, and the chapter titles carry the level (`"N2: Concession (Even Though / Although / Despite)"`) so three chapters do not share one name. Cross-level relationships then live on the family page rather than in a chapter.

The size test is over the **whole** family, not just its register members: splitting a mixed family into an absorbed register half and a level-gated constraint half fragments it worse than either rule alone. Absorbing concession would mean 11 forms at once, which is why the cap exists. 12 ladders are absorbed and 35 families level-gated as of the last build.

**Every surviving point appears in exactly one chapter, and the build fails if not** - a point missing from the order would simply never be introduced, with nothing erroring at runtime.

## `compiled/grammar/index/jlpt.json` — grammar points by JLPT level

```ts
type GrammarJlptIndex = Record<number, string[]>; // level (1..5) -> grammar point ids, in the source's original (alphabetical) order - grammar has no frequency data to sort by
```

## `compiled/grammar/index/families.json` — named near-synonym families

```ts
type GrammarFamilyIndex = Record<string, { name: string; memberIds: string[] }>; // familyId -> display name + every member point id
```

## `compiled/grammar/index/contrasts.json` — situational disambiguation lessons

Answers the question a `usageNote` cannot: *given a real situation, which member do I reach for, and why not the obvious alternative?* から and ので both gloss as "because", but only ので fits an apology. That fact is contrastive and lives in neither point's own entry.

Authored by hand (AI-drafted, human-reviewed) in `data/raw/grammar/contrasts.json` and compiled by `build-grammar.ts`'s `compileContrasts` (pure, unit-tested). A family is partitioned into confusability-first **chunks** (small groups of members - target 5-6, soft cap - close enough to be actively disambiguated together, like interleaving look-alike kanji; a small family can be one chunk, a large one is split); each chunk carries directed **units** (the lessons), and a lesson is always a subset of its chunk.

```ts
type GrammarContrastIndex = Record<string, {   // familyId ->
  name: string;                                 // the family's display name (copied from families.json for convenience)
  chunks: {
    id: string;                                 // stable slug within the family, e.g. "reason-core"
    label: string;                              // short display label, e.g. "から / ので"
    memberIds: string[];                        // the confusable members grouped here
    units: {                                    // the lessons; focus/vs are a subset of memberIds
      focus: string;                            // the member this unit teaches the learner to reach for
      vs: string[];                             // the sibling(s) `focus` is most confused with
      situation: string;                        // a concrete situation where the choice matters
      guidance: string;                         // which member fits, and why the obvious alternative does not
    }[];
    anchorChapterId?: string;                   // chapter this chunk's lesson can first be taught in
  }[];
  interchangeable?: string[];                   // `variant`-axis members: no lesson, a note instead
}>;
```

Coverage as of the last build: **66 families, 97 chunks, 141 units**, plus interchangeable-member notes on 2 families.

A unit is **directed**: `focus` is the member met LATER in the teaching order, so by the time it is introduced the `vs` siblings are already known and the contrast lands between two real memories. The consumer surfaces a unit at `focus`'s introduction (deferring it if a `vs` sibling isn't known yet) and on a revisitable family page.

`anchorChapterId` is stamped by `build-curriculum.ts`, which is the only step that knows the chapters: it is the chapter of whichever member the chunk introduces last, so it is the earliest point at which every member the lesson names is a real memory. The curriculum design work assumed the stronger rule that a chunk may not span chapters at all; that rule would delete the から/ので lesson this section opens with (から is introduced in `n5-c16`, ので in `n4-c12`), so what is enforced instead is the invariant that actually carries the weight: **a unit's `focus` may never be introduced before one of its `vs` siblings**, a build error in `build-curriculum.ts`. Chunks that do span chapters are counted in the build output (3 of 97 currently), because a chunk confined to one chapter is still the better shape wherever it is achievable.

`interchangeable` lists the family's `variant`-axis members, when it has two or more. Those siblings have no differentiator, so they can never carry a lesson (a build error) - but silence is worse than a one-line note: a learner who meets ten near-identical literary forms with no comment will assume a distinction exists and go looking for one. Render it as "these are interchangeable, pick by feel", not as a lesson. A family may have this and **no chunks at all**, which is the normal shape for a pure variant family, so `chunks: []` is not a bug.

Validation is strict (each is a build error, not a silent drop): `focus`/`vs`/`memberIds` must be genuine, non-dropped members of the family; a unit may never reference a `variant`-axis point; `vs` must be non-empty and exclude `focus`; every `focus`/`vs` id must be in its own chunk's `memberIds` (a lesson is a subset of its chunk); `situation`/`guidance` must be non-blank; and no `focus` may precede its `vs` in the teaching order. A chunk larger than the soft cap (8) warns rather than failing, so a coherent register ladder (the "but" family is 7) is allowed.

### `GrammarPoint.slot` — syntactic position, for interchangeability grading

A point may carry `slot?: 'clause-final' | 'sentence-initial' | 'predicate-final' | 'pre-noun' | 'adverbial'`, authored in `formality.json`. It exists so a consumer can decide whether one family sibling can grammatically stand in for another: two near-synonyms are interchangeable in a cloze blank only if they fill the **same slot**. けど (clause-final) and でも (sentence-initial) share the "but" family and the same gloss, but でも cannot drop into a clause-final けど blank, so that substitution must grade wrong, not as a minor register slip. Populated for family members that could plausibly be swapped; absent elsewhere.

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
