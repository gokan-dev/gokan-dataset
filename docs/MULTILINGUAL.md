# Explanation languages: the multilingual model

**Status: design proposed 2026-11-04; built through phase 4 (Chinese, 2026-11-05), see each phase's "as built" note.** This is the plan the dataset follows to explain Japanese in more than one language, Chinese first. The open decisions are listed at the end; settle them here, in this file, so the reasoning stays next to the model.

Decided so far (2026-11-04):

- **One dataset for both apps.** It stays the single source of truth, identical for gokan-srs and gokan-dictionary. There is no frozen copy for one app beside a new layout for the other: every change of layout ships with both apps adapted to it.
- **gokan-srs keeps using English only**, with no change in behaviour. gokan-dictionary is where new languages appear.
- **Language tags are lowercase everywhere**: `en`, `zh-hans`, `zh-hant`, `nan`, in the data, file paths, URLs and HTML `lang` attributes.
- **gokan-dictionary's direction**: it will render pages on request (SvelteKit with `csr = false`, so no JavaScript of its own reaches the browser, in a Lambda behind CloudFront's cache) instead of uploading prerendered pages. That is an app decision, recorded here because the dataset must support it (see Consumers).

## Why the dataset changes

Today English is not one language among others, it is the dataset's notion of meaning:

- a word's sense *is* its English glosses (`senses[].glosses`); a sense has no identity of its own, only a position;
- a sentence carries an `en` array, a kanji a `meanings` list that is English (KANJIDIC2's English, while the vendored file's French, Spanish and Portuguese are dropped);
- grammar explanations, usage notes, family names, lessons and cases are English prose;
- derived data is computed from English: near-synonyms are pairs of words sharing an English gloss (手紙 lists 音, a sound, as interchangeable with it, because both are glossed "note"), and `index/search.json` searches English.

Adding Chinese as more fields beside these would keep English the master: every other language would be a column hanging off it. The goal is the opposite: any number of explanation languages, all handled by one mechanism, so that adding the fourth language costs what the second did and adding data never means touching a language.

## Principles

1. **Japanese is the core.** What is studied (headwords, readings, kanji, sentences, grammar patterns) and the language-neutral facts about it (ids, codes, levels, relations, audio) are stored once.
2. **Every explanation language is a text layer, English included.** English becomes `en`, handled exactly like `zh-hans` or `fr`.
3. **First hand only.** Imported text must be written by its source directly from the Japanese (or the Japanese from it). Gokan never translates from one explanation language into another, by machine or otherwise. Only an allowlist of mechanical transforms applies (see decision D3).
4. **One mechanism for every entity.** A word, a kanji, a sentence, a grammar point, a tag label: the same text type, the same provenance, the same review, the same compiled layout.
5. **Measured, not assumed.** Whether a source helps, and whether two sources agree, is measured by a benchmark that runs with the build.

## Standards

No single standard covers a multilingual learner's dataset; each part has an established one, and the model is built from them.

