# Explanation languages: the multilingual model

**Status: design, proposed 2026-11-04. Nothing here is implemented yet.** This is the plan the dataset follows to explain Japanese in more than one language, Chinese first. The open decisions are listed at the end; settle them here, in this file, so the reasoning stays next to the model.

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

- a grammar point's `formation` (`Noun + が + いちばん + Adjective/Verb`) writes its slot names in English;
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

This is a sketch: names are settled in phase 2, in `src/models/`, with the JSON Schemas.

### Language tags

- A text is tagged with the language its source wrote it in. Chinese is `zh-hans` or `zh-hant` when its characters tell the script (Tatoeba tags Mandarin only as `cmn`; 给 makes a sentence Simplified), and bare `zh` only when they cannot.
- A `zh` value written the same in both scripts (信, 函件) is served in both `zh-hans` and `zh-hant`.
- Another Chinese language gets its own tag, never Mandarin's: a Southern Min word (批, labelled 閩南語 in Japanese Wiktionary) is `nan`.

### Roles, per entity

Each entity uses the roles that fit it. There is no per-entity mechanism.

| Entity | Roles | Today's English |
|---|---|---|
| Word | definition, equivalent, note | `senses[].glosses` (JMdict); `mergedVocabs[].originalGlosses` |
| Kanji | label | `meanings` (KANJIDIC2) |
| Sentence | translation | `en[]` (Tatoeba) |
| Grammar point | prose, label; translation for examples | `shortExplanation`, `longExplanation`, `usageNote`, `examples[].en` (hanabira.org and hand-written) |
| Family, lesson, case, chapter | label, prose | `family.name`, a case's `situation`/`guidance`, a chapter's `title`/`summary` (hand-written) |
| Tag (part of speech, register, field) | label | JMdict's tag descriptions |
| Media title | label | `title.english`, genre names |

**Notes** exist because not everything is a translation. A Chinese reader needs "手紙 is not 手纸 (toilet paper)" and the Simplified form of a kanji; an English reader needs neither.

**Derived data belongs to its language.** Whatever is computed from explanation-language text is computed per language and stored with it: a word's near-synonyms (pairs sharing a gloss) and the search index. English polysemy is why: through "note", 手紙 is a near-synonym of 音 in English, which means nothing to a Chinese reader. Whether near-synonyms could instead come from a Japanese source, language-neutral and in the core, is decision D11.

### Identity

- Entities keep their ids (JMdict word ids, the kanji character, Tatoeba sentence ids, grammar point ids). Ids are never reused; a retired id is aliased, as grammar points already are. Ids never depend on a language.
- **Senses have no identity across sources.** Every first-hand source divides a word's meanings its own way: Chinese Wiktionary's 手紙 has two senses and a dialect reading, JMdict's has its own. Aligning them sense by sense would be our editing, on top of the source; JMdict itself keeps its non-English glosses (German, Russian, French...) in senses of their own rather than aligned with the English ones, French only partly excepted. So a definition's senses belong to its source, and every rendering attaches to the word.
- **A rendering is identified by its content**: a hash of entity kind, entity id, role, language, source, ref and value. A review is recorded against that identity, so it survives every rebuild and is dropped, automatically, when the source changes the text.

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
| Tatoeba | sentence translations | en; zh (Mandarin, both scripts) | tatoeba | in use for en; zh in phase 4 |
| hanabira.org | grammar prose, example translations | en | hanabira | in use |
| Gokan, hand-written | usage notes, families, lessons, cases, chapters | en | gokan | in use |
| Chinese Wiktionary, Japanese entries | definitions, example translations | zh-hant, zh-hans | zh.wiktionary | phase 4 |
| Japanese Wiktionary, translation tables | equivalents | zh | ja.wiktionary | phase 4 |
| Japanese Wiktionary, Chinese entries read backwards | equivalents (信 is defined as 手紙) | zh | ja.wiktionary | phase 4 |
| Wikidata lexemes and their concepts' labels | equivalents | zh | wikimedia | phase 4 |
| Wikipedia, Japanese article to Chinese article | equivalents (checks only, never displayed) | zh | wikimedia | phase 4 |
| Unihan (Unicode) | a kanji's Simplified and Traditional forms, Mandarin reading | zh | unicode | phase 4 |

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

A record that matches nothing, or more than one entity, is logged with the reason, never attached by guess. A reverse entry attaches only when a whole gloss, or a whole 、-separated part of one, is the word: 信 ("手紙。") attaches to 手紙, 久闊 ("長期間会わないこと。また、手紙を送らないこと。") does not. Two source conventions the benchmark found have to be followed, not worked around: Chinese Wiktionary keeps a native word's meanings on its kana page (のむ lists 飲む, 呑む and 喫む, and its kanji pages only redirect), and marks which spelling each sense applies to (`飲む，呑む： 喝，饮`).

## Corroboration and review

- **Corroborated** means a text from another community agrees: shares an equivalent, after both are converted to Simplified characters. Communities, not sources, because sources of one community copy each other: Wikidata's Chinese labels largely follow Chinese Wikipedia's titles (89% agreement), Japanese Wiktionary's two sources share editors (84%).
- **Disagreement is a review signal, never a rejection.** The benchmark's hand check found agreement trustworthy and disagreement mostly a false alarm (see below).
- **Reviews are data**, `data/reviews/<lang>.jsonl`: the rendering's identity, the decision (`reviewed` or `rejected`), who, when, and a note. A review whose rendering no longer exists fails the build, so a stale decision is noticed.
- **The gold set** is a fixed sample of words (60 per JLPT level, drawn with a fixed seed, plus known false friends) for which a reviewer writes, from the Japanese, the acceptable equivalents of each main sense. It turns agreement rates into error rates and calibrates the agreement test.

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
- **`compiled/datapackage.json`** lists every file type with its JSON Schema, and every source with its licence.
- **The output is byte-reproducible**: rebuilding from unchanged inputs changes no byte, so a consumer that compares files (a content-addressed deploy, a cache) sees only real changes.

