# How the grammar teaching model works

Plain-English explanation of every moving part. The current *contents* (all 145 chapters, all 96 lessons) live in the generated [CURRICULUM.md](CURRICULUM.md); the exact field names and types live in [SCHEMA.md](SCHEMA.md). This file is the one that explains what any of it means.

---

## The five words, and how they relate

There are five groupings in the data, and they answer different questions. Most confusion comes from assuming two of them are the same thing.

| Word | Answers | Example |
| --- | --- | --- |
| **Point** | One grammar item the learner studies. | 「～から、～」 (`n5-073`) |
| **Chapter** | *When* is this point introduced? | `n5-c16` "Giving a reason" |
| **Family** | Which points mean roughly the same thing? | `causality` (16 points) |
| **Lesson** | Which points do learners actually mix up? | "から / ので" |
| **Case** | In this concrete situation, which one, and why? | "Apologising → use ので" |

The relationships:

```
POINT ──── belongs to exactly one ────► CHAPTER   (when you meet it)
  │
  └─────── belongs to at most one ────► FAMILY    (what it means)
                                          │
                                          └── split into ──► LESSON(s)   (what you confuse)
                                                                │
                                                                └── teaches ──► CASE(s)
```

**A chapter and a lesson are unrelated groupings.** This is the single most important thing to hold on to. A chapter is a slot in a sequence. A lesson is a set of things you mix up. They are allowed to cut across each other, and they do.

> A lesson was called a **chunk** until 2026-09. The word kept getting read as a synonym for "chapter", which is exactly backwards, so it was renamed.

---

## Point

One grammar item: a title, explanations, a formation template, and 3 to 5 example sentences. 755 of them, from the vendored upstream snapshot.

Some points are **realization variants** of another point: the same construction with one slot filled differently, which upstream listed separately. それじゃ is それでは contracted; じゃ is それでは contracted with the それ dropped. Those are not three things to learn, they are one thing written three ways, so the dataset marks two of them `variantOf: "n5-006"`. A variant is never introduced on its own and never gets its own SRS card; it rotates inside the canonical's card instead. 12 points are variants, so 743 are actually introduced.

This matters for confusion: if you find yourself mixing up two forms and it turns out one is `variantOf` the other, **you were never supposed to tell them apart**.

## Chapter

A run of points meant to be met together, and the unit of the introduction order. 145 of them.

They exist because the upstream data is alphabetical, which is actively hostile: it put seven near-synonymous connectives first and the case particles at positions 40+. Genki reaches は and basic verb conjugation in chapter 3 of 23.

Chapters come from three places:

1. **Hand-written, N5 and N4** (`data/curriculum/chapters.json`, 40 chapters). At these levels points genuinely depend on each other: 「Verb た ことがある」 is unteachable before the た-form. So the sequence is authored by hand.
2. **Generated from families, N3 to N1** (63 chapters). Above N3 points are largely independent idioms with no dependency chain, so the useful thing to do is group each family together and let the lessons do the teaching.
3. **Hand-written themes, N3 to N1** (`data/curriculum/themes.json`, 42 chapters) for everything with no family. These replaced an alphabetical dump that put 42% of the whole dataset into 18 buckets of 20 named "Further N2 patterns (3 of 5)". One bucket held にほかならない, ということ, "whenever", "before" and "based-on" side by side, related only by having adjacent ids. A theme does not claim to sequence its points against each other; it only guarantees the chapter has a subject.

**A chapter's level is its position, not a claim about its contents.** `n5-c17` is an N5 chapter that contains だが (N2) and ものの (N2), because those are register variants of でも, and a register variant adds no new structure. Gating them behind two more JLPT levels would only mean the ladder is never seen whole.

### When a family spans levels: absorb, or level-gate?

A family like *concession* has members at N3, N2 and N1. Two options:

- **Absorb**: one chapter, the whole ladder at once. Ideal, because the ladder is finally visible as a ladder.
- **Level-gate**: one chapter per level. Each sitting stays digestible, but you never see the whole thing, and a lesson can only compare that level's members.

The rule: **absorb a pure register ladder of 6 members or fewer, level-gate everything else.**

- *Pure register* means no member carries a `constraint` axis. A constraint member adds a meaning restriction you can get wrong, and stepping through those one level at a time is exactly what level-gating is for. One constraint member disqualifies the whole family, whatever its size.
- *6 or fewer* because concession absorbed would be 11 forms in one chapter, which is not a chapter, it is a wall.
- The count is over the **whole family**, not just its register members. Splitting a mixed family into an absorbed half and a level-gated half fragments it worse than either rule on its own.

Currently 12 families are absorbed and 35 level-gated. A level-gated family puts the level in its chapter titles (`"N2: Concession (Even Though / Although / Despite)"`) so three chapters do not share one name.

## Family

The near-synonym group: points a learner asking "how do I say X?" would be shown together. 85 families, hand-assigned in `data/raw/grammar/formality.json`. 383 points have no family at all, which is fine and normal.

Each member carries an **axis**, saying what it adds over its siblings:

| Axis | Means | Consequence |
| --- | --- | --- |
| `register` | Differs only in formality. でも casual, しかし formal, けれども literary. | Safe to teach adjacently across levels. Absorbable. |
| `constraint` | Adds a meaning restriction you can get wrong. おかげで is positive-only, ばかりに negative-only. | Stays level-gated. Needs a lesson. |
| `variant` | No differentiator exists. The siblings are interchangeable. | Gets a note, never a lesson. |

## Lesson

**A family is not a lesson.** The family is "what means roughly this"; the lesson is "what you actually mix up". The causality family has 16 members, and nobody confuses all 16 with each other. So a family is split into lessons of about 5 or 6 points each, and each lesson is a set that genuinely blurs together.

Splitting is also where a too-coarse family gets corrected. The *sequence-then* family lumped そして/それから (and-then) with じゃ/それでは (well then, in that case). Those are two different meanings, and one four-way lesson over them would be incoherent, so そして/それから is its own lesson.

96 lessons across 66 families.

### `taughtInChapterId`

Every lesson is stamped with the chapter of whichever of its points is introduced **last**. That is the earliest moment the lesson is honest: a contrast is only meaningful once every point it names is a real memory.

A lesson is **allowed to span chapters**, and 3 of the 96 do. The から/ので lesson is one: から is introduced in `n5-c16` and ので in `n4-c12`, so it anchors to `n4-c12` and fires there, by which time から has been known for a whole JLPT level.

This was a deliberate decision against the original plan, which assumed a lesson could never span chapters. Enforcing that would have deleted the から/ので lesson, which is the motivating example for the whole feature. What *is* enforced is the rule that actually carries weight:

> A case's `focus` may never be introduced **before** one of its `vs` siblings.

That is a hard build error. It caught five lessons authored backwards.

## Case

One concrete situation inside a lesson. Four fields:

- **`focus`** the point to reach for
- **`vs`** the sibling(s) you would wrongly reach for instead
- **`situation`** when this comes up
- **`guidance`** which one fits, and why the obvious alternative does not

```jsonc
{
  "focus": "n4-110",                    // ので
  "vs": ["n5-073"],                     // から
  "situation": "Explaining or apologising for something (why you were late, why you cannot come).",
  "guidance": "Reach for ので. It frames the reason as a calm explanation of the situation, which sounds considerate and is safe in polite or formal speech. から puts the weight on your reason itself, which in an apology can read as pushing an excuse."
}
```

A case is **directed**: `focus` is the one met later, so the lesson teaches the new thing against the known thing, never the reverse. 140 cases.

---

## Where a learner actually sees this

- **At introduction.** When a point is introduced and it is the `focus` of a case, the app shows that case. It is deferred if any `vs` sibling is not known yet, so the contrast always lands between two real memories.
- **On the family page** (`/grammar/family/:familyId`). Every lesson and case for that family, regardless of what has been introduced. This is where you go back to compare deliberately.
- **Nowhere else yet.** Chapters are not surfaced in the UI at all: the app reads the flat introduction order and nothing else. `taughtInChapterId` exists so an end-of-chapter review could be built later.

## When there is nothing to teach

Some families are `variant` all the way down. `regardless-a-or-b` is ten near-identical literary "whether A or B" forms that upstream gives one shared usage note to, verbatim.

Those get an **interchangeable note**, not a lesson, and authoring a lesson that names a `variant` point is a build error. The note is the point: a learner who meets the fourth of ten near-identical forms in silence concludes a distinction must exist and goes hunting for one that is not there. Saying "there is no rule here" out loud is more useful than saying nothing.

---

## Known gaps

- **Confusion sets that cross families cannot be expressed.** A lesson lives inside one family. If a learner mixes up それでは (sequence-then) with しかし (contradiction), no lesson can pair them, because they are in different families. This is a real limitation of the model, not an authoring backlog.
- **`axis` is heuristic-seeded and only partly hand-reviewed.** It was seeded from the wording of each point's usage note, which over-assigns `register` to anything whose note happens to mention only formality. The absorb rule is capped at 3 JLPT levels of distance as a guardrail, and points held back by that cap are printed at build time as hand-correction candidates.
- **`formality.json` coverage is partial**, so a point with no family is invisible to the lesson system entirely, whether or not anyone confuses it.

## Where each thing is authored

| File | Hand-written? | What it holds |
| --- | --- | --- |
| `data/curriculum/chapters.json` | yes | The N5/N4 chapter spine |
| `data/curriculum/themes.json` | yes | N3-N1 thematic chapters for unfamilied points |
| `data/raw/grammar/formality.json` | yes | Family, axis, register and usage note per point |
| `data/raw/grammar/contrasts.json` | yes | Lessons and cases |
| `data/raw/grammar/variants.json` | yes | Which points are realizations of another |
| `compiled/grammar/index/teaching-order.json` | generated | The chapters and the flat order |
| `compiled/grammar/index/contrasts.json` | generated | Lessons, validated and anchored |
| `docs/CURRICULUM.md` | generated | The full readable inventory |