| Concern | Standard | What we take from it |
|---|---|---|
| Modelling a multilingual lexicon | [OntoLex-Lemon](https://www.w3.org/2016/05/ontolex/) (W3C community report; Wikidata's lexemes implement it) | The vocabulary: lexical entry, form, sense, concept. Its *vartrans* module for links between languages, categorised as direct, cultural or lexical equivalents. |
| Naming languages | [BCP 47](https://www.rfc-editor.org/info/bcp47) | Every language is a tag, written in lowercase: `en`, `ja`, `fr`, `zh-hans`, `zh-hant`. JMdict's `eng`/`ger` and KANJIDIC2's `en`/`fr` are normalised at import. |
| Language on every string | W3C [Strings on the Web](https://www.w3.org/TR/string-meta/); JSON-LD 1.1 [language maps](https://www.w3.org/TR/json-ld11/#language-maps) | No natural-language string without its language. In JSON, text grouped by language tag. |
| Provenance | W3C [PROV](https://www.w3.org/TR/prov-o/) concepts; [SPDX](https://spdx.org/licenses/) licence identifiers | Each text names its source, the item in it, the snapshot, and any derivation; each source its licence. |
| Describing the dataset | [Frictionless Data Package](https://datapackage.org/) | One `datapackage.json` listing the files, their schemas, the sources and licences. |
| Validating it | [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) | A schema per compiled file type, checked at build, usable by consumers outside TypeScript. |

The files stay plain JSON. OntoLex gives the concepts and their names, not the storage: no RDF, no triple store. Naming things after it keeps a JSON-LD export possible later without a redesign.

Lowercase is valid BCP 47: tags are case-insensitive ([RFC 5646, section 2.1.1](https://www.rfc-editor.org/rfc/rfc5646#section-2.1.1)), so `zh-Hans` is the conventional way to write the same tag, and HTML compares `lang` values without regard to case. Code that compares tags lowercases both sides, because JavaScript's `Intl` returns the conventional case (`Intl.getCanonicalLocales('zh-hans')` gives `zh-Hans`).

## The model

### Core

The core is today's compiled entities minus their explanation-language text. Japanese text stays: a sentence's `original`, a grammar point's `title`, every written form and reading. Two fields mix the two and have to be restructured before they can live in the core:

- a grammar point's title (`Noun + が + いちばん`) writes its slot names in English. The core writes slot codes instead (`{noun}`), named in each language's text; the `formation` (`Noun + が + いちばん + Adjective/Verb`) is mostly English prose, so it moves to the text layer whole;
- a word's `senses` mix JMdict's English glosses with facts that are not English: each sense's part of speech, its flags (archaic, abbreviation...) and its cross-references. Those facts describe JMdict's own senses, and senses belong to their source (see Identity), so they travel with JMdict's definition. The core keeps what is true of the word itself: the union of its parts of speech, which conjugation needs.

### Text

Explanation-language text is held as **renderings**: what one source says about one entity, in one language.

```ts
type LanguageTag = string;  // BCP 47, lowercase, validated at build
type SourceId = string;     // a directory of data/sources/
type TextStatus = 'imported' | 'corroborated' | 'reviewed' | 'rejected';
type Transform = 'script:hant-to-hans';  // the allowlist (D3)
type MatchEvidence = 'id' | 'spelling+reading' | 'spelling';  // see Matching

interface SourceRef {
  source: SourceId;
  ref?: string;              // the item in that source: a page title, a sentence id, a lexeme id
  snapshot: string;          // the snapshot date it was read from
}

interface Value {
  value: string;
  derivedFrom?: { value: string; lang: LanguageTag; transform: Transform };  // only for allowlisted transforms
}

interface Rendering {
  lang: LanguageTag;         // the language of `value`, as the source wrote it unless `derivedFrom` says otherwise
  source: SourceRef;
  match: MatchEvidence;      // why this text was attached to this entity
  status: TextStatus;
  evidence?: { source: SourceId; ref?: string }[];  // the independent texts that corroborate it
}

interface Definition extends Rendering {   // a source's own list of senses, never merged with another source's
  role: 'definition';
  senses: {
    glosses: Value[];
    tags?: string[];         // the source's labels for this sense: JMdict's part of speech and flags
    related?: string[];      // the source's cross-references, as entity ids
  }[];
}
interface Equivalent extends Rendering {   // one word in another language
  role: 'equivalent';
  value: Value;
  category?: 'direct' | 'cultural' | 'lexical';  // OntoLex vartrans translation categories
}
interface Translation extends Rendering {  // a translation of a Japanese text
  role: 'translation';
  value: Value;
  direction?: 'fromJapanese' | 'toJapanese';  // where the source records it (Tatoeba does)
}
interface Label extends Rendering { role: 'label'; value: Value }
interface Prose extends Rendering { role: 'prose'; field: string; value: Value }  // field: shortExplanation, usageNote...
interface Note extends Rendering { role: 'note'; value: Value }                   // for one audience only
```

This was the sketch; the types are now in `src/models/text.model.ts`. They differ from it in three ways, all to keep files small (a renderings file repeats these on every sentence):

- a rendering's language is its file's, and it carries `lang` only when it differs (a `zh` value in a `zh-hans` file);
- a source's snapshot is recorded once, in its `source.json`, so a rendering's `source` is only `{ source, ref }`;
- a value is a plain string, unless an allowlisted transform made it, when it is `{ value, derivedFrom }`.

Since phase 5, a rendering whose status a review set (`reviewed` or `rejected`) also carries `review: { by, basis, date }` (see "Corroboration and review").

### Language tags

- A text is tagged with the language its source wrote it in. Chinese is `zh-hans` or `zh-hant` when its characters tell the script (Tatoeba tags Mandarin only as `cmn`; 给 makes a sentence Simplified), and bare `zh` only when they cannot.
- A `zh` value written the same in both scripts (信, 函件) is served in both `zh-hans` and `zh-hant`.
- Another Chinese language gets its own tag, never Mandarin's: a Southern Min word (批, labelled 閩南語 in Japanese Wiktionary) is `nan`.

### Roles, per entity

Each entity uses the roles that fit it. There is no per-entity mechanism.

| Entity | Roles | Today's English |
|---|---|---|
| Word | definition, equivalent, note | `senses[].glosses` (JMdict); `mergedVocabs[].originalGlosses`, now derived from each merged entry's definition |
| Kanji | label | `meanings` (KANJIDIC2) |
| Sentence | translation | `en[]` (Tatoeba) |
| Grammar point | prose, label; translation for examples | `shortExplanation`, `longExplanation`, `formation`, `usageNote`, `derives`, a title's name, `examples[].en` (hanabira.org and hand-written; mined examples' from Tatoeba) |
| Grammar slot | label | the slot words of titles and romaji: Noun, Verb, A, い-Adjective (hand-written) |
| Family, lesson, case, chapter | label, prose | `family.name`, a case's `situation`/`guidance`, a chapter's `title`/`summary` (hand-written); a lesson's title is Japanese |
| Conjugation form | label | `formLabel` (hand-written) |
| Tag (part of speech, register, field) | label | JMdict's tag descriptions |
| Media title | label | `title.english`, genre names |

**Notes** exist because not everything is a translation. A Chinese reader needs "手紙 is not 手纸 (toilet paper)" and the Simplified form of a kanji; an English reader needs neither.

**Derived data belongs to its language.** Whatever is computed from explanation-language text is computed per language and stored with it: a word's near-synonyms (pairs sharing a gloss) and the search index. English polysemy is why: through "note", 手紙 is a near-synonym of 音 in English, which means nothing to a Chinese reader. Whether near-synonyms could instead come from a Japanese source, language-neutral and in the core, is decision D11.

### Identity

- Entities keep their ids (JMdict word ids, the kanji character, Tatoeba sentence ids, grammar point ids). Ids are never reused; a retired id is aliased, as grammar points already are. Ids never depend on a language.
- **Senses have no identity across sources.** Every first-hand source divides a word's meanings its own way: Chinese Wiktionary's 手紙 has two senses and a dialect reading, JMdict's has its own. Aligning them sense by sense would be our editing, on top of the source; JMdict itself keeps its non-English glosses (German, Russian, French...) in senses of their own rather than aligned with the English ones, French only partly excepted. So a definition's senses belong to its source, and every rendering attaches to the word.
- **A rendering is identified by its content**: a hash of entity kind, entity id, role, language, source, ref and value, and not of its status, match evidence or corroboration (`src/text/renderings.ts`). A review is recorded against that identity, so it survives every rebuild and is dropped, automatically, when the source changes the text.

## Sources

### The registry

Every source is a directory, `data/sources/<id>/`, holding its pinned snapshot and a `source.json`:

```json
{
  "id": "zhwiktionary",
  "name": "Chinese Wiktionary, Japanese entries (kaikki.org extraction)",
  "url": "https://kaikki.org/zhwiktionary/",
  "license": "CC-BY-SA-4.0",
  "community": "zh.wiktionary",
  "firstHand": "Chinese editors define Japanese words in Chinese",
  "languages": ["zh-hant", "zh-hans"],
  "roles": ["definition"],
  "match": "spelling+reading",
  "snapshot": { "date": "2026-11-01", "files": { "ja-trad.jsonl": "sha256:…" } }
}
```

`community` groups sources that are not independent of each other (see Corroboration). `match` is the strongest evidence the source can give for which word an item is (see Matching).

### What counts as first hand

The rule is the same for every source; whether it can be checked depends on the source.

- **Checked per item** where the source records direction. Tatoeba's `sentences_base` names, for every sentence, the sentence it was translated from: a Japanese-Chinese pair is kept only when one was translated from the other, never when the Chinese was translated from the English.
- **Trusted per source** where it does not. Wiktionary does not say whether an editor wrote a Chinese definition from the Japanese or from the English Wiktionary entry. The source is chosen because it defines Japanese words in Chinese, and a reviewed sample (the gold set) checks it.
- **Gokan's own writing** (usage notes, lessons, explanations) is first hand by definition; how it may be drafted is decision D4.

### Sources, current and candidate

| Source | Gives | Languages | Community | Status |
|---|---|---|---|---|
| JMdict (EDRDG) | definitions, tag labels | en | edrdg | in use, moves into the text layer |
| KANJIDIC2 (EDRDG) | kanji labels | en; fr, es, pt already vendored and unused | edrdg | in use; fr/es/pt in phase 3 |
| Tatoeba | sentence translations | en; zh (Mandarin, both scripts) | tatoeba | in use for en (`tatoeba`); Mandarin in use since phase 4 (`tatoeba-cmn`, its own snapshot of 2026-11-03) |
| hanabira.org | grammar prose, example translations | en | hanabira | in use |
| Gokan, hand-written | usage notes, families, lessons, cases, chapters | en | gokan | in use |
| Chinese Wiktionary, Japanese entries | definitions (example translations not read yet) | zh-hant, zh-hans | zh.wiktionary | in use since phase 4 (`zhwiktionary`) |
| Japanese Wiktionary, translation tables | equivalents | zh, nan | ja.wiktionary | in use since phase 4 (`jawiktionary`, refs `<page>#日本語`) |
| Japanese Wiktionary, Chinese entries read backwards | equivalents (信 is defined as 手紙) | zh, nan | ja.wiktionary | in use since phase 4 (`jawiktionary`, refs `<page>#中国語`) |
| Wikidata lexemes and their concepts' labels | equivalents | zh | wikimedia | in use since phase 4 (`wikidata`) |
| Wikipedia, Japanese article to Chinese article | equivalents (checks only, never displayed) | zh | wikimedia | in use since phase 4 as evidence only (`wikipedia`, no role) |
| Unihan (Unicode) | a kanji's Simplified and Traditional forms, Mandarin reading | zh-hans, zh-hant, zh-latn-pinyin | unicode | in use since phase 4 (`unihan`) |

### Excluded, and why

- **Chinese Wiktionary's bot entries.** About 40,000 Japanese entries, mostly technical terms (`汚泥処理【おでいしょり】污泥处理`), created in 2010 by Wjcdbot with the edit summary "自动创建条目"; neither the page histories nor the bot's user page name a source. Their quality, measured by agreement with other sources, is no worse than the hand-written entries'; their origin is unknown, and that is what the first-hand rule cannot accept (decision D5).
- **CC-CEDICT**: Chinese to English, no Japanese. Matching it to our words by their characters gives Chinese meanings to Japanese words, wrong exactly on the false friends.
- **Open Multilingual Wordnet**: Japanese WordNet was built by mapping Japanese words onto the English WordNet's concepts, so its link to Chinese goes through English.
- **Parallel corpora** (OPUS subtitles, TED, WikiMatrix): mostly translated from English, or aligned by machine.
- **Commercial dictionaries, and JLPT lists with Chinese meanings found online**: copyrighted, or copied from a textbook.

## Matching

An importer produces records in the source's own terms; the matcher attaches each to a Gokan entity and records why, as the rendering's `match`:

| Evidence | Meaning | Example |
|---|---|---|
| `id` | the source names the entity | Tatoeba's annotation names a JMdict entry |
| `spelling+reading` | same written form and same reading | a Chinese Wiktionary entry 手紙 read てがみ |
| `spelling` | same written form, no reading to confirm | a Japanese gloss 手紙 in a reverse entry; a Wikipedia title |

A record that matches nothing, or more than one entity, is logged with the reason, never attached by guess. A reverse entry attaches only when a whole gloss, or a whole 、-separated part of one, is the word: 信 ("手紙。") attaches to 手紙, 久闊 ("長期間会わないこと。また、手紙を送らないこと。") does not. Two source conventions the benchmark found have to be followed, not worked around: Chinese Wiktionary keeps a native word's meanings on its kana page (のむ lists 飲む, 呑む and 喫む, and its kanji pages only redirect), and marks which spelling each sense applies to (`飲む，呑む： 喝，饮`). A third, found while building phase 4: both Wiktionaries read a verbal noun's page as its verb (検索 as けんさくする), so such a reading is compared without its する.

The matcher is `src/text/match.ts`; `bun run build:text` writes its counts per source and outcome, with samples, to `build/assembled/text_matching.log`. A Wiktionary rendering's `ref` is the page and its language section, as the page's anchor writes it (`手紙#日語`, `てがみ#日本語`, `信#中国語`), which also tells Japanese Wiktionary's translation tables from its Chinese entries.

## Corroboration and review

- **Corroborated** means a text from another community agrees: shares an equivalent, after both are converted to Simplified characters. Communities, not sources, because sources of one community copy each other: Wikidata's Chinese labels largely follow Chinese Wikipedia's titles (89% agreement), Japanese Wiktionary's two sources share editors (84%).
- **Disagreement is a review signal, never a rejection.** The benchmark's hand check found agreement trustworthy and disagreement mostly a false alarm (see below).
- **Reviews are data**, in `data/reviews/`, JSON Lines written by hand, read and narrowed once by `src/text/reviews.ts`. A file's name says what it holds, and any other name fails the build:
  - `<lang>.jsonl`, one verdict per line on a rendering in that language: its id (`rendering`), its entity (`{ kind, id }`, words only so far), the `decision` (`reviewed` or `rejected`), an optional `reason`, the status it had when reviewed (`seen`), its `source` and `value` (for a person reading the file; the id is what identifies the text), and the provenance every record carries: `by`, `basis`, `date`, `confidence` (`high`, `medium`, `low`);
  - `gold-<lang>.jsonl`, the gold set written in that language: per word, its id, `headword`, `reading`, `level` and, per main sense, the JMdict `sense` and the words to `accept`;
  - `notes-<lang>.jsonl`, notes for that language's readers (a false friend): the word, its `headword`, the `value`.
- **How build:text applies them.** After it assembles a word's Chinese text, it adds the word's notes, as `note` renderings of source `gokan`, status `imported` (written by an AI, not yet checked by a person, decision D4), then sets every rendering a verdict names to the verdict's status, before choosing the search gloss: a `rejected` text stays in the compiled text, to be inspected and reviewed again, and is never chosen as a gloss (a `reviewed` one ranks with the corroborated). Nothing else of the rendering changes, so its id stays valid: the id ignores status and review. A reviewed or rejected rendering records who decided, `review: { by, basis, date }`, so a consumer can tell a provisional AI review from a person's without reading `data/reviews/`; the reason and confidence stay in the review files, which are the full record. A note is a rendering like any other, so a verdict on its id reviews it.
- **A stale review fails the build**: a verdict whose rendering no longer exists in its language (the source changed the text, which changes the id), or a gold or note record naming a word that does not exist or by a spelling it does not have.
- **The reviews so far are provisional.** No Chinese-speaking reviewer has been found yet, so the gold set, its verdicts and its notes were written by an AI (`by: "claude-opus-5-5"`, `basis: "ai-provisional"`), recorded so that a person can confirm or correct each one. To correct a verdict, edit its line, or replace it, keeping the `rendering` id, and set `by` to the person and `basis` to how they judged (`native-speaker`, for example); to confirm one, change only `by`, `basis` and `date`. A gold or note record is corrected the same way. A note is checked by adding a verdict on its rendering id.
- **The gold set** is a fixed sample of words (60 per JLPT level, drawn with a fixed seed, plus known false friends) for which a reviewer writes, from the Japanese, the acceptable equivalents of each main sense. It turns agreement rates into error rates and calibrates the agreement test. The benchmark scores it: the precision of the texts by the status they had before review, per level and source; the share of gold senses some text not rejected agrees with; the share of gold words with a rejected text; and the candidate acceptance rules (see "Phase 5 as built").

## Pipeline

The same stages for every source:

| Stage | Does | Pure |
|---|---|---|
| fetch | snapshots a source into `data/sources/<id>/`, by hand, network | no |
| import | snapshot to typed records | yes |
| match | records to entities, with evidence | yes |
| assemble | groups renderings by entity, role and language; never merges text across sources | yes |
| assess | corroboration across communities; applies reviews and transforms | yes |
| validate | the build checks below, the JSON Schemas, licence compatibility | yes |
| emit | the compiled files | yes |
| benchmark | coverage, agreement and gold-set scores per source and language; a drop fails the build | yes |

A new source is an importer and a `source.json`. A new language is a set of sources and their reviews. A new entity declares its roles.

## Compiled output

- **Core files** stay where they are, `compiled/vocab/`, `compiled/kanji/`, `compiled/sentences/`, `compiled/grammar/`..., without their explanation-language text.
- **Text files** mirror them: `compiled/text/<lang>/` followed by the core file's own path, holding the renderings for every entity in that core file. Where a core file holds several entities, its text file keys them by entity id: a word's sentence file (手紙's holds 1,059 sentences) has one Chinese text file, `compiled/text/zh-hans/sentences/1327720.json`, not one file per sentence. A core file with no text in a language has no text file in it.
- **Per-language indexes**, `compiled/text/<lang>/index/`: that language's search index and derived data, and the list of entities that have text in it (which pages exist in that language, its sitemap, its `hreflang` links).
- **A text file** is `{ kind, lang, entities }`: `entities` maps each entity id in the core file to its renderings, and, for a word, the near-synonyms computed from them.
- **How the build makes it.** `bun run build` empties `build/` and runs every stage, from the raw sources, in a fixed order.
  - **Every stage but the last** writes the dataset as it assembles it to `build/assembled/` (not committed). Each entity there carries its text in `text`, by language, made by the source's reader as it reads the source:
    - the JMdict reader keeps each gloss's language (JMdict's `eng` becomes `en`);
    - the KANJIDIC2 reader keeps all four of its languages;
    - the Tatoeba reader tags its translations with its pairs file's language.
    - the sources read after the core is assembled, the Chinese ones of phase 4, are one stage, `build:text` (`scripts/build-text.ts`), at the end of `build:data`: it imports each snapshot of `data/sources/` (one reader per source in `src/text/`), matches it, assembles and assesses the renderings (corroboration, the script transform) and adds them to each entity's `text`, so a mined grammar example built after it carries its sentence's Chinese too. It removes what its own sources gave before adding, so running it twice changes nothing.
  - **The last stage, `build:layout`,** writes `compiled/` from it. It names no language, so `compiled/text/{fr,es,pt}/kanji/` appear because KANJIDIC2 has them.
- **Words.** Each JMdict entry a word holds keeps its own definition, under its own id: the word's own entry (matched by `id`), then each homograph merged into it (matched by `spelling`). A merged homograph's three-gloss summary is no longer stored. It is the first sense of that entry's definition.
- **The search index** keeps each word's id, spelling and reading in `index/search.json`, and its short gloss per language in `compiled/text/<lang>/index/search.json`.
- **Grammar.** A point's core keeps its Japanese: the title and romaji, with a slot code where hanabira writes an English slot word (`{noun} にもまして`, `{a} uga {b} uga`), its examples' Japanese and words, and its language-neutral facts.
  - **Slots** are listed in `compiled/grammar/slots.json` (`src/text/grammarSlots.ts`): 8 codes, `noun`, `verb`, `a`, `b`, `na-adjective`, `i-adjective`, `noun1`, `noun2`, on 148, 141, 56, 55, 14, 10, 2 and 2 titles. Each has Gokan's label in each language, and its spelling inside a romanisation where that differs (`i-Adjective`). A slot word the module does not know fails the build.
  - **A point's text** holds its prose (`shortExplanation`, `longExplanation`, `formation`, `usageNote`) and its labels: `derives`, `family` (the family's own rendering, carried by every member), `name` (the title's name, "Polite past" in "Polite past: Verb ました"). Where rendering the core in a language would not give back what the source wrote (4 points: hanabira's name after the pattern on n5-016, and the casing of "な-adjective" and "verb-ru"), the source's own `title` or `romaji` is kept as a label too.
  - **The formation is prose**, moved whole: the pattern matcher and the formation miner read it, and the title, through the text accessors, and derive only language-neutral facts from them (which words are the pattern, which sentences use it).
  - **An example** is identified by its point and a hash of its Japanese (`n5-001#f5f2c8d0e880`), not its position, which overrides.json changes. Its translation is a rendering from hanabira, or Gokan where overrides.json wrote the example; a mined example carries its sentence's Tatoeba rendering itself.
  - **The indexes** with text are split the same way, keyed by entity: `families.json` and `contrasts.json` (a case is `<family>#<lesson>/<focus>><vs>`), the chapters of `teaching-order.json` (the generated ones from per-language templates), and `conjugations.json`, whose core keeps the form's Japanese marker (`たい`) and whose text holds its `formLabel`. `browse.json` is split like the search index: its rows' neutral fields in the core, their text as plain strings in `compiled/text/<lang>/grammar/index/browse.json`.
- **Two checks:**
  - `bun run check:layout` proves that every split file joins back to exactly what was assembled.
  - `bun run check:legacy [ref] [--baseline <dir>]` proves that every word, kanji, sentence, search and grammar file, projected back to its old shape from its core and its English (`src/layout/legacy.ts`), equals that file at an earlier commit, and every copied file too. With `--baseline`, grammar, media and the other indexes are compared with a directory instead (an earlier build's), where the commit's copies differ for a reason of their own. It is the dataset half of phase 2's "nothing changes for a user", and gokan-srs's loaders do the same projection.
- **Media** is split too: Jiten's English title, community tags and episode titles are labels (source `jiten`), and the genre names Gokan gives Jiten's genre ids are labels (source `gokan`); the core keeps the genre ids.
- **`compiled/schemas/`** holds a JSON Schema for every file type (33), generated by `bun run build:schemas` from the types in `src/models/compiled.model.ts`. Objects are closed, so a field the types do not declare fails the build (one already did: `isCommon` on words, now typed). `src/layout/resources.ts` maps every file's path to its type, for the schemas, the datapackage and the check.
- **`compiled/datapackage.json`** (`bun run build:datapackage`) lists every file type with its path pattern, file count, languages and schema, and every source with its licence. It holds no date, so it stays byte-identical between builds.
- **The output is byte-reproducible**: rebuilding from unchanged inputs changes no byte, so a consumer that compares files (a content-addressed deploy, a cache) sees only real changes.

## Consumers

Both apps read the same compiled dataset. How each one loads and serves it is the app's business, and the dataset never dictates it.

- **The English view** (`src/layout/english.ts`) gives back every file of the old layout, in its old shape, from its core and its English text. Both apps read the dataset through it, via `@gokan/dataset-schema/english`, so their code and their types are unchanged; `bun run check:legacy` proves it gives back exactly the old files, and no other file. It is a view, not a second copy: nothing it produces is committed here.
- **gokan-srs** reads English only. Its `scripts/sync-dataset.ts` writes the English view into `public/data/compiled`, so the app's runtime requests and files keep their shape, and no other language's text is shipped or uploaded.
- **gokan-dictionary** reads the core and every language it shows. Rendering on request, it reads a read-only database its deploy builds from the dataset, not the dataset's files one by one: a word's sentence file is 3 KB at the median but 481 KB at the 99th percentile and 32 MB at the largest, too much to fetch for each uncached page. The database is a copy rebuilt from the dataset at every deploy, as the prerender reads the dataset from the checkout today; the dataset stays the only source of truth.
- **No serving format is committed here.** The canonical form is one JSON file per entity, readable by key from disk and diffable in review. A format built for serving (the dictionary's database, a search index tuned for one app) is produced from it by the app's build. Serving is where the cost is: in the 30 days to 2026-11-03 the dictionary's deploys uploaded 1.29 million files to S3, almost all of them in 33 deploys that rewrote every one of its 40,000 or so pages, and every language section would have multiplied that. Rendering on request replaces those uploads with one deploy of the function and its database.

## Build checks

Each rule is a check, so it cannot regress by review:

1. No text without a lowercase BCP 47 tag, a source, its match evidence and a status.
2. No explanation-language text in a core field.
3. Renderings from different sources are never merged.
4. Every source has a `source.json` with an SPDX licence compatible with CC-BY-SA-4.0, and a snapshot whose checksums match.
5. Every derived value names an allowlisted transform and its original.
6. Every review names a rendering that exists, and every gold or note record a word that exists.
7. Every compiled file validates against its schema.
8. Rebuilding from unchanged inputs changes no byte of the output.
9. The benchmark's coverage and agreement do not drop below their recorded floors.

Where each runs (all after `bun run build`):

- 1, 2, 4, 5 and 6: `bun run check:text`. Check 6 runs twice: `build:text` fails on a review file it cannot read, a verdict no assembled rendering takes, or a gold or note record naming an unknown word; `check:text` then proves the compiled output kept them, each verdict's rendering in its language with the verdict's status and `review`, each note emitted, each gold word in `compiled/vocab/`, and no rendering claiming a review that `data/reviews/` does not record.
- 3 holds by construction: a rendering has exactly one source.
- 7: `bun run check:schemas`.
- 8: `bun run check:determinism`, which rebuilds everything from the raw sources and compares every byte.
- 9: `bun run check:benchmark`, against `docs/multilingual-benchmark/floors.json`; `bun run build:benchmark`, the last step of `bun run build`, writes `docs/multilingual-benchmark/report.md` (see its [README](multilingual-benchmark/README.md)).
- Two more prove phase 2: `bun run check:layout` (every split file joins back to what was assembled) and `bun run check:legacy` (the English view equals the old layout).

## What the benchmark measured

Measured 2026-11-03 and 2026-11-04 on the compiled dataset of the time (35,872 words), against Tatoeba's exports of that week, kaikki.org's extractions of the Chinese and Japanese Wiktionaries (dumps of 2026-11-01), and Wikidata. The scripts, their output and the gold-set draft are in [multilingual-benchmark/](multilingual-benchmark/README.md); phase 4 made them the build's benchmark stage, whose numbers are in "Phase 4 as built" below.

**Example sentences, Tatoeba, first hand only.** 16,266 direct Japanese-Mandarin links; the direction rule keeps 7,187 (6,153 Chinese written from the Japanese, 1,034 Japanese from the Chinese) and removes 8,501 Chinese translated from another language, 287 from a different Japanese sentence, 161 of unknown origin. That leaves 6,714 Japanese sentences with a first-hand Chinese translation, 5,483 of them already in our sentence pool (2.4% of its 228,767). Of those Chinese sentences, about 40% are recognisably Simplified, 24% Traditional, the rest undetermined.

| Level | Words | ≥1 English sentence | ≥1 Chinese | ≥3 Chinese |
|---|---:|---:|---:|---:|
| N5 | 664 | 100% | 85% | 65% |
| N4 | 616 | 100% | 75% | 43% |
| N3 | 1,557 | 99% | 57% | 20% |
| N2 | 1,674 | 93% | 20% | 1% |
| N1 | 2,817 | 88% | 17% | 2% |
| no level | 28,544 | 86% | 7% | 1% |
| all | 35,872 | 87% | 13% | 4% |

**Meanings, per source** (share of words matched; Wikipedia queried for JLPT words only):

| Level | zh.wikt definitions | ja.wikt translations | ja.wikt reverse | Wikidata | Wikipedia | any source | 2+ sources |
|---|---:|---:|---:|---:|---:|---:|---:|
| N5 | 71% | 39% | 73% | 44% | 28% | 90% | 75% |
| N4 | 67% | 18% | 73% | 33% | 26% | 91% | 67% |
| N3 | 62% | 15% | 71% | 30% | 28% | 89% | 64% |
| N2 | 55% | 11% | 56% | 20% | 23% | 82% | 50% |
| N1 | 48% | 6% | 53% | 15% | 19% | 76% | 41% |
| no level | 23% | 4% | 21% | 6% | | 37% | 12% |
| all | 30% | 5% | 29% | 9% | 5% | 47% | 21% |

- Words only one source covers, among the 3,837 at N5 to N3: Japanese Wiktionary reverse 307, Chinese Wiktionary 265, Wikidata 31, Japanese Wiktionary translations 13, Wikipedia 13. The reverse dictionary is the one real addition; the others are checks.
- Chinese Wiktionary's entries, where matched at N5 to N3, have 2.25 senses on average against JMdict's 2.93, and fewer for 37% of words.
- Words no source covers include 上手 and most honorific お- forms (お名前, お部屋).

**Agreement** (words both cover; sharing an equivalent after conversion to Simplified): Chinese Wiktionary with Japanese Wiktionary translations 80%, with Wikidata 64%, with the reverse dictionary 61%, with Wikipedia 61%. Of Chinese Wiktionary's 1,850 matched N5 to N3 words, 64% are corroborated by another community, 22% contradicted, 14% unchecked.

**Hand calibration.** Of 30 corroborated words, 29 agreed for real (雑誌 ~ 杂志, 駐車場 ~ 停车场); one (僕) agreed only on an archaic sense. Of 23 contradicted words, about 3 were real problems (急行 lacks the express-train sense; 気 and 渋滞 are thin); the rest were a paraphrase against a one-word equivalent (詩人 as 創作詩歌的人) or noise in the other source (Wikidata linking 気 to 气体, gas). And a real conflict the cross-check surfaces: Japanese Wiktionary lists Chinese 愛人 as an equivalent of 愛人, but in mainland Chinese 爱人 is a spouse.

## Phases

The dataset work happens on gokan-dataset branches. A change of layout ships with both apps adapted on a matching gokan-srs branch, the submodule pointer moving with them, so the two apps never read different datasets.

1. **This design.** Done when the decisions below are settled.
2. **The mechanism, English only, and both apps on it.** The sources registry for every current source; all English text moved into renderings with provenance; `compiled/text/en/`; JSON Schemas and `datapackage.json`; the build checks; `@gokan/dataset-schema` takes the new types and both apps read the new layout. Done when nothing changes for a user: for every entity, gokan-srs's loaders return exactly what they returned from the previous dataset, and gokan-dictionary's built pages are byte-identical to the previous build's.
3. **A second language at no cost.** KANJIDIC2's French, Spanish and Portuguese kanji meanings, already in `data/raw/kanji/kanjidic2-all-3.6.2.json` (7,643, 8,658 and 6,963 meanings), into `compiled/text/{fr,es,pt}/kanji/`. Done when they arrive with no code that knows they are French, and neither app changes. JMdict's own other languages (German, French, Russian, Spanish and others, each with its own sense list) are a further test, from jmdict-simplified's all-languages release.
4. **Chinese.** The importers listed above, the matcher's conventions, corroboration, the script transform if allowed, `compiled/text/zh-hans/`, and the benchmark as a build stage with recorded floors.
5. **Review.** The gold set reviewed, review records, and the acceptance rule set from what the gold set shows.

**Phase 2 as built (2026-11-04).** The English view equals the old layout for every file but one kind. 408 grammar points' mined example pools hold a different sample than origin/main's. A pool is a seeded sample of at most 60 sentences, and it used to depend on the order the filesystem listed the sentence files in, so a build on Linux and one on Windows could differ. The build now reads them sorted, which makes the sample the same on every machine. These 408 pools, and the 408 dictionary pages that show them, are the only change an app sees. They are a different, equally random sample, and the cause is the determinism fix, not the text layer: the English view equals, file for file, a build made with that fix before any text moved.

Two changes stay apart so neither hides a regression in the other. Phase 2 happens while the dictionary is still prerendered, so its check is that every page comes out byte-identical. The dictionary's move to rendering on request is its own change, checked the same way: every page the function renders is identical to the page the prerender makes from the same dataset. The dictionary's pages in other languages come after both, once phase 4 has data to show.

**Phase 4 as built (2026-11-05).** Six sources, each a snapshot in `data/sources/` with its checksums and a reader in `src/text/`, read by one stage, `build:text`: Chinese Wiktionary (definitions), Japanese Wiktionary (equivalents, from its translation tables and its Chinese entries read backwards), Wikidata (equivalents), Wikipedia (evidence only), Tatoeba's Mandarin (`tatoeba-cmn`, sentence translations) and Unihan (kanji labels: `simplifiedForm`, `traditionalForm`, `mandarinReading`). The layout needed no change: it writes `compiled/text/zh-hans/` for 15,974 words, 3,127 kanji and 4,697 sentence files, `zh-hant/` for 15,254 words, 3,127 kanji and 3,093 sentence files, and `nan/` for 219 words. The English view is unchanged (`check:legacy`), and gokan-srs, which reads only it, sees nothing.

- **Words.** One definition per Chinese Wiktionary page a word matches (its entries' senses in page order, each with its tags, the spellings it names and, for a word with several readings, the reading), and one equivalent per Chinese word another source gives. 40,455 bot entries are left out (D5). Matched records, and why the others were not: Chinese Wiktionary 15,364 matched, 892 read otherwise, 1,637 with no reading, 37 matching several words; translation tables 2,170 matched, 25 read otherwise, 462 with no reading, 16 several words; reverse entries 25,293 matched, 412 several words; Wikidata 3,469 matched, 65 read otherwise, 43 no reading, 9 several words; Wikipedia 1,713 matched, 2 several words.
- **Script.** Every value is filed by its characters (D2, D3). The transform wrote 20,594 values in zh-hans; 892 renderings stayed out of zh-hans because a Traditional-only character in them has no single Simplified variant (鍾, 餘), and a text using Simplified-only characters is never in zh-hant. A text mixing both scripts (a Chinese Wiktionary definition often does: のむ's senses are `喝，饮` and `吸煙`) is tagged `zh`, converted for zh-hans and left out of zh-hant. Unihan lists some Simplified characters as their own Traditional variant (师, 恋), so the rule reads 老师 as the same in both scripts and serves it in zh-hant too: what Unihan says, not a guess of ours.
- **Corroboration.** Of the 1,843 N5 to N3 words Chinese Wiktionary defines, 61.5% are corroborated by another community, 20.9% contradicted, 17.6% unchecked; over all words, 36.3%. Words with a corroborated text, per source: Japanese Wiktionary's translation tables 64.8%, Wikidata 58.8%, its reverse entries 39.1%.
- **Search.** A word's gloss in `text/<lang>/index/search.json` is its first two corroborated equivalents, else the first gloss of its first definition, else its first two equivalents (`src/text/chineseText.ts`, `searchGloss`). Near-synonyms stay English only (D11).
- **The benchmark** (`docs/multilingual-benchmark/report.md`, floors in `floors.json`, each a percentage one point below this run or a count 2% below) measures what the 2026-11-03/04 benchmark did, from the compiled output. Where its numbers differ, the cause is a rule of this design the research scripts did not follow:
  - Japanese Wiktionary's reverse entries cover 65.5% of N5 words, not 73%: they attach on a whole gloss or a whole 、-part only, where the research split every gloss at every punctuation mark (and attached 久闊 to また).
  - Wikipedia counts 22.4% of N5 words, not 28%: it is never displayed, so the compiled output shows it only where it corroborates.
  - "2+ communities" (67.9% at N5) is not the research's "2+ sources" (75%): Japanese Wiktionary's two readings are one community, and Wikipedia counts only where it agrees.
  - Translation tables cover 37.3% of N5 words, not 39%: a kanji page read several ways (私, 一) matches several words, and the matcher never chooses.
  - Corroborated N5 to N3 words are 61.5%, not 64%, for the stricter reverse entries; a Wikipedia title that disagrees is invisible, so more words are unchecked (17.6%, not 14%) and fewer contradicted.
  - Chinese Wiktionary (71.1% at N5), Wikidata (43.7%) and Tatoeba (84.6% of N5 words with a first-hand Chinese sentence, 5,482 pool sentences, one fewer than measured because its Japanese was edited since the pool's export) agree with the research. Unihan tells the script of far more sentences than the research's 40-character list: 3,010 Simplified, 1,887 Traditional, 968 the same in both.
- **Decided while building.** Tatoeba's Mandarin export is its own source, `tatoeba-cmn` (community `tatoeba`), because a source has one snapshot and its date is not the English pairs' (2026-02-15). Pinyin is tagged `zh-latn-pinyin`. Japanese Wiktionary's Mandarin is `zh` and `cmn`, Southern Min `nan` (閩南語, 台湾語); senses and cells in Cantonese, Wu, Hakka or another Chinese language are left out until they have a tag here. The fetch scripts for Wikidata and Wikipedia are in `scripts/` (`fetch-wikidata-lexemes.ts`, `fetch-wikipedia-links.ts`). Chinese Wiktionary's example sentences are not read yet.

**Phase 5 as built (2026-11-06).** The gold set is the benchmark's 300-word draft (60 per JLPT level, seed 20261104; the known false friends are among them, not added), reviewed provisionally by an AI (D7) and recorded in `data/reviews/`: 981 verdicts in zh-hans (800 reviewed, 181 rejected) and 910 in zh-hant (744, 166) on 249 of the 300 words (50 have no Chinese text), 577 gold senses, and 26 notes on false friends, emitted as `note` renderings in zh-hans. Every verdict found its rendering, at the status it was reviewed at. The numbers below are in `docs/multilingual-benchmark/report.md`, with floors one point below them:

- **Precision by the status before review** (zh-hans): corroborated texts 97.4% accepted (of 426), imported 69.4% (of 555), from 64.5% at N5 to 81.6% at N1. By source, imported: Chinese Wiktionary 98.9% (of 92), Japanese Wiktionary 63.3% (of 409), Wikidata 64.8% (of 54); corroborated: 100%, 99.2% and 88.0%. zh-hant agrees within two points. Corroboration is as trustworthy as the hand calibration found; an imported equivalent is right two times in three, an imported Chinese Wiktionary definition almost always.
- **Gold coverage**: 61.0% of the gold senses have a text not rejected that agrees with an accepted word (66.9% at N5, 47.9% at N1); 31.3% of the gold words have at least one rejected text (45.0% at N5, where words are most polysemous and Japanese Wiktionary's reverse entries attach most).
- **Acceptance rule candidates**, still to be chosen (counts of word texts in zh-hans after review; precision and gold coverage on the texts as they were before review): (A) reviewed or corroborated only, 14,753 texts on 4,686 words, 97.4%, 32.1% of gold senses; (B) A plus imported texts of a source whose imported precision is at least 85%, which admits Chinese Wiktionary only, 21,556 texts on 11,011 words, 97.7%, 50.6%; (C) everything not rejected, 43,361 texts on 15,973 words, 81.5%, 61.7%.
- **Decided while building.** A reviewed or rejected rendering records `review: { by, basis, date }` (about 1,900 renderings, a few dozen bytes each); the reason and confidence stay in `data/reviews/`. The search gloss never takes a rejected text, and ranks a reviewed equivalent with the corroborated ones, so accepting a text never demotes it. `gokan`'s `source.json` lists `zh-hans` for its notes.

## Decisions

| # | Decision | Recommendation | Status |
|---|---|---|---|
| D1 | Does the mechanism cover all text, English included? | Yes: otherwise English stays the source of truth. | decided 2026-11-04 |
| D2 | How languages are tagged | BCP 47, lowercase everywhere. Chinese as `zh-hans` / `zh-hant` as written; bare `zh` only when the script cannot be told; another Chinese language its own tag (`nan`, `yue`). | decided 2026-11-04 (lowercase) and 2026-11-05: tags lowercase; Chinese as written, `zh-hans` or `zh-hant` when its characters show the script (told from Unihan: a character with a kSimplifiedVariant other than itself is Traditional-only, one with a kTraditionalVariant other than itself Simplified-only), bare `zh` when they cannot, and a `zh` value is served in both `zh-hans` and `zh-hant`; another Chinese language its own tag (Southern Min, labelled 閩南語, is `nan`). Built: pinyin is `zh-latn-pinyin` |
| D3 | Traditional to Simplified conversion | Allowed, as a derived value naming its original and the transform; the source text is kept. | decided 2026-11-05: allowed, as a derived value (`derivedFrom` with the original and `script:hant-to-hans`), from Unihan's kSimplifiedVariant, character by character, only where a character has exactly one Simplified variant (otherwise the text is not served in `zh-hans`); Simplified to Traditional is not allowed (one-to-many) |
| D4 | How authored prose may be drafted | One rule for every language. The English contrast lessons are "AI-drafted, human-reviewed" (SCHEMA.md), which is looser than the rule for imported text. Either that holds for authored Chinese too, or authored text is written by a person. | for existing English, decided 2026-11-04: Gokan's hand-written text and its AI-drafted, human-reviewed text are `reviewed`, with a note saying how the text was made; for new languages, open |
| D5 | Chinese Wiktionary's bot entries | Excluded until their origin is known. | decided 2026-11-05: excluded, recognised as the benchmark did (no part of speech, the first gloss opening with the headword and its reading in 【】); 40,455 entries left out (230 under 日語, 40,225 under 日语) |
| D6 | What corroborates | Agreement with a text from another community: zh.wiktionary; ja.wiktionary; wikimedia (Wikidata, Wikipedia); tatoeba; edrdg; gokan. | decided 2026-11-05: agreement with a text from another community (those six); agreeing is sharing an equivalent once both are in Simplified characters, the benchmark's rule (a one-character item agrees with an item it starts); a corroborated rendering has status `corroborated` and `evidence` naming the agreeing sources and items; disagreement never rejects. Wikipedia is a check only: it appears as evidence, never as a rendering |
| D7 | Reviews and the gold set | Reviews stored as data here, keyed by rendering identity. Who reviews Chinese is open. | 2026-11-06: provisional AI review of the 300-word gold set by claude-opus-5-5, recorded as data; a Chinese-speaking reviewer to confirm or correct it |
| D8 | Compiled layout | One layout both apps read: core files where they are today, text under `compiled/text/<lang>/` mirroring them, per-language indexes. | decided 2026-11-04 |
| D9 | Schemas | JSON Schema per compiled file type, validated at build; the tool chosen in phase 2. | decided 2026-11-04: generated from the TypeScript types by ts-json-schema-generator, validated with Ajv |
| D10 | Dataset manifest | Frictionless `datapackage.json`. | decided 2026-11-04 |
| D11 | Where near-synonyms come from | Per language, computed from that language's renderings, as the English ones are today. A Japanese source of language-neutral synonyms can be measured later. | decided 2026-11-04 for now; a Japanese source stays open |
| D12 | What the dataset guarantees its consumers | One JSON file per entity and no serving format; per-language entity indexes; byte-reproducible output; ids that never depend on a language. | decided 2026-11-04 |
| D13 | Which Chinese text a learner is shown (the acceptance rule) | Shown when reviewed or corroborated, or imported from a source reliable on its own (Chinese Wiktionary's definitions, Tatoeba's first-hand Mandarin, Unihan); never when rejected. On the gold set this shows 11,011 words at 97.7% precision, against 4,686 at 97.4% for reviewed-or-corroborated only and 15,973 at 81.5% for everything not rejected. One function, `isShown` in `src/text/acceptance.ts`, decides for every consumer; the search gloss uses it. | provisional 2026-11-06, set from the AI review of the gold set; to confirm with a Chinese-speaking reviewer |

## Open questions

- **Snapshot size.** The Wiktionary extractions are 35 to 190 MB each, 5 to 24 MB gzipped. Phase 4 commits every snapshot gzipped under Git LFS (`data/sources/**/*.gz`, 116 MB in all, 62 MB of it Tatoeba's sentences_base); whether that stays affordable as languages are added is a cost question for the LFS quota.
- **kaikki.org's per-language files are deprecated** and may disappear. The importers should read wiktextract's full extraction, or parse the dumps, so a source does not vanish with a mirror.
- **Kanji pages for Chinese readers** probably need the variant forms and readings more than meanings: 電 means what a Chinese reader expects, but its Simplified form is 电. Phase 4 gives Unihan's Simplified and Traditional forms and Mandarin readings; a Japanese form Unihan relates to no Chinese one (図 for 圖, 駅 for 驛) gets no variant label, since reaching one would mean following Japanese-variant links, a choice of ours.