## Consumers

Both apps read the same compiled dataset. How each one loads and serves it is the app's business, and the dataset never dictates it.

- **gokan-srs** reads the core and `en` only. Its loaders assemble from them the values it uses today (a word's `senses` from the core and JMdict's `en` definition). Its build copies only what it reads: `scripts/sync-dataset.ts` copies the whole `compiled/` folder into the app today, which would upload every language's text to S3 for nothing.
- **gokan-dictionary** reads the core and every language it shows. Rendering on request, it reads a read-only database its deploy builds from the dataset, not the dataset's files one by one: a word's sentence file is 3 KB at the median but 481 KB at the 99th percentile and 32 MB at the largest, too much to fetch for each uncached page. The database is a copy rebuilt from the dataset at every deploy, as the prerender reads the dataset from the checkout today; the dataset stays the only source of truth.
- **No serving format is committed here.** The canonical form is one JSON file per entity, readable by key from disk and diffable in review. A format built for serving (the dictionary's database, a search index tuned for one app) is produced from it by the app's build. Serving is where the cost is: in the 30 days to 2026-11-03 the dictionary's deploys uploaded 1.29 million files to S3, almost all of them in 33 deploys that rewrote every one of its 40,000 or so pages, and every language section would have multiplied that. Rendering on request replaces those uploads with one deploy of the function and its database.

## Build checks

Each rule is a check, so it cannot regress by review:

1. No text without a lowercase BCP 47 tag, a source, its match evidence and a status.
2. No explanation-language text in a core field.
3. Renderings from different sources are never merged.
4. Every source has a `source.json` with an SPDX licence compatible with CC-BY-SA-4.0, and a snapshot whose checksums match.
5. Every derived value names an allowlisted transform and its original.
6. Every review names a rendering that exists.
7. Every compiled file validates against its schema.
8. Rebuilding from unchanged inputs changes no byte of the output.
9. The benchmark's coverage and agreement do not drop below their recorded floors.

## What the benchmark measured

Measured 2026-11-03 and 2026-11-04 on the compiled dataset of the time (35,872 words), against Tatoeba's exports of that week, kaikki.org's extractions of the Chinese and Japanese Wiktionaries (dumps of 2026-11-01), and Wikidata. The scripts, their output and the gold-set draft are in [multilingual-benchmark/](multilingual-benchmark/README.md); phase 4 brings them into the benchmark stage.

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

Two changes stay apart so neither hides a regression in the other. Phase 2 happens while the dictionary is still prerendered, so its check is that every page comes out byte-identical. The dictionary's move to rendering on request is its own change, checked the same way: every page the function renders is identical to the page the prerender makes from the same dataset. The dictionary's pages in other languages come after both, once phase 4 has data to show.

## Decisions

| # | Decision | Recommendation | Status |
|---|---|---|---|
| D1 | Does the mechanism cover all text, English included? | Yes: otherwise English stays the source of truth. | open |
| D2 | How languages are tagged | BCP 47, lowercase everywhere. Chinese as `zh-hans` / `zh-hant` as written; bare `zh` only when the script cannot be told; another Chinese language its own tag (`nan`, `yue`). | lowercase decided 2026-11-04; the rest open |
| D3 | Traditional to Simplified conversion | Allowed, as a derived value naming its original and the transform; the source text is kept. | open |
| D4 | How authored prose may be drafted | One rule for every language. The English contrast lessons are "AI-drafted, human-reviewed" (SCHEMA.md), which is looser than the rule for imported text. Either that holds for authored Chinese too, or authored text is written by a person. | open |
| D5 | Chinese Wiktionary's bot entries | Excluded until their origin is known. | open |
| D6 | What corroborates | Agreement with a text from another community: zh.wiktionary; ja.wiktionary; wikimedia (Wikidata, Wikipedia); tatoeba; edrdg; gokan. | open |
| D7 | Reviews and the gold set | Reviews stored as data here, keyed by rendering identity. Who reviews Chinese is open. | open |
| D8 | Compiled layout | One layout both apps read: core files where they are today, text under `compiled/text/<lang>/` mirroring them, per-language indexes. | one layout for both apps decided 2026-11-04; the paths open |
| D9 | Schemas | JSON Schema per compiled file type, validated at build; the tool chosen in phase 2. | open |
| D10 | Dataset manifest | Frictionless `datapackage.json`. | open |
| D11 | Where near-synonyms come from | Per language, computed from that language's renderings, as the English ones are today. A Japanese source of language-neutral synonyms can be measured later. | open |
| D12 | What the dataset guarantees its consumers | One JSON file per entity and no serving format; per-language entity indexes; byte-reproducible output; ids that never depend on a language. | open |

## Open questions

- **Snapshot size.** The Wiktionary extractions are 35 to 190 MB each. `data/raw/**` is already Git LFS; whether every snapshot is committed or only a fetch script and its checksums is a cost question for the LFS quota.
- **kaikki.org's per-language files are deprecated** and may disappear. The importers should read wiktextract's full extraction, or parse the dumps, so a source does not vanish with a mirror.
- **Kanji pages for Chinese readers** probably need the variant forms and readings more than meanings: 電 means what a Chinese reader expects, but its Simplified form is 电.
