# Grammar formality/register tracking

Working checklist for [gokan-dataset#3](https://github.com/gokan-dev/gokan-dataset/issues/3) - all 828 compiled grammar points, whether each falls into a measured near-synonym gloss cluster (>=3 points sharing a quoted English gloss word in `shortExplanation`, the `,`/`it` noise clusters excluded), and whether it's been triaged yet (given `formalityLevel`/`usageNote` in `data/raw/grammar/formality.json`).

**This list is a starting point, not a ground truth.** The clustering heuristic is crude (exact quoted-gloss overlap) - it will have false positives (points that share a gloss word but aren't actually near-synonyms needing differentiation) and false negatives (points with a real near-synonym elsewhere that happens to be glossed with different wording). Treat `needs-triage` as "worth a look," not "confirmed needs a formality entry" - some will turn out fine as-is (note that finding, don't just skip silently). `no-cluster-found` similarly isn't a guarantee the point has no synonym - just that this pass didn't surface one.

## Summary

| Status | Count |
|---|---|
| done (has formalityLevel/usageNote) | 39 |
| needs-triage (in a measured cluster, not yet done) | 287 |
| no-cluster-found (not caught by this pass) | 502 |
| **Total** | **828** |

Re-derive this table any time by grouping `compiled/grammar/points/*.json` on quoted `shortExplanation` gloss words (threshold >=3 distinct points, excluding the `,`/`it` noise clusters) - see gokan-srs#42 for the original measurement.

## Full list

| id | JLPT | Title | Status | Matched cluster gloss(es) |
|---|---|---|---|---|
| n1-001 | N1 | A うが B うが (A uga B uga) | — |  |
| n1-002 | N1 | A うと B うと (A uto B uto) | ⬜ needs-triage | whether a or b |
| n1-003 | N1 | A かたわら B (A katawara B) | — |  |
| n1-004 | N1 | A かれ B かれ (A kare B kare) | ⬜ needs-triage | whether a or b |
| n1-005 | N1 | A だの B だの (A dano B dano) | — |  |
| n1-006 | N1 | A であれ B であれ (A deare B deare) | ⬜ needs-triage | whether a or b |
| n1-007 | N1 | A というか B というか (A to iu ka B to iu ka) | — |  |
| n1-008 | N1 | A とも B とも (A tomo B tomo) | ⬜ needs-triage | whether a or b, either a or b |
| n1-009 | N1 | A にしろ B にしろ (A nishiro B nishiro) | — |  |
| n1-010 | N1 | A にせよ B にせよ (A ni seyo B ni seyo) | — |  |
| n1-011 | N1 | A につけ B につけ (A ni tsuke B ni tsuke) | — |  |
| n1-012 | N1 | A のやら B のやら (A no yara B no yara) | — |  |
| n1-013 | N1 | Noun1 が Noun1 なら、 Noun2 も Noun2 だ (A ga A nara, B mo B da) | — |  |
| n1-014 | N1 | Noun1 も Noun1 なら、Noun2 も Noun2 だ (A mo A nara, B mo B da) | — |  |
| n1-015 | N1 | Noun + あっての + Noun (A atte no B) | — |  |
| n1-016 | N1 | Noun かたがた (Noun kata gata) | ⬜ needs-triage | while |
| n1-017 | N1 | Noun がてら (Noun gatera) | ⬜ needs-triage | on the occasion of, along with |
| n1-018 | N1 | Noun からある (〜kara aru) | — |  |
| n1-019 | N1 | Noun からする (Noun kara suru) | — |  |
| n1-020 | N1 | Noun からの (~kara no) | — |  |
| n1-021 | N1 | Noun から言わせれば (~kara iwasereba) | — |  |
| n1-022 | N1 | Noun + ぐるみ (〜gurumi) | — |  |
| n1-023 | N1 | Noun こそあれ (~koso are) | — |  |
| n1-024 | N1 | Noun こそ～が (~koso~ga) | — |  |
| n1-025 | N1 | Noun こそすれ (~koso sure) | — |  |
| n1-026 | N1 | Noun ごとき / Noun ごとく (〜gotoki/〜gotoku) | — |  |
| n1-027 | N1 | Noun じゃあるまいし (~ja aru mai shi) | — |  |
| n1-028 | N1 | Noun ずくめ (~zukume) | ⬜ needs-triage | nothing but |
| n1-029 | N1 | Noun だけではすまない (Noun dake dewa sumanai) | — |  |
| n1-030 | N1 | Noun たりとも～ない (~tari tomo ~nai) | — |  |
| n1-031 | N1 | Noun たる Noun (~taru~) | — |  |
| n1-032 | N1 | Noun ですら (~desura) | ⬜ needs-triage | even, as much as |
| n1-033 | N1 | Noun でなくてなんだろう (〜de nakute nandarou) | — |  |
| n1-034 | N1 | Noun ではあるまいし (~dewa aru maishi) | — |  |
| n1-035 | N1 | Noun と Noun を兼ねて (Noun to Noun o kanete) | — |  |
| n1-036 | N1 | Noun といい Noun といい (〜to ii〜to ii) | — |  |
| n1-037 | N1 | Noun という Noun (~to iu~) | — |  |
| n1-038 | N1 | Noun というところだ (Noun to iu tokoro da) | ⬜ needs-triage | or |
| n1-039 | N1 | Noun + というもの (~ to iu mono) | — |  |
| n1-040 | N1 | Noun といったところだ (Noun to itta tokoro da) | ⬜ needs-triage | as much as |
| n1-041 | N1 | Noun といわず Noun といわず (A to iwazu B to iwazu) | — |  |
| n1-042 | N1 | Noun + ときたら (〜tokitara) | ⬜ needs-triage | speaking of |
| n1-043 | N1 | Noun とは比べものにならない (~to wa kurabemono ni naranai) | — |  |
| n1-044 | N1 | Noun + ともあろう + Noun (~tomoarou~) | — |  |
| n1-045 | N1 | Noun ともなると (〜to mo naru to) | — |  |
| n1-046 | N1 | Noun ともなれば (〜to mo nareba) | ⬜ needs-triage | when, once |
| n1-047 | N1 | Noun と相まって (~ to aimatte) | ⬜ needs-triage | along with, together with |
| n1-048 | N1 | Noun なくして～はない (Noun nakushite ~ wa nai) | — |  |
| n1-049 | N1 | Noun なしでは～ない (Noun nashi de wa ~nai) | — |  |
| n1-050 | N1 | Noun なしには～ない (Noun nashi ni wa ~nai) | — |  |
| n1-051 | N1 | Noun ならいざ知らず (~nara izashirazu) | — |  |
| n1-052 | N1 | Noun + ならでは (~nara de wa) | — |  |
| n1-053 | N1 | Noun なり Noun なり (A nari B nari) | ⬜ needs-triage | either a or b |
| n1-054 | N1 | Noun なりとも (~nari tomo) | ⬜ needs-triage | at least |
| n1-055 | N1 | Noun に Noun を重ねて (A ni B wo kasanete) | — |  |
| n1-056 | N1 | Noun にあっては (Noun ni atte ha) | — |  |
| n1-057 | N1 | Noun にあるまじき Noun (Noun ni aru majiki Noun) | — |  |
| n1-058 | N1 | Noun にして (Noun ni shite) | ✅ done | even though, in spite of |
| n1-059 | N1 | Noun にして初めて (Noun nishite hajimete) | — |  |
| n1-060 | N1 | Noun にすら (〜ni sura) | ⬜ needs-triage | even |
| n1-061 | N1 | Noun にとどまらず～も (~ ni todomarazu ~ mo) | — |  |
| n1-062 | N1 | Noun にひきかえ Noun は (~ni hikikae ~ wa) | ⬜ needs-triage | in contrast to |
| n1-063 | N1 | Noun にもまして (〜ni mo mashite) | — |  |
| n1-064 | N1 | Noun によらず (～ni yorazu) | — |  |
| n1-065 | N1 | Noun に先駆けて (〜ni saki gakete) | ⬜ needs-triage | before |
| n1-066 | N1 | Noun に即した Noun (A ni sokushita B) | ⬜ needs-triage | based on |
| n1-067 | N1 | Noun に即して Verb (〜ni soku shite ~) | ⬜ needs-triage | based on |
| n1-068 | N1 | Noun に言わせれば (Noun ni iwasereba) | ⬜ needs-triage | according to |
| n1-069 | N1 | Noun に限ったことではない (〜ni kagitta koto dewa nai) | ⬜ needs-triage | not only, not just |
| n1-070 | N1 | Noun に限ったことでもない (~ni kagitta koto demo nai) | ⬜ needs-triage | not just |
| n1-071 | N1 | Noun に限る (~ni kagiru) | ⬜ needs-triage | nothing but |
| n1-072 | N1 | Noun ぬいた Noun (A nuita B) | — |  |
| n1-073 | N1 | Noun + ぬいて（~nuite) | — |  |
| n1-074 | N1 |  ～ぬく (~nuku) | — |  |
| n1-075 | N1 | Noun+のいかんだ (Noun no ikan da) | — |  |
| n1-076 | N1 | Noun のいかんでは (Noun no ikan de wa) | — |  |
| n1-077 | N1 | Noun のいかんにかかわらず (Noun no ikan ni kakawarazu) | — |  |
| n1-078 | N1 | Noun のいかんによっては (Noun no ikan ni yotte wa) | — |  |
| n1-079 | N1 | Noun のいかんによらず (~ no ikan ni yorazu) | ⬜ needs-triage | regardless of |
| n1-080 | N1 | Noun のごとき Noun (A no gotoki B) | ⬜ needs-triage | like, as if |
| n1-081 | N1 | Noun のことだから (〜no koto dakara) | — |  |
| n1-082 | N1 | Noun の 嫌いがある (Noun no kirai ga aru) | — |  |
| n1-083 | N1 | Noun の手前 (~no temae) | — |  |
| n1-084 | N1 | Noun の極み (〜no kiwami) | — |  |
| n1-085 | N1 | Noun の 至り (~no itari) | — |  |
| n1-086 | N1 | Noun はいざ知らず (~ wa iza shirazu) | — |  |
| n1-087 | N1 | Noun はおろか～すら (Noun wa oroka ～sura) | — |  |
| n1-088 | N1 | Noun はおろか～まで (~wa oroka ~made) | — |  |
| n1-089 | N1 | Noun はおろか～も (Noun wa oroka ～ mo) | — |  |
| n1-090 | N1 | Noun はさておき (~ wa sateoki) | — |  |
| n1-091 | N1 | Noun + はどうであれ (~ wa dou de are) | ⬜ needs-triage | regardless of |
| n1-092 | N1 | Noun まみれ (~mamire) | — |  |
| n1-093 | N1 | Noun もさることながら Noun も (A mo saru koto nagara B mo) | ⬜ needs-triage | not only... but also |
| n1-094 | N1 | Noun も兼ねて (~mo kanete) | ⬜ needs-triage | also |
| n1-095 | N1 | Noun も相まって (~mo aimatte) | — |  |
| n1-096 | N1 | Noun を おいて他に Verb ない (〜wo oite hoka ni〜nai) | — |  |
| n1-097 | N1 | Noun をもって (~wo motte) | ⬜ needs-triage | with, at |
| n1-098 | N1 | Noun をものともせずに (Noun wo mono tomo sezu ni) | — |  |
| n1-099 | N1 | Noun をよそに (~wo yoso ni) | — |  |
| n1-100 | N1 | Noun を余儀なくされる (Noun wo yogi naku sareru) | — |  |
| n1-101 | N1 | Noun を前提として (Noun wo zentei toshite) | ⬜ needs-triage | based on |
| n1-102 | N1 | Noun を前提にして (Noun wo zentei ni shite) | — |  |
| n1-103 | N1 | Noun を境にして (Noun wo sakai ni shite) | — |  |
| n1-104 | N1 | Noun を機にして (~wo ki ni shite) | — |  |
| n1-105 | N1 | Noun を皮切りに / を皮切りにして (Noun wo kawakiri ni / wo kawakiri ni shite) | ⬜ needs-triage | starting with, beginning with |
| n1-106 | N1 | Noun を皮切りにして (Noun wo kawakiri ni shite) | ⬜ needs-triage | starting with, beginning with |
| n1-107 | N1 | Noun を禁じ得ない (〜wo kinjienai) | — |  |
| n1-108 | N1 | Noun を経て (〜wo hete) | ⬜ needs-triage | through |
| n1-109 | N1 | Noun を踏まえて (〜wo fumaete) | — |  |
| n1-110 | N1 | Noun を限りに (Noun wo kagiri ni) | ⬜ needs-triage | with |
| n1-111 | N1 | Noun 並み (~nami) | ⬜ needs-triage | like, as |
| n1-112 | N1 | Noun + 前提で (Noun + zentei de) | — |  |
| n1-113 | N1 | Verbる / Noun(である) + 限り(は) (kagiri (wa)) | ⬜ needs-triage | as long as |
| n1-114 | N1 | Verb がてら (~ gatera) | ⬜ needs-triage | while, on the occasion of |
| n1-115 | N1 | Verb こそすれ (~koso sure) | — |  |
| n1-116 | N1 | Verb させられる (~saserareru) | — |  |
| n1-117 | N1 | Verb ざるを得ない (~ zaru wo enai) | — |  |
| n1-118 | N1 | Verb ずじまい (~zu jimai) | — |  |
| n1-119 | N1 | Verb ずとも (〜zu tomo) | — |  |
| n1-120 | N1 | Verb ずにはおかない (~zuni wa okanai) | — |  |
| n1-121 | N1 | Verb ずにはすまない (Verb zuni wa sumanai) | ⬜ needs-triage | have to |
| n1-122 | N1 | Verb そうにない (Verb sou ni nai) | — |  |
| n1-123 | N1 | Verb そうもない (〜sou mo nai) | — |  |
| n1-124 | N1 | Verb そばから (〜soba kara) | — |  |
| n1-125 | N1 | Verb たが最後 (〜ta ga saigo) | ⬜ needs-triage | once, as soon as |
| n1-126 | N1 | Verb たことにしてください (~ ta koto ni shite kudasai) | — |  |
| n1-127 | N1 | Verb たら Verb たで (~ tara ~ tade) | — |  |
| n1-128 | N1 | Verb たら きりがない (Verb tara kiri ga nai) | — |  |
| n1-129 | N1 | Verb たら最後 (〜tara saigo) | — |  |
| n1-130 | N1 | Verb つ Verb つ (Verb tsu Verb tsu) | — |  |
| n1-131 | N1 | Verb てからというもの (Verb te kara to iu mono) | — |  |
| n1-132 | N1 | Verb てこそ (Verb te koso) | — |  |
| n1-133 | N1 | Verb ては (～te wa) | — |  |
| n1-134 | N1 | Verb ては Verb (~ te wa ~) | ⬜ needs-triage | whenever |
| n1-135 | N1 | Verb てまでも (~ temademo) | — |  |
| n1-136 | N1 | Verb てみせる (Verb te miseru) | — |  |
| n1-137 | N1 | Verb てやまない (Verb te yamanai) | ⬜ needs-triage | can |
| n1-138 | N1 | Verb ないではおかない (~ nai de wa okanai) | — |  |
| n1-139 | N1 | Verb ないではすまない (Verb nai dewa sumanai) | — |  |
| n1-140 | N1 | Verb ないまでも (Verb nai made mo) | — |  |
| n1-141 | N1 | Verb ないものだろうか (Verb nai mono darou ka) | — |  |
| n1-142 | N1 | Verb ないものでもない (Verb nai mono demo nai) | — |  |
| n1-143 | N1 | Verb の ない Noun (~ no nai ~) | — |  |
| n1-144 | N1 | Verb ば きりがない (〜ba kiri ga nai) | — |  |
| n1-145 | N1 | Verb もしないで (~ mo shinai de) | — |  |
| n1-146 | N1 | Verb やしない (~ yashinai) | — |  |
| n1-147 | N1 | Verb よう (~ you / ~ you ni) | — |  |
| n1-148 | N1 | Verb ようか Verbるまいか (Verb you ka Verb ru mai ka) | — |  |
| n1-149 | N1 | Verb ようが Verb るまいが (Verb you ga Verb ru mai ga) | — |  |
| n1-150 | N1 | Verb ようがない (〜you ga nai) | — |  |
| n1-151 | N1 | Verb ようと Verbる まいと (Verb you to Verb ru mai to) | — |  |
| n1-152 | N1 | Verb ようにも (〜you ni mo) | — |  |
| n1-153 | N1 | Verb ようにも Verb れない (〜you ni mo 〜renai) | — |  |
| n1-154 | N1 | Verb ようもない (~you mo nai) | — |  |
| n1-155 | N1 | Verbる がままに (〜ga mama ni) | — |  |
| n1-156 | N1 | Verbる が早いか (verb-ru ga hayai ka) | — |  |
| n1-157 | N1 | Verbる くらいなら (〜ru kurai nara) | — |  |
| n1-158 | N1 | Verbる こと なし に (Verb-ru koto nashi ni) | — |  |
| n1-159 | N1 | Verbる ことのないように (Verb-ru koto no nai you ni) | — |  |
| n1-160 | N1 | Verbる ときりがない (verb-ru to kiri ga nai) | — |  |
| n1-161 | N1 | Verbる ともなく Verb (Verb-ru tomonaku Verb) | — |  |
| n1-162 | N1 | Verbる ともなしに Verb (Verb-ru tomonashi ni Verb) | — |  |
| n1-163 | N1 | Verbる なり (Verb-ru nari) | ⬜ needs-triage | as soon as, the moment |
| n1-164 | N1 | Verbる にとどまらず～も (Verb-ru ni todomarazu ~ mo) | — |  |
| n1-165 | N1 | Verbる にはあたらない (Verb-ru ni wa ataranai) | — |  |
| n1-166 | N1 | Verbる にも (Verb-ru ni mo) | — |  |
| n1-167 | N1 | Verbる にも Verb れない (Verb-ru ni mo Verb-re nai) | — |  |
| n1-168 | N1 | Verbる べからざる Noun (Verb-ru bekara zaru Noun) | ⬜ needs-triage | must not, should not |
| n1-169 | N1 | Verbる べからず (〜ru bekara zu) | — |  |
| n1-170 | N1 | Verbる べく (Verb-ru beku) | ⬜ needs-triage | in order to |
| n1-171 | N1 | Verbる べくもない (Verb-ru beku mo nai) | ⬜ needs-triage | or |
| n1-172 | N1 | Verbる までもない (〜ru made mo nai) | — |  |
| n1-173 | N1 | Verbる ものとする (〜ru mono to suru) | — |  |
| n1-174 | N1 | Verbる や否や (Verb-ru ya ina ya) | ⬜ needs-triage | as soon as |
| n1-175 | N1 | Verbる 始末だ (〜ru shimatsu da) | — |  |
| n1-176 | N1 | Verbる 嫌いがある (～ru kirai ga aru) | — |  |
| n1-177 | N1 | いつまで～のやら (itsumade ~ no yara) | — |  |
| n1-178 | N1 | ～が Verb られる (〜ga Verb rareru) | ⬜ needs-triage | can |
| n1-179 | N1 | ～かと思いきや (〜ka to omoikiya) | — |  |
| n1-180 | N1 | ～がゆえに (～ga yue ni) | ✅ done | because, due to, as a result of |
| n1-181 | N1 | ～がゆえの Noun (〜ga yue no Noun) | ⬜ needs-triage | due to, because of |
| n1-182 | N1 | ～から Noun に 至る まで (〜kara 〜ni itaru made) | ⬜ needs-triage | from...to |
| n1-183 | N1 | ～ごとく (〜gotoku) | — |  |
| n1-184 | N1 | ～こととて (〜koto tote) | ✅ done | because, since |
| n1-185 | N1 | ～ずにすんだ (〜zuni sunda) | — |  |
| n1-186 | N1 | ～だろうとなかろうと (〜darou to nakarou to) | — |  |
| n1-187 | N1 | ～つもりだ (〜tsumori da) | — |  |
| n1-188 | N1 | ～つもりで (〜tsumori de) | — |  |
| n1-189 | N1 | ～ではすまない (〜dewa sumanai) | — |  |
| n1-190 | N1 | ～とあって (〜to atte) | — |  |
| n1-191 | N1 | ～とあれば (〜to areba) | ⬜ needs-triage | when, since, if |
| n1-192 | N1 | ～といえども (〜to iedomo) | — |  |
| n1-193 | N1 | ～といったらありはしない (〜to ittara ari wa shinai) | ⬜ needs-triage | extremely |
| n1-194 | N1 | ～といったらありゃしない (〜to ittara arya shinai) | — |  |
| n1-195 | N1 | ～といったらない (〜to ittara nai) | — |  |
| n1-196 | N1 | ～ときている (〜to kite iru) | — |  |
| n1-197 | N1 | ～ところを (〜tokoro wo) | — |  |
| n1-198 | N1 | ～とされる (〜to sareru) | — |  |
| n1-199 | N1 | ～としたところで (〜to shita tokoro de) | ⬜ needs-triage | even if |
| n1-200 | N1 | ～とすると (〜to suru to) | ⬜ needs-triage | when, if |
| n1-201 | N1 | ～とすれば (～to sureba) | — |  |
| n1-202 | N1 | ～となったら (〜to nattara) | — |  |
| n1-203 | N1 | ～となると (〜to naru to) | — |  |
| n1-204 | N1 | ～となれば (〜to nareba) | — |  |
| n1-205 | N1 | ～とのことだ (〜to no koto da) | ⬜ needs-triage | i |
| n1-206 | N1 | ～とはいえ (～to wa ie) | — |  |
| n1-207 | N1 | ～とみえて (〜to miete) | — |  |
| n1-208 | N1 | ～とみられる (～to mirareru) | — |  |
| n1-209 | N1 | ～とみると (〜to miru to) | ⬜ needs-triage | considering |
| n1-210 | N1 | どんなに～うが (donna ni ～ u ga) | — |  |
| n1-211 | N1 | ～と言わんばかりに (〜to iwan bakari ni) | — |  |
| n1-212 | N1 | ～と言わんばかりの Noun (～to iwan bakari no Noun) | — |  |
| n1-213 | N1 | ～ながらに (～nagara ni) | — |  |
| n1-214 | N1 | ～ながらの Noun (〜nagara no Noun) | — |  |
| n1-215 | N1 | ～ながらも (〜nagara mo) | ✅ done | even though, despite |
| n1-216 | N1 | ～なくはない (〜naku wa nai) | — |  |
| n1-217 | N1 | ～なくもない (〜naku mo nai) | — |  |
| n1-218 | N1 | ～なら～なりに | — |  |
| n1-219 | N1 | ～には及ばない (〜ni wa oyobanai) | — |  |
| n1-220 | N1 | ～に堪えない (～ni taenai) | — |  |
| n1-221 | N1 | ～に堪える (～ni taeru) | — |  |
| n1-222 | N1 | ～に耐える (～ni taeru) | — |  |
| n1-223 | N1 | ～に至った (〜ni itatta) | — |  |
| n1-224 | N1 | ～に越したことはない (〜ni koshita koto wa nai) | — |  |
| n1-225 | N1 | ～に難くない (～ni katakunai) | — |  |
| n1-226 | N1 | ～のは Noun ぐらいのものだ (〜no wa Noun gurai no mono da) | — |  |
| n1-227 | N1 | ～ば～ものを (～ba～mono o) | ⬜ needs-triage | if only |
| n1-228 | N1 | ～びた (～bita) | — |  |
| n1-229 | N1 | ～びる (〜biru) | — |  |
| n1-230 | N1 | ～ぶった (～butta) | — |  |
| n1-231 | N1 | ～ぶって (〜butte) | — |  |
| n1-232 | N1 | ～ぶり (〜buri) | — |  |
| n1-233 | N1 | ～ぶる (〜buru) | — |  |
| n1-234 | N1 | ～までだ (～made da) | — |  |
| n1-235 | N1 | ～もなんでもない (〜mo nandemonai) | — |  |
| n1-236 | N1 | ～ものとして (～mono to shite) | ⬜ needs-triage | assuming |
| n1-237 | N1 | ～んがために (〜n ga tame ni) | ⬜ needs-triage | in order to, for the sake of |
| n1-238 | N1 | ～んばかりに (〜n bakari ni) | — |  |
| n1-239 | N1 | ～差し支えない (〜sashitsukaenai) | — |  |
| n1-240 | N1 | ～折に (〜ori ni) | ⬜ needs-triage | when, at the time of |
| n1-241 | N1 | ～極まりない (〜kiwamarinai) | ⬜ needs-triage | extremely |
| n1-242 | N1 | ～極まる (〜kiwamaru) | — |  |
| n1-243 | N1 | ～足りない (～tarinai) | — |  |
| n1-244 | N1 | ～足る Noun (〜taru Noun) | — |  |
| n1-245 | N1 | ～限りだ (〜kagiri da) | — |  |
| n2-001 | N2 | A あるいは B (A aruiwa B) | ⬜ needs-triage | either a or b |
| n2-002 | N2 | A。おまけに B。(~omake ni) | ⬜ needs-triage | not only, moreover, besides |
| n2-003 | N2 | A。さて B。(A. Sate B.) | ⬜ needs-triage | so |
| n2-004 | N2 | A。しかも B。(A. Shikamo B.) | ⬜ needs-triage | moreover, besides, furthermore |
| n2-005 | N2 | A。したがって B。(A. Shitagatte B.) | ⬜ needs-triage | so, therefore |
| n2-006 | N2 | A すなわち B。 (A sunawachi B) | ⬜ needs-triage | in other words, that is to say |
| n2-007 | N2 | A。すると B。(~suruto) | ⬜ needs-triage | when, if, then |
| n2-008 | N2 | A。そういえば B。(~souieba) | ⬜ needs-triage | by the way |
| n2-009 | N2 | A。そこで B。(~sokode) | ⬜ needs-triage | therefore |
| n2-010 | N2 | A。それがB。(~sorega) | ⬜ needs-triage | that |
| n2-011 | N2 | A。それで B。 (~sore de) | ⬜ needs-triage | so, and then |
| n2-012 | N2 | A。それでも B。(~sore demo) | ⬜ needs-triage | but |
| n2-013 | N2 | A。それなのに B。(~sorenanoni) | ✅ done | even though, despite |
| n2-014 | N2 | A。それなら B。(A. Sore nara B.) | — |  |
| n2-015 | N2 | A それはそうと B。 (A Sore wa sou to B) | ⬜ needs-triage | by the way |
| n2-016 | N2 | A。だが B。(~daga) | ⬜ needs-triage | but, however |
| n2-017 | N2 | A。ただB。(~tada) | ⬜ needs-triage | but, however, although |
| n2-018 | N2 | A。ただしB。 (A. Tadashi B) | ⬜ needs-triage | however |
| n2-019 | N2 | A。だって B。(Datte~) | ✅ done | because, since |
| n2-020 | N2 | A。ちなみに B。(A. Chinamini B.) | ⬜ needs-triage | by the way |
| n2-021 | N2 | A。ということは B。 (A. To iu koto wa B.) | — |  |
| n2-022 | N2 | A。というのは B。(Toiu no wa~) | ⬜ needs-triage | in other words, that is to say |
| n2-023 | N2 | A。なおB。(A. Nao B.) | ⬜ needs-triage | moreover, besides |
| n2-024 | N2 | A。もっとも B。(Motto mo ~) | ⬜ needs-triage | but, however, although |
| n2-025 | N2 | A。要するに B。(A. Yousuru ni B.) | — |  |
| n2-026 | N2 | Noun につき (〜ni tsuki) | ⬜ needs-triage | due to, regarding |
| n2-027 | N2 | Noun にて (Noun nite) | ⬜ needs-triage | with, at, in, by |
| n2-028 | N2 | Noun の ことだから (Noun no koto dakara) | — |  |
| n2-029 | N2 | Noun を はじめ (Noun wo hajime) | ⬜ needs-triage | not only... but also, starting with, including |
| n2-030 | N2 | Noun を はじめとして (Noun wo hajime to shite) | ⬜ needs-triage | starting with, beginning with, including |
| n2-031 | N2 | Noun を はじめとする Noun (Noun o hajime to suru Noun) | ⬜ needs-triage | starting with, including, such as |
| n2-032 | N2 | Noun を めぐって (Noun wo megutte) | — |  |
| n2-033 | N2 | Noun を めぐる Noun (Noun o meguru Noun) | ⬜ needs-triage | regarding, concerning |
| n2-034 | N2 | Noun を もとに (Noun o moto ni) | — |  |
| n2-035 | N2 | Noun を もとにして (Noun wo moto ni shite) | — |  |
| n2-036 | N2 | Verb ことなく (~kotonaku) | — |  |
| n2-037 | N2 | Verb ないことには Verb ない (~nai koto ni wa ~ nai) | — |  |
| n2-038 | N2 | ～あげく (~ageku) | ⬜ needs-triage | after |
| n2-039 | N2 | ～あまり (〜amari) | — |  |
| n2-040 | N2 | ～うちに (〜uchi ni) | ⬜ needs-triage | while, before, as long as |
| n2-041 | N2 | ～がい (〜gai) | — |  |
| n2-042 | N2 | ～かいがあって (〜kaiga atte) | — |  |
| n2-043 | N2 | ～かいもなく (〜kai mo naku) | — |  |
| n2-044 | N2 | ～かける (〜kakeru) | — |  |
| n2-045 | N2 | ～がち (〜gachi) | — |  |
| n2-046 | N2 | ～か～ないかのうちに (〜ka〜naika no uchi ni) | ⬜ needs-triage | as soon as, the moment |
| n2-047 | N2 | ～かねない (〜kane nai) | — |  |
| n2-048 | N2 | ～かねる (〜kaneru) | — |  |
| n2-049 | N2 | ～かのようだ (〜ka no you da) | ⬜ needs-triage | like, as if |
| n2-050 | N2 | ～か～まいか (〜ka 〜maika) | — |  |
| n2-051 | N2 | ～からこそ (〜kara koso) | — |  |
| n2-052 | N2 | 〜からして (〜kara shite) | — |  |
| n2-053 | N2 | ～からすると (〜kara suru to) | ⬜ needs-triage | considering |
| n2-054 | N2 | ～からといって (〜kara to itte) | ⬜ needs-triage | or |
| n2-055 | N2 | ～から～にかけて (〜kara 〜ni kakete) | ⬜ needs-triage | from...to, over |
| n2-056 | N2 | ～からには (〜kara niwa) | ⬜ needs-triage | since, if |
| n2-057 | N2 | ～から見ると (〜kara miru to) | ⬜ needs-triage | in terms of, from the perspective of |
| n2-058 | N2 | ～から言うと (〜kara iuto) | ⬜ needs-triage | in terms of |
| n2-059 | N2 | ～くせに (〜kuse ni) | — |  |
| n2-060 | N2 | ～ことから (〜koto kara) | ✅ done | because, due to, since |
| n2-061 | N2 | ～ことに (〜koto ni) | — |  |
| n2-062 | N2 | ～ことになっている (〜koto ni natte iru) | — |  |
| n2-063 | N2 | ～さえ～ば (〜sae ~ba) | ⬜ needs-triage | if only |
| n2-064 | N2 | ～ざるを得ない (〜zaru wo enai) | — |  |
| n2-065 | N2 | ～ずにはいられない (〜zu ni wa irarenai) | — |  |
| n2-066 | N2 | ～そうにない (〜sou ni nai) | — |  |
| n2-067 | N2 | ～たかと思ったら (〜ta ka to omottara) | ⬜ needs-triage | as soon as |
| n2-068 | N2 | ～たきり (〜takiri) | ⬜ needs-triage | after |
| n2-069 | N2 | ～だけあって (〜dake atte) | — |  |
| n2-070 | N2 | ～だけましだ (〜dake mashi da) | — |  |
| n2-071 | N2 | ～たところ (〜ta tokoro) | — |  |
| n2-072 | N2 | ～たとたん (〜ta totan) | ⬜ needs-triage | as soon as |
| n2-073 | N2 | ～だらけ (〜darake) | — |  |
| n2-074 | N2 | ～っこない (〜kkonai) | — |  |
| n2-075 | N2 | ～つつ (〜tsutsu) | ⬜ needs-triage | while, although |
| n2-076 | N2 | ～つつある (〜tsutsu aru) | — |  |
| n2-077 | N2 | ～っぱなし (〜ppanashi) | — |  |
| n2-078 | N2 | ～っぽい (〜ppoi) | — |  |
| n2-079 | N2 | ～ていられない (〜te irarenai) | ⬜ needs-triage | can |
| n2-080 | N2 | ～てかなわない (〜te kanawanai) | — |  |
| n2-081 | N2 | ～てからでないと (〜te kara denai to) | — |  |
| n2-082 | N2 | ～てこそ (〜te koso) | — |  |
| n2-083 | N2 | ～でしょうがない (〜deshou ga nai) | ⬜ needs-triage | extremely |
| n2-084 | N2 | ～でたまらない (〜de tamaranai) | ⬜ needs-triage | can |
| n2-085 | N2 | ～でならない (〜de naranai) | — |  |
| n2-086 | N2 | ～でばかりはいられない (〜de bakari wa irarenai) | — |  |
| n2-087 | N2 | ～ではないか (〜de wa nai ka) | — |  |
| n2-088 | N2 | ～てはならない (〜te wa naranai) | ⬜ needs-triage | must not, should not |
| n2-089 | N2 | ～てまで (〜te made) | ⬜ needs-triage | even |
| n2-090 | N2 | ～て当然だ (〜te tōzen da) | — |  |
| n2-091 | N2 | ～というものだ (〜to iu mono da) | — |  |
| n2-092 | N2 | どうにか～ないものか (dō ni ka ~ nai mono ka) | — |  |
| n2-093 | N2 | ～とおり (〜toori) | ⬜ needs-triage | according to, as |
| n2-094 | N2 | ～とか (〜to ka) | ⬜ needs-triage | like, such as |
| n2-095 | N2 | ～ところ (〜tokoro) | ⬜ needs-triage | when, in the middle of |
| n2-096 | N2 | ～どころか (〜dokoro ka) | ⬜ needs-triage | not only, not just |
| n2-097 | N2 | ～どころではない (〜dokoro de wa nai) | — |  |
| n2-098 | N2 | ～としたら (〜to shitara) | ⬜ needs-triage | if, assuming, suppose |
| n2-099 | N2 | ～としても (〜to shite mo) | — |  |
| n2-100 | N2 | ～と～ともに (〜to 〜tomoni) | ⬜ needs-triage | along with, together with |
| n2-101 | N2 | ～とは限らない (〜to wa kagiranai) | — |  |
| n2-102 | N2 | ～ないことはない (〜nai koto wa nai) | — |  |
| n2-103 | N2 | ～ないこともない (〜nai koto mo nai) | — |  |
| n2-104 | N2 | ～ないではいられない (〜nai de wa irarenai) | — |  |
| n2-105 | N2 | ～ながら (〜nagara) | — |  |
| n2-106 | N2 | ～にあたり (〜ni atari) | ⬜ needs-triage | at the time of, in, upon |
| n2-107 | N2 | ～において (〜ni oite) | ⬜ needs-triage | at, regarding, in |
| n2-108 | N2 | ～にかかわらず (〜ni kakawarazu) | — |  |
| n2-109 | N2 | ～にかけては (〜ni kakete wa) | — |  |
| n2-110 | N2 | ～にしたがって (〜ni shitagatte) | ⬜ needs-triage | with, as |
| n2-111 | N2 | ～にしたら (〜ni shitara) | ⬜ needs-triage | from the perspective of |
| n2-112 | N2 | ～にしろ～にしろ (〜ni shiro 〜ni shiro) | — |  |
| n2-113 | N2 | ～につけ～につけ (〜ni tsuke 〜ni tsuke) | ⬜ needs-triage | whenever |
| n2-114 | N2 | ～につれて (〜ni tsurete) | ⬜ needs-triage | while, along with, as |
| n2-115 | N2 | ～にともなって (〜ni tomonatte) | ⬜ needs-triage | along with, as a result of |
| n2-116 | N2 | ～にほかならない (〜ni hoka naranai) | ⬜ needs-triage | nothing but |
| n2-117 | N2 | ～にもかかわらず (〜ni mo kakawarazu) | ✅ done | even though, in spite of, despite |
| n2-118 | N2 | ～により (〜ni yori) | ⬜ needs-triage | through, due to, by |
| n2-119 | N2 | ～にわたって (〜ni watatte) | ⬜ needs-triage | over |
| n2-120 | N2 | ～に先立ち (〜ni sakidachi) | ⬜ needs-triage | before |
| n2-121 | N2 | ～に反して (〜ni hanshite) | — |  |
| n2-122 | N2 | ～に基づいて (〜ni motozuite) | — |  |
| n2-123 | N2 | ～に対して (〜ni taishite) | ⬜ needs-triage | in contrast to, toward |
| n2-124 | N2 | ～に応えて (〜ni kotaete) | — |  |
| n2-125 | N2 | ～に応じて (〜ni oujite) | — |  |
| n2-126 | N2 | ～に決まっている (〜ni kimatte iru) | — |  |
| n2-127 | N2 | ～に沿って (〜ni sotte) | — |  |
| n2-128 | N2 | ～に過ぎない (〜ni suginai) | ⬜ needs-triage | just, only |
| n2-129 | N2 | ～に関わって (〜ni kakawatte) | ⬜ needs-triage | regarding, concerning |
| n2-130 | N2 | ～に限り (〜ni kagiri) | ⬜ needs-triage | only |
| n2-131 | N2 | ～に際して (〜ni saishite) | ⬜ needs-triage | when, at the time of, upon |
| n2-132 | N2 | ～ねばならない (〜neba naranai) | ✅ done | have to, must, need to |
| n2-133 | N2 | ～のみならず～も (〜nomi narazu 〜mo) | — |  |
| n2-134 | N2 | ～のももっともだ (〜no mo mottomo da) | — |  |
| n2-135 | N2 | 〜の上では (〜no ue de wa) | ⬜ needs-triage | in terms of |
| n2-136 | N2 | ～の下で (〜no shita de) | — |  |
| n2-137 | N2 | ～ばかりか〜も (〜bakari ka 〜 mo) | ⬜ needs-triage | not only... but also |
| n2-138 | N2 | ～ばかりだ (〜bakari da) | ⬜ needs-triage | just, only, always |
| n2-139 | N2 | ～ばかりに (〜bakari ni) | ⬜ needs-triage | due to |
| n2-140 | N2 | ～ば～というものでもない (〜ba 〜to iu mono demo nai) | — |  |
| n2-141 | N2 | ～はともかく～は (〜wa tomokaku 〜wa) | — |  |
| n2-142 | N2 | ～はまだしも (〜wa mada shimo) | — |  |
| n2-143 | N2 | ～はもとより (〜wa moto yori) | — |  |
| n2-144 | N2 | ～は抜きにして (〜wa nuki ni shite) | — |  |
| n2-145 | N2 | ～べきではない (〜beki dewa nai) | ⬜ needs-triage | should not |
| n2-146 | N2 | ～まい (〜mai) | — |  |
| n2-147 | N2 | ～まで～て (〜made 〜te) | ⬜ needs-triage | until, to |
| n2-148 | N2 | ～ままに (〜mama ni) | — |  |
| n2-149 | N2 | ～もかまわず (〜mo kamawazu) | — |  |
| n2-150 | N2 | ～ものか (〜mono ka) | — |  |
| n2-151 | N2 | ～ものがある (〜mono ga aru) | — |  |
| n2-152 | N2 | ～ものだ (〜mono da) | ⬜ needs-triage | should |
| n2-153 | N2 | ～ものだから (〜mono dakara) | ✅ done | because, due to, since |
| n2-154 | N2 | ～ものではない (〜mono dewa nai) | ⬜ needs-triage | must not, should not |
| n2-155 | N2 | ～ものなら (〜mono nara) | ⬜ needs-triage | if only |
| n2-156 | N2 | ～ものの、～ (〜mono no、～) | ⬜ needs-triage | but, although |
| n2-157 | N2 | ～も～ば～も～ (〜mo〜ba〜mo〜) | — |  |
| n2-158 | N2 | ～も同然だ (〜mo douzen da) | — |  |
| n2-159 | N2 | ～やら～やら (〜yara〜yara) | — |  |
| n2-160 | N2 | ～ようがない (〜you ga nai) | — |  |
| n2-161 | N2 | ～よりほかない (〜yori hoka nai) | — |  |
| n2-162 | N2 | ～わけがない (〜wake ga nai) | — |  |
| n2-163 | N2 | ～わけだ (〜wake da) | ⬜ needs-triage | the reason is |
| n2-164 | N2 | ～わけではない (〜wake dewa nai) | — |  |
| n2-165 | N2 | ～わけにはいかない (〜wake ni wa ikanai) | — |  |
| n2-166 | N2 | ～をきっかけに (〜wo kikkake ni) | — |  |
| n2-167 | N2 | ～を～として (〜wo〜toshite) | ⬜ needs-triage | as |
| n2-168 | N2 | ～を中心に (〜wo chuushin ni) | — |  |
| n2-169 | N2 | ～を問わず (〜wo towazu) | ⬜ needs-triage | regardless of |
| n2-170 | N2 | ～を込めて (〜wo komete) | — |  |
| n2-171 | N2 | ～を通じて (〜wo tsuujite) | ⬜ needs-triage | through, during |
| n2-172 | N2 | ～を頼りに (〜wo tayori ni) | — |  |
| n2-173 | N2 | ～一方 (〜ippou) | — |  |
| n2-174 | N2 | ～一方だ (〜ippou da) | — |  |
| n2-175 | N2 | ～上で (〜ue de) | ⬜ needs-triage | after, upon |
| n2-176 | N2 | ～上に (〜ue ni) | ⬜ needs-triage | not only... but also, besides |
| n2-177 | N2 | ～上は (～ue wa) | ⬜ needs-triage | once, since |
| n2-178 | N2 | ～以上 (〜ijou) | ⬜ needs-triage | as long as, since |
| n2-179 | N2 | ～以来 (〜irai) | ⬜ needs-triage | since, after |
| n2-180 | N2 | ～切る (〜kiru) | — |  |
| n2-181 | N2 | ～反面 (〜hanmen) | — |  |
| n2-182 | N2 | ～向け (〜muke) | — |  |
| n2-183 | N2 | ～恐れがある (〜osore ga aru) | — |  |
| n2-184 | N2 | ～折には (〜ori ni wa) | ⬜ needs-triage | when |
| n2-185 | N2 | ～末 (～sue) | ⬜ needs-triage | as a result of, after |
| n2-186 | N2 | ～次第 (〜shidai) | ⬜ needs-triage | as soon as |
| n2-187 | N2 | ～次第で (〜shidai de) | — |  |
| n2-188 | N2 | ～次第です (〜shidai desu) | — |  |
| n2-189 | N2 | ～気味 (〜gimi) | — |  |
| n2-190 | N2 | ～限り (〜kagiri) | ⬜ needs-triage | while, as long as |
| n2-191 | N2 | ～際に (〜sai ni) | ⬜ needs-triage | while, on the occasion of, when |
| n3-001 | N3 | A その上 B (A sono ue B) | ⬜ needs-triage | besides, furthermore |
| n3-002 | N3 | ～うちに (〜uchi ni) | ⬜ needs-triage | while, before, during |
| n3-003 | N3 | ～うとした (〜uto shita) | — |  |
| n3-004 | N3 | ～おかげで (〜okagede) | ⬜ needs-triage | because of |
| n3-005 | N3 | ～かけ (〜kake) | — |  |
| n3-006 | N3 | ～かなあ (〜kanaa) | ⬜ needs-triage | i wonder, maybe |
| n3-007 | N3 | ～ないで (〜naide) | — |  |
| n3-008 | N3 | ～から～にかけて (〜kara 〜ni kakete) | ⬜ needs-triage | from...to |
| n3-009 | N3 | ～かわりに (〜kawari ni) | — |  |
| n3-010 | N3 | ～きり (〜kiri) | ⬜ needs-triage | since, after, only |
| n3-011 | N3 | ～くせに (〜kuse ni) | ✅ done | even though, in spite of, despite |
| n3-012 | N3 | ～くらい (〜kurai) | ⬜ needs-triage | about, approximately |
| n3-013 | N3 | ～くらい～は～ない (〜kurai 〜wa 〜nai) | ⬜ needs-triage | at least |
| n3-014 | N3 | ～こそ (〜koso) | — |  |
| n3-015 | N3 | ～こと (〜koto) | — |  |
| n3-016 | N3 | ～ことだ (〜koto da) | ⬜ needs-triage | should |
| n3-017 | N3 | ～ことにしている (〜koto ni shite iru) | — |  |
| n3-018 | N3 | ～ことになっている (〜koto ni natte iru) | — |  |
| n3-019 | N3 | ～ことは…が (～koto wa... ga) | — |  |
| n3-020 | N3 | ～ことはない (〜koto wa nai) | — |  |
| n3-021 | N3 | ～さ (〜sa) | — |  |
| n3-022 | N3 | ～さえ (～sae) | ⬜ needs-triage | even, as long as, if only |
| n3-023 | N3 | ～しかない (〜shika nai) | ⬜ needs-triage | only |
| n3-024 | N3 | すこしも〜ない (sukoshimo~nai) | ⬜ needs-triage | not at all |
| n3-025 | N3 | ～ずに (〜zu ni) | — |  |
| n3-026 | N3 | ～せいで (〜sei de) | — |  |
| n3-027 | N3 | ～せてください (〜sete kudasai) | — |  |
| n3-028 | N3 | ～そのために (〜sono tame ni) | — |  |
| n3-029 | N3 | ～その結果 (〜sono kekka) | — |  |
| n3-030 | N3 | ～それと～ (〜sore to〜) | ⬜ needs-triage | also, and |
| n3-031 | N3 | ～？それとも～？ (～? sore tomo ～?) | ⬜ needs-triage | or |
| n3-032 | N3 | ～だけしか (～dake shika) | ⬜ needs-triage | nothing but, only |
| n3-033 | N3 | だけど (dakedo) | ✅ done | even though, but, however |
| n3-034 | N3 | ～たて (～tate) | ⬜ needs-triage | just |
| n3-035 | N3 | ～たとえ～ても (〜tatoe〜temo) | ⬜ needs-triage | even if |
| n3-036 | N3 | ～たところ (〜ta tokoro) | ⬜ needs-triage | after, upon |
| n3-037 | N3 | ～たとたん (〜ta totan) | ⬜ needs-triage | as soon as, the moment |
| n3-038 | N3 | ～たびに (〜tabi ni) | ⬜ needs-triage | whenever |
| n3-039 | N3 | ～だものだ (〜da mono da) | — |  |
| n3-040 | N3 | ～ちゃった (〜chatta) | — |  |
| n3-041 | N3 | ～ついでに (〜tsuide ni) | ⬜ needs-triage | while, by the way |
| n3-042 | N3 | ～っけ？ (〜kke?) | — |  |
| n3-043 | N3 | ～っぱい (〜ppai) | — |  |
| n3-044 | N3 | ～っぱなし (〜ppanashi) | — |  |
| n3-045 | N3 | ～つまり (〜tsumari) | ⬜ needs-triage | in other words, that is to say |
| n3-046 | N3 | ～つもりでした (〜tsumori deshita) | — |  |
| n3-047 | N3 | ～てくれと (〜te kureto) | — |  |
| n3-048 | N3 | ～てごらん (〜te goran) | — |  |
| n3-049 | N3 | ですから～ (desu kara) | ✅ done | because, since, so |
| n3-050 | N3 | ～てはじめて (〜te hajimete) | — |  |
| n3-051 | N3 | ～てほしい (〜te hoshii) | — |  |
| n3-052 | N3 | ～ても (〜temo) | ✅ done | even though, even if, although |
| n3-053 | N3 | ～といいなあ (〜to ii naa) | — |  |
| n3-054 | N3 | ～という (〜to iu) | ⬜ needs-triage | like, that is to say |
| n3-055 | N3 | ～ということだ (〜to iu koto da) | ⬜ needs-triage | i heard |
| n3-056 | N3 | ～というと (〜to iu to) | ⬜ needs-triage | speaking of |
| n3-057 | N3 | ～というの～ (〜to iu no〜) | — |  |
| n3-058 | N3 | ～というのは (〜to iu no wa) | — |  |
| n3-059 | N3 | ～というより (〜to iu yori) | — |  |
| n3-060 | N3 | ～といっても (〜to ittemo) | ✅ done | even though, but, although |
| n3-061 | N3 | ～とおり (〜toori) | — |  |
| n3-062 | N3 | ～とく (〜toku) | — |  |
| n3-063 | N3 | ～ところが (〜tokoro ga) | ✅ done | even though, but, however |
| n3-064 | N3 | ～ところだった (〜tokoro datta) | ⬜ needs-triage | almost |
| n3-065 | N3 | ところで (tokorode) | ⬜ needs-triage | speaking of, by the way |
| n3-066 | N3 | ～としたら (〜to shitara) | ⬜ needs-triage | if, assuming, suppose |
| n3-067 | N3 | ～として (〜to shite) | ⬜ needs-triage | as |
| n3-068 | N3 | ～どんなに～ことか (〜donna ni〜koto ka) | — |  |
| n3-069 | N3 | どんなに～ても (donna ni ~ temo) | ⬜ needs-triage | even if |
| n3-070 | N3 | ～ないことはない (〜nai koto wa nai) | — |  |
| n3-071 | N3 | ～ないと (〜nai to) | ✅ done | must |
| n3-072 | N3 | ～なぜなら (〜nazenara) | ✅ done | because, the reason is |
| n3-073 | N3 | ～など (〜nado) | ⬜ needs-triage | such as |
| n3-074 | N3 | ～なんか (〜nanka) | — |  |
| n3-075 | N3 | ～において (〜ni oite) | — |  |
| n3-076 | N3 | ～にかわって (〜ni kawatte) | — |  |
| n3-077 | N3 | ～にしては (〜ni shite wa) | ⬜ needs-triage | considering, for |
| n3-078 | N3 | ～にしても (〜ni shitemo) | ⬜ needs-triage | regardless of, even if |
| n3-079 | N3 | ～について (〜ni tsuite) | ⬜ needs-triage | regarding, concerning, about |
| n3-080 | N3 | ～にとって (〜ni totte) | ⬜ needs-triage | from the perspective of, to, for |
| n3-081 | N3 | ～によって (〜ni yotte) | — |  |
| n3-082 | N3 | ～によれば (〜ni yoreba) | ⬜ needs-triage | based on, according to, by |
| n3-083 | N3 | ～に対して (～ni taishite) | ⬜ needs-triage | in contrast to, toward |
| n3-084 | N3 | ～に比べて (〜ni kurabete) | — |  |
| n3-085 | N3 | ～に関して (〜ni kanshite) | — |  |
| n3-086 | N3 | ～の～ (〜no 〜) | — |  |
| n3-087 | N3 | ～ばかり (〜bakari) | ⬜ needs-triage | nothing but, just, only, always |
| n3-088 | N3 | ～ばかりか (〜bakarika) ～も (mo) | — |  |
| n3-089 | N3 | ～はずだ (〜hazu da) | ⬜ needs-triage | should |
| n3-090 | N3 | ～ば～のに (〜ba 〜noni) | ⬜ needs-triage | if only |
| n3-091 | N3 | ～ば～ほど (〜ba 〜hodo) | — |  |
| n3-092 | N3 | ～はもちろん～も (〜wa mochiron 〜mo) | ⬜ needs-triage | not only... but also |
| n3-093 | N3 | ～ばよかった (〜ba yokatta) | — |  |
| n3-094 | N3 | ～ふりをする (〜furi wo suru) | — |  |
| n3-095 | N3 | ～べきだ (〜beki da) | — |  |
| n3-096 | N3 | ～ほど～ (〜hodo〜) | ⬜ needs-triage | as much as, about |
| n3-097 | N3 | ～ますように (〜masu you ni) | — |  |
| n3-098 | N3 | まったく～ない (mattaku ~nai) | — |  |
| n3-099 | N3 | ～まで (〜made) | ⬜ needs-triage | until |
| n3-100 | N3 | ～まま (〜mama) | — |  |
| n3-101 | N3 | まるで～よう (maru de ~ you) | ⬜ needs-triage | as if |
| n3-102 | N3 | ～てみる (〜te miru) | — |  |
| n3-103 | N3 | ～みたいだ (〜mitai da) | ⬜ needs-triage | like |
| n3-104 | N3 | ～めったに～ない (〜metta ni 〜nai) | — |  |
| n3-105 | N3 | ～めったにない (〜metta ni nai) | — |  |
| n3-106 | N3 | もしかすると〜かもしれない (moshikasuru to 〜kamoshirenai) | ⬜ needs-triage | maybe |
| n3-107 | N3 | もし～たなら (moshi ~ tanara) | ⬜ needs-triage | if |
| n3-108 | N3 | もし～ても (moshi ~ temo) | ⬜ needs-triage | even if |
| n3-109 | N3 | もしも～なら (moshimo ~ nara) | ⬜ needs-triage | if, suppose |
| n3-110 | N3 | ～ようとしない (〜you to shinai) | — |  |
| n3-111 | N3 | ～ようと思う (〜you to omou) | — |  |
| n3-112 | N3 | ～ように (〜you ni) | ⬜ needs-triage | like, as, in order to |
| n3-113 | N3 | ～ように (〜you ni) | — |  |
| n3-114 | N3 | ～ように (〜you ni) | ⬜ needs-triage | like, as if, in order to |
| n3-115 | N3 | ～ようにしましょう (〜you ni shimashou) | — |  |
| n3-116 | N3 | ～ようになった (〜you ni natta) | — |  |
| n3-117 | N3 | ～ように言う (〜you ni iu) | — |  |
| n3-118 | N3 | ～らしい (〜rashii) | ⬜ needs-triage | i heard, it seems |
| n3-119 | N3 | ～られた (〜rareta) | — |  |
| n3-120 | N3 | ～ている (〜te iru) | — |  |
| n3-121 | N3 | ～わけがない (〜wake ga nai) | — |  |
| n3-122 | N3 | ～わけだ (〜wake da) | ⬜ needs-triage | that |
| n3-123 | N3 | ～わけではない (〜wake dewa nai) | — |  |
| n3-124 | N3 | ～わけにはいかない (〜wake ni wa ikanai) | — |  |
| n3-125 | N3 | ～わりには (〜wari ni wa) | ✅ done | even though, considering, despite |
| n3-126 | N3 | ～んだって (〜n datte) | ⬜ needs-triage | i heard |
| n3-127 | N3 | ～んだもん (〜nda mon) | ✅ done | because, that |
| n3-128 | N3 | ～上げる (〜ageru) | — |  |
| n3-129 | N3 | ～切れない (～kirenai) | — |  |
| n3-130 | N3 | 必ずしも～とは限らない (kanarazushimo ～ towa kagiranai) | — |  |
| n3-131 | N3 | ～最中に (～saichuu ni) | — |  |
| n3-132 | N3 | 決して～ない (kesshite ~ nai) | ⬜ needs-triage | not at all |
| n4-001 | N4 | A とか B とか | ⬜ needs-triage | like, such as |
| n4-002 | N4 | A は B ほど～ありません (A wa B hodo ～ arimasen) | — |  |
| n4-003 | N4 | A は B ほど～ない (A wa B hodo ~ nai) | — |  |
| n4-004 | N4 | A より B のほうが〜 (A yori B no hou ga 〜) | — |  |
| n4-005 | N4 | い-Adjective く する/なる (i-Adjective kusuru/naru) | — |  |
| n4-006 | N4 | な-adjective に する/なる | ⬜ needs-triage | to become |
| n4-007 | N4 | Noun しか～ない (Noun shika~nai) | ⬜ needs-triage | nothing but, only |
| n4-008 | N4 | Noun に する (Noun ni suru) | — |  |
| n4-009 | N4 | Noun に なる (Noun ni naru) | — |  |
| n4-010 | N4 | のために (no tame ni) | ⬜ needs-triage | in order to, for the sake of, for |
| n4-011 | N4 | Noun の 間に (〜no aida ni) | ⬜ needs-triage | while, during |
| n4-012 | N4 | Noun ばかり (〜bakari) | ⬜ needs-triage | nothing but, just, only, always |
| n4-013 | N4 | Noun を あげる (Noun wo ageru) | — |  |
| n4-014 | N4 | Nounをいただく (Noun wo itadaku) | ⬜ needs-triage | to receive, to get |
| n4-015 | N4 | Nounをくださる | — |  |
| n4-016 | N4 | Noun を くれる (Noun wo kureru) | — |  |
| n4-017 | N4 | Noun を さしあげる (Noun wo sashiageru) | — |  |
| n4-018 | N4 | Noun もらう (Noun wo morau) | ⬜ needs-triage | to receive, to get |
| n4-019 | N4 | Noun + 中 (Noun + ちゅう) | ⬜ needs-triage | in the middle of, during |
| n4-020 | N4 | Verb させられる (Verb-saserareru) | — |  |
| n4-021 | N4 | Verb させる (Verb-saseru) | — |  |
| n4-022 | N4 | Verb た ことがある (Verb ta koto ga aru) | — |  |
| n4-023 | N4 | Verb た ときに (Verb た ときに) | ⬜ needs-triage | when, at the time |
| n4-024 | N4 | Verb た ところ (Verb ta tokoro) | — |  |
| n4-025 | N4 | Verb たほうがいい (〜ta hou ga ii) | — |  |
| n4-026 | N4 | Verb ために (tame ni) | ⬜ needs-triage | in order to, because of, for the sake of |
| n4-027 | N4 | Verb つもり (〜tsumori) | ⬜ needs-triage | i |
| n4-028 | N4 | Verb てあげる (Verb te ageru) | — |  |
| n4-029 | N4 | Verb て ある (Verb-te aru) | — |  |
| n4-030 | N4 | Verb て いく (Verb-te iku) | — |  |
| n4-031 | N4 | Verb ていただきたい (te itadakitai) | — |  |
| n4-032 | N4 | Verb ていただく (〜te itadaku) | — |  |
| n4-033 | N4 | Verb て いただけませんか (Verb te itadakemasen ka) | — |  |
| n4-034 | N4 | Verb て いる (Verb-te iru) | — |  |
| n4-035 | N4 | Verb て いる ところ (Verb te iru tokoro) | ⬜ needs-triage | in the middle of |
| n4-036 | N4 | Verb ている間に (te iru aida ni) | ⬜ needs-triage | while |
| n4-037 | N4 | Verb ておく (〜te oku) | — |  |
| n4-038 | N4 | Verb て くださいませんか (Verb-te kudasaimasen ka) | — |  |
| n4-039 | N4 | Verb て くださる (Verb-te kudasaru) | — |  |
| n4-040 | N4 | Verb て くる (Verb te kuru) | — |  |
| n4-041 | N4 | Verb てくれませんか (〜te kuremasen ka) | — |  |
| n4-042 | N4 | Verb て くれる (Verb-te kureru) | — |  |
| n4-043 | N4 | Verb て + さしあげる (Verb TE sashiageru) | — |  |
| n4-044 | N4 | Verb てしまう (〜te shimau) | — |  |
| n4-045 | N4 | Verb て ほしい (Verb-te hoshii) | — |  |
| n4-046 | N4 | Verb てみる (〜te miru) | — |  |
| n4-047 | N4 | Verb てもらいたい (～te moraitai) | — |  |
| n4-048 | N4 | Verb て もらう (Verb-te morau) | — |  |
| n4-049 | N4 | Verb てもらえませんか (～te moraemasen ka) | — |  |
| n4-050 | N4 | Verb ない ことがある (Verb-nai koto ga aru) | — |  |
| n4-051 | N4 | Verb ない + ことにする (Verb nai koto ni suru) | — |  |
| n4-052 | N4 | Verb ない ことになる (Verb nai koto ni naru) | — |  |
| n4-053 | N4 | Verb ないほうがいい (Verb nai hou ga ii) | — |  |
| n4-054 | N4 | Verb ながら (〜nagara) | ⬜ needs-triage | while, as |
| n4-055 | N4 | Verb なさい (〜nasai) | — |  |
| n4-056 | N4 | Verb にくい (〜nikui) | — |  |
| n4-057 | N4 | Verb やすい (〜yasui) | — |  |
| n4-058 | N4 | Verb ようと思う (Verb-you to omou) | — |  |
| n4-059 | N4 | Verb ように (〜you ni) | ⬜ needs-triage | like, as if, in order to |
| n4-060 | N4 | Verb ようにする (Verb ~you ni suru) | — |  |
| n4-061 | N4 | Verb ようになる (〜you ni naru) | — |  |
| n4-062 | N4 | Verb ように言う (Verb-you ni iu) | — |  |
| n4-063 | N4 | Verb られる (〜rareru) | — |  |
| n4-064 | N4 | Verb る ことがある (〜ru koto ga aru) | — |  |
| n4-065 | N4 | Verb ることができる (〜ru koto ga dekiru) | ⬜ needs-triage | can |
| n4-066 | N4 | Verb ることにする (〜ru koto ni suru) | — |  |
| n4-067 | N4 | Verb る ことになる (〜ru koto ni naru) | — |  |
| n4-068 | N4 | Verb るときに (〜ru toki ni) | ⬜ needs-triage | when, at the time |
| n4-069 | N4 | Verb る ところ (Verb-ru tokoro) | — |  |
| n4-070 | N4 | Verb 出す (~dasu) | — |  |
| n4-071 | N4 | Verb 方 (〜hou) | — |  |
| n4-072 | N4 | Verb 終わる (〜owaru) | — |  |
| n4-073 | N4 | Verb + 続ける (つづける, tsuzukeru) | — |  |
| n4-074 | N4 | ～かしら (〜kashira) | ⬜ needs-triage | i, i wonder |
| n4-075 | N4 | ～かどうか (〜ka dou ka) | ⬜ needs-triage | if |
| n4-076 | N4 | ～かなあ (〜kanaa) | ⬜ needs-triage | i, i wonder |
| n4-077 | N4 | ～かもしれない (〜kamoshirenai) | ⬜ needs-triage | maybe |
| n4-078 | N4 | ～から (〜kara) | ✅ done | because, due to, since |
| n4-079 | N4 | ～けれど (〜keredo) | ✅ done | but, however |
| n4-080 | N4 | ～させてください (〜sasete kudasai) | — |  |
| n4-081 | N4 | ～し、～し、～ (〜shi, 〜shi, 〜) | ✅ done | because, since, and |
| n4-082 | N4 | ～すぎる (〜sugiru) | ⬜ needs-triage | over |
| n4-083 | N4 | ～ずつ (〜zutsu) | — |  |
| n4-084 | N4 | ～そうだ (〜sou da) | — |  |
| n4-085 | N4 | そんな (sonna) + Noun | — |  |
| n4-086 | N4 | そんなに～ (sonna ni〜) | — |  |
| n4-087 | N4 | ～たらいい (〜tara ii) | ⬜ needs-triage | should, it would be good if |
| n4-088 | N4 | ～たら いかがですか (〜tara ikaga desu ka) | ⬜ needs-triage | it would be good if |
| n4-089 | N4 | ～たら どうですか (〜tara doudesuka) | — |  |
| n4-090 | N4 | ～たり～たり (〜tari 〜tari) | — |  |
| n4-091 | N4 | ～だろう (〜darou) | ⬜ needs-triage | maybe |
| n4-092 | N4 | ～っていう (〜tte iu) | — |  |
| n4-093 | N4 | ～で (〜de) | — |  |
| n4-094 | N4 | ～でしょう (〜deshou) | ⬜ needs-triage | it seems |
| n4-095 | N4 | ～てはいけない (〜te wa ikenai) | ⬜ needs-triage | must not |
| n4-096 | N4 | ～てもいい (〜temo ii) | — |  |
| n4-097 | N4 | ～ても/でも (〜te mo/demo) | ✅ done | even though, even if |
| n4-098 | N4 | ～といい (〜to ii) | ⬜ needs-triage | it would be good if |
| n4-099 | N4 | ～という (〜to iu) Noun | — |  |
| n4-100 | N4 | どういう Noun (dou iu Noun) | — |  |
| n4-101 | N4 | ～と思う (〜to omou) | — |  |
| n4-102 | N4 | ～という (〜to iu) | — |  |
| n4-103 | N4 | ～ないといけない (〜nai to ikenai) | ✅ done | have to, must, need to |
| n4-104 | N4 | ～なきゃいけない (〜nakya ikenai) | ✅ done | have to, must |
| n4-105 | N4 | ～なくちゃいけない (〜naku cha ikenai) | ✅ done | have to, must, need to |
| n4-106 | N4 | ～なくてはいけない (〜nakute wa ikenai) | ✅ done | have to, must |
| n4-107 | N4 | ～なくてもいい (〜nakutemo ii) | — |  |
| n4-108 | N4 | ～なければ ならない (〜nakereba naranai) | ✅ done | have to, must, need to |
| n4-109 | N4 | ～に (〜ni) | — |  |
| n4-110 | N4 | ～ので (〜node) | ✅ done | because, since, so |
| n4-111 | N4 | ～のです (〜no desu) | ⬜ needs-triage | the reason is |
| n4-112 | N4 | ～のに (〜no ni) | — |  |
| n4-113 | N4 | ～ばいい (〜ba ii) | ⬜ needs-triage | should, it would be good if |
| n4-114 | N4 | ～まで (〜made) | ⬜ needs-triage | even, until |
| n4-115 | N4 | ～までに (〜made ni) | ⬜ needs-triage | before, by |
| n4-116 | N4 | ～まま (〜mama) | ⬜ needs-triage | while |
| n4-117 | N4 | ～みたいだ (〜mitai da) | ⬜ needs-triage | like, it seems |
| n4-118 | N4 | ～も (〜mo) | ⬜ needs-triage | also |
| n4-119 | N4 | ～ようだ (〜you da) | ⬜ needs-triage | it seems |
| n4-120 | N4 | ～んです (〜n desu) | ⬜ needs-triage | the reason is |
| n4-121 | N4 | 文A。そのうえ 文B。 | ⬜ needs-triage | besides, furthermore |
| n4-122 | N4 | 文A。それで 文B (Bun A. Sorede Bun B) | ⬜ needs-triage | so, that |
| n4-123 | N4 | 文A。それに 文B (Bun A. Soreni Bun B) | — |  |
| n4-124 | N4 | 文A。だから 文B (Bun A. Dakara Bun B) | ✅ done | because, so, therefore |
| n5-001 | N5 | A が いちばん～ (A ga ichiban～) | — |  |
| n5-002 | N5 | A。けれども、～B。(A. Keredomo,~ B.) | ✅ done | but, however |
| n5-003 | N5 | A。しかし、～B。 (A. Shikashi, ~B.) | ✅ done |  |
| n5-004 | N5 | A。じゃ、～B。(A. Ja, ~B.) | ⬜ needs-triage | so |
| n5-005 | N5 | A。それじゃ、～B。(A. Soreja,~B.) | — |  |
| n5-006 | N5 | A。それでは、～B。(A. Soredewa,~B.) | ⬜ needs-triage | so, then |
| n5-007 | N5 | A。 では、～B。 (A. Dewa, ~B) | — |  |
| n5-008 | N5 | A。でも、～B。(A. Demo, ~B) | ✅ done |  |
| n5-009 | N5 | Aと Bと どちら～ (A to B to dochira~) | — |  |
| n5-010 | N5 | AとBと どっち〜 (A to B to docchi〜) | ⬜ needs-triage | which |
| n5-011 | N5 | A は B が〜 (A wa B ga〜) | — |  |
| n5-012 | N5 | A は B より～ (A wa B yori～) | — |  |
| n5-013 | N5 | A より B のほうが～ (A yori B no hou ga ～) | — |  |
| n5-014 | N5 | い-Adjective く + Verb (i-Adjective + ku + Verb) | — |  |
| n5-015 | N5 | い-Adjective く します (i-Adjective ku shimasu) | ⬜ needs-triage | to become |
| n5-016 | N5 | い-Adjective: Negative Polite Form | — |  |
| n5-017 | N5 | い-Adjective て (i-Adjective + te~) | — |  |
| n5-018 | N5 | な-Adjective に + Verb | — |  |
| n5-019 | N5 | な-Adjective で～ (na-Adjective de~) | — |  |
| n5-020 | N5 | な-Adjective に します (na-Adjective ni shimasu) | — |  |
| n5-021 | N5 | な-Adjective に なります (na-Adjective ni narimasu) | — |  |
| n5-022 | N5 | Noun か Noun か～ (Noun ka Noun ka～) | ⬜ needs-triage | or |
| n5-023 | N5 | Noun が できます (Noun ga dekimasu) | — |  |
| n5-024 | N5 | Noun がほしいです (〜ga hoshii desu) | — |  |
| n5-025 | N5 | Noun から Noun まで (Noun kara Noun made) | ⬜ needs-triage | from...to |
| n5-026 | N5 | Noun くらい～ (Noun kurai～) | ⬜ needs-triage | at least, about, approximately |
| n5-027 | N5 | Noun ぐらい～ (Noun gurai～) | ⬜ needs-triage | about, approximately |
| n5-028 | N5 | Noun ごろ～ (Noun + goro～) | ⬜ needs-triage | about |
| n5-029 | N5 | Noun だけ〜 (〜dake) | ⬜ needs-triage | just, only |
| n5-030 | N5 | Nounで～ (Noun de ~) | — |  |
| n5-031 | N5 | Noun と～ (Noun to～) | ⬜ needs-triage | together with, with, and |
| n5-032 | N5 | Noun に～ (Noun ni～) | ⬜ needs-triage | toward, to, for |
| n5-033 | N5 | Noun に 帰ります (Noun ni kaerimasu) | — |  |
| n5-034 | N5 | Noun に します (Noun ni shimasu) | — |  |
| n5-035 | N5 | Noun に なります (Noun ni narimasu) | ⬜ needs-triage | to become |
| n5-036 | N5 | Noun に 来ます (Noun ni kimasu) | — |  |
| n5-037 | N5 | Noun に 行きます (Noun ni ikimasu) | — |  |
| n5-038 | N5 | Noun の あとで (Noun no atode) | ⬜ needs-triage | after |
| n5-039 | N5 | Noun の 前に (Noun no mae ni) | — |  |
| n5-040 | N5 | Noun は～ (Noun wa〜) | ⬜ needs-triage | speaking of |
| n5-041 | N5 | Noun も〜 (Noun mo~) | ⬜ needs-triage | also |
| n5-042 | N5 | Noun や Noun など～ (Noun ya Noun nado) | ⬜ needs-triage | like, such as |
| n5-043 | N5 | Noun を〜 (Noun wo〜) | — |  |
| n5-044 | N5 | Verb た あとで (ta ato de) | — |  |
| n5-045 | N5 | Verb たいです (taidesu) | — |  |
| n5-046 | N5 | Verb て～ (Verb + te～) | — |  |
| n5-047 | N5 | Verb て います (Verb te imasu) | — |  |
| n5-048 | N5 | Verb てから～ (〜te kara) | ⬜ needs-triage | once, since, after |
| n5-049 | N5 | Verb て ください (Verb-te kudasai) | — |  |
| n5-050 | N5 | Verb ないで ください (〜naide kudasai) | — |  |
| n5-051 | N5 | Noun に 戻ります (Noun ni modorimasu) | — |  |
| n5-052 | N5 | Verb に 来ます (Verb ni kimasu) | — |  |
| n5-053 | N5 | Verb に 行きます (Verb ni ikimasu) | — |  |
| n5-054 | N5 | Verb ましょう (mashou) | ⬜ needs-triage | or |
| n5-055 | N5 | Verb ましょうか。 (〜mashou ka.) | — |  |
| n5-056 | N5 | Verb ませんか。 (Verb-masenka) | — |  |
| n5-057 | N5 | Verb ること～ (〜ru koto) | — |  |
| n5-058 | N5 | Verb る こと が できます (ru koto ga dekimasu) | — |  |
| n5-059 | N5 | Verb る こと ができる (ru koto ga dekiru) | ⬜ needs-triage | can |
| n5-060 | N5 | Verb る の～ (Verb + ru + no~) | — |  |
| n5-061 | N5 | Verb る 前に (ru mae ni) | ⬜ needs-triage | before |
| n5-062 | N5 | あまり～ありません (amari ~ arimasen) | — |  |
| n5-063 | N5 | あまり～ないです (amari ~ nai desu) | — |  |
| n5-064 | N5 | ～あります (〜arimasu) | — |  |
| n5-065 | N5 | ～いかがですか。 (〜ikaga desu ka.) | — |  |
| n5-066 | N5 | いくつ～ (ikutsu~) | — |  |
| n5-067 | N5 | いつか～ (itsuka～) | — |  |
| n5-068 | N5 | いつでも～ (itsudemo～) | ⬜ needs-triage | whenever, always |
| n5-069 | N5 | いつも～ (itsumo～) | ⬜ needs-triage | always |
| n5-070 | N5 | ～て います (～te imasu) | — |  |
| n5-071 | N5 | ～が (〜ga) | ⬜ needs-triage | but |
| n5-072 | N5 | ～が、～ (〜ga, 〜) | ⬜ needs-triage | but, however |
| n5-073 | N5 | ～から、～ (〜kara、～) | ✅ done | because, since, so |
| n5-074 | N5 | ～からです (〜kara desu) | ✅ done | because, due to, since |
| n5-075 | N5 | ～から もらいます (〜kara moraimasu) | — |  |
| n5-076 | N5 | ～が 私に くれます (〜ga watashi ni kuremasu) | — |  |
| n5-077 | N5 | ～けど、～ (〜kedo、～) | ✅ done | but, however, although |
| n5-078 | N5 | ～けれど、～ (〜keredo、～) | ✅ done | even though, but, however |
| n5-079 | N5 | こちら～ (kochira～) | — |  |
| n5-080 | N5 | さっき～ (sakki～) | — |  |
| n5-081 | N5 | すぐに～ (sugu ni～) | — |  |
| n5-082 | N5 | ぜんぜん～ (zenzen～) | ⬜ needs-triage | not at all |
| n5-083 | N5 | そして、～ (soshite、～) | ⬜ needs-triage | and then, and |
| n5-084 | N5 | そちら～ (sochira～) | — |  |
| n5-085 | N5 | それから、～ (sorekara、～) | ⬜ needs-triage | then, and then |
| n5-086 | N5 | だいたい〜 (daitai〜) | ⬜ needs-triage | approximately, almost |
| n5-087 | N5 | たいてい～ (taitei～) | — |  |
| n5-088 | N5 | だから、～ (dakara、～) | ✅ done | because, so, therefore |
| n5-089 | N5 | ～たり、～たり します (〜tari, 〜tari shimasu) | ⬜ needs-triage | and |
| n5-090 | N5 | だれ～ (dare～) | — |  |
| n5-091 | N5 | だれか〜 (dareka〜) | — |  |
| n5-092 | N5 | だれでも～ (dare demo～) | — |  |
| n5-093 | N5 | だれも～ないです (dare mo ~ nai desu) | — |  |
| n5-094 | N5 | だれも～ません (daremo ~masen) | — |  |
| n5-095 | N5 | ～どう しますか。 (～dou shimasu ka.) | — |  |
| n5-096 | N5 | ～どうですか。 (〜dou desu ka.) | — |  |
| n5-097 | N5 | どうやって～ (douyatte～) | — |  |
| n5-098 | N5 | ～どう 言いますか。 (〜dou iimasu ka.) | — |  |
| n5-099 | N5 | ～とき (〜toki) | ⬜ needs-triage | when, at the time |
| n5-100 | N5 | ときどき～ (tokidoki～) | — |  |
| n5-101 | N5 | どこ～ (doko～) | — |  |
| n5-102 | N5 | どこか～ (dokoka～) | — |  |
| n5-103 | N5 | どこでも～ (dokodemo～) | — |  |
| n5-104 | N5 | どこにも + Verb + ないです (doko ni mo + Verb + nai desu) | — |  |
| n5-105 | N5 | どこにも + Verb + ません (doko ni mo + Verb + masen) | ⬜ needs-triage | nowhere |
| n5-106 | N5 | どこへも Verb ないです (doko e mo + Verb + nai desu) | — |  |
| n5-107 | N5 | どこへも Verb ません (doko e mo + Verb + masen) | — |  |
| n5-108 | N5 | どこも Verb ないです (dokomo + Verb + naidesu) | ⬜ needs-triage | nowhere |
| n5-109 | N5 | どこも Verb ません (dokomo + Verb + masen) | ⬜ needs-triage | nowhere |
| n5-110 | N5 | どちら～ (dochira～) | — |  |
| n5-111 | N5 | どなた～ (donata～) | — |  |
| n5-112 | N5 | どの Noun (dono Noun) | ⬜ needs-triage | which |
| n5-113 | N5 | どれでも～ (dore demo～) | — |  |
| n5-114 | N5 | どんな Noun (donna) | — |  |
| n5-115 | N5 | なに～ (nani~) | ⬜ needs-triage | which |
| n5-116 | N5 | なにか～ (nanika～) | — |  |
| n5-117 | N5 | なにも～ないです (nani mo~nai desu) | — |  |
| n5-118 | N5 | なにも～ません (nanimo~masen) | — |  |
| n5-119 | N5 | なん～ (nan~) | — |  |
| n5-120 | N5 | なんで～ (nande～) | — |  |
| n5-121 | N5 | なんでも～ (nandemo～) | — |  |
| n5-122 | N5 | ～なんと 言いますか。 (〜nan to iimasu ka.) | — |  |
| n5-123 | N5 | ～に あげます (〜 ni agemasu) | — |  |
| n5-124 | N5 | ～に もらいます (〜ni moraimasu) | ⬜ needs-triage | to receive, to get |
| n5-125 | N5 | ～の (〜no) | — |  |
| n5-126 | N5 | ～はたいへんです (〜wa taihen desu) | — |  |
| n5-127 | N5 | ほとんど〜 (hotondo〜) | ⬜ needs-triage | almost |
| n5-128 | N5 | まあまあ～ (maa maa～) | — |  |
| n5-129 | N5 | まだ〜 (mada〜) | — |  |
| n5-130 | N5 | まだ〜ないです (mada 〜 nai desu) | — |  |
| n5-131 | N5 | まだ～ません (mada ~masen) | — |  |
| n5-132 | N5 | もう～ (mou～) | — |  |
| n5-133 | N5 | もうすぐ〜 (mou sugu~) | ⬜ needs-triage | almost |
| n5-134 | N5 | もっと〜 (motto〜) | — |  |
| n5-135 | N5 | よく～ (yoku ~) | — |  |
| n5-136 | N5 | ～（場所）に～があります (〜basho ni 〜 ga arimasu) | — |  |
