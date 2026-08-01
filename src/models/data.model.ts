// ============================================================================
// EXTERNAL DATASET DTOs (Raw data structures from sources)
// ============================================================================

/**
 * KKLC Kanji Dataset
 * Source: https://github.com/ppasupat/vocab-kanji/blob/master/data/kanji/kklc.json
 *
 * Actual structure from the repository
 */
export interface KKLCDatasetDTO {
    shortname: string;           // "0"
    name: string;                // "1-100"
    chapters: KKLCChapterDTO[];
}

export interface KKLCChapterDTO {
    name: string;                // "1", "21", "41"...
    kanji: string;               // "日一二三十四五六七八九丸円〇人百千万口田"
}

/**
 * JPDB Frequency Dataset
 * Source: https://raw.githubusercontent.com/Kuuuube/Kuuuube.github.io/refs/heads/main/japanese-word-frequency/JPDB_v2.js
 *
 * Format: JavaScript file with object
 * const jpdb_v2_json = { "今日":"122, 6099㋕", "ほど":"123㋕", ... }
 */
export interface JPDBFrequencyDTO {
    [word: string]: string;      // "今日" -> "122, 6099㋕"
    // First number = kanji frequency rank
    // Second number (if exists) = hiragana frequency rank
    // ㋕ marker indicates hiragana version
}

/**
 * Parsed JPDB frequency entry
 */
export interface ParsedJPDBFrequency {
    word: string;                // "今日"
    kanjiRank?: number;          // 122 (if word contains kanji)
    hiraganaRank?: number;       // 6099 (if ㋕ marker present)
}

/**
 * JLPT Kanji Dataset
 * Source: https://github.com/Bluskyo/JLPT_Vocabulary/blob/main/data/kanji/results/JLPT_kanji_ALL.json
 *
 * Flat map of kanji character -> JLPT N-level (1 = N1 hardest, 5 = N5 easiest)
 */
export type JLPTKanjiDatasetDTO = Record<string, number>;

/**
 * JLPT Vocabulary Dataset
 * Source: https://github.com/Bluskyo/JLPT_Vocabulary/blob/main/data/vocab/results/JLPT_vocab_ALL.json
 *
 * Written form -> one or more reading/level pairs (a word can appear at
 * different levels depending on its reading).
 */
export type JLPTVocabDatasetDTO = Record<string, Array<{ reading: string; level: number }>>;


export interface JMDict {
    version: string
    languages: string[]
    commonOnly: boolean
    dictDate: string
    dictRevisions: string[]
    tags: Record<Tags, string>
    words: Word[]
}

export type Tags = typeof TagsKey[number]

export interface Word {
    id: string
    kanji: Kanji[]
    kana: Kana[]
    sense: Sense[]
}

export interface Kanji {
    common: boolean
    text: string
    tags: any[]
}

export interface Kana {
    common: boolean
    text: string
    tags: any[]
    appliesToKanji: string[]
}

export interface Sense {
    partOfSpeech: string[]
    appliesToKanji: string[]
    appliesToKana: string[]
    related: string[][]
    antonym: unknown[]
    field: unknown[]
    dialect: unknown[]
    misc: Array<keyof Tags>
    info: unknown[]
    languageSource: LanguageSource[]
    gloss: Gloss[]
}

export interface LanguageSource {
    lang: string
    full: boolean
    wasei: boolean
    text: string
}

export interface Gloss {
    lang: string
    gender: unknown
    type?: string
    text: string
}

export const TagsKey = ["v5uru", "v2g-s", "dei", "ship", "leg", "bra", "music", "quote", "pref", "ktb", "rK", "derog", "abbr", "exp", "astron", "v2g-k", "aux-v", "ctr", "surg", "baseb", "serv", "genet", "geogr", "dent", "v5k-s", "horse", "ornith", "v2w-s", "sK", "rk", "hob", "male", "motor", "vidg", "n-pref", "n-suf", "suf", "hon", "biol", "pol", "vulg", "v2n-s", "mil", "golf", "min", "X", "sk", "jpmyth", "sl", "fict", "art", "stat", "cryst", "pathol", "photo", "food", "n", "thb", "fish", "v5r-i", "arch", "v1", "bus", "tv", "euph", "embryo", "v2y-k", "uk", "rare", "v2a-s", "hanaf", "figskt", "agric", "given", "physiol", "v5u-s", "chn", "ev", "adv", "prt", "vi", "v2y-s", "kyb", "vk", "grmyth", "vn", "electr", "gardn", "adj-kari", "vr", "vs", "internet", "vt", "cards", "stockm", "vz", "aux", "v2h-s", "kyu", "noh", "econ", "rommyth", "ecol", "n-t", "psy", "proverb", "company", "poet", "ateji", "paleo", "v2h-k", "civeng", "go", "adv-to", "ent", "unc", "unclass", "on-mim", "yoji", "n-adv", "print", "form", "obj", "osb", "adj-shiku", "Christn", "hum", "obs", "relig", "iK", "v2k-s", "conj", "v2s-s", "geol", "geom", "anat", "nab", "ski", "hist", "fam", "myth", "gramm", "v2k-k", "id", "v5aru", "psyanal", "comp", "creat", "ik", "oth", "v-unspec", "io", "work", "adj-ix", "phil", "doc", "math", "pharm", "adj-nari", "v2r-k", "adj-f", "adj-i", "audvid", "rkb", "adj-t", "v2r-s", "Buddh", "biochem", "v2b-k", "vs-s", "surname", "physics", "place", "v2b-s", "kabuki", "prowres", "product", "vs-c", "tsug", "adj-ku", "telec", "vs-i", "v2z-s", "organization", "char", "engr", "logic", "v2m-s", "col", "archeol", "cop", "num", "aviat", "aux-adj", "m-sl", "fem", "MA", "finc", "v1-s", "v2m-k", "manga", "shogi", "group", "adj-no", "adj-na", "sens", "law", "vet", "mahj", "v4b", "rail", "v4g", "elec", "film", "mining", "v4h", "v4k", "v4m", "v4n", "sumo", "v4s", "v4r", "person", "v4t", "boxing", "oK", "cloth", "joc", "politics", "v2t-k", "tsb", "v5b", "ling", "bot", "v2t-s", "v5g", "med", "v5k", "mech", "v5n", "v5m", "v2d-k", "v5r", "v5t", "v5s", "v5u", "Shinto", "station", "chmyth", "dated", "v2d-s", "psych", "adj-pn", "ok", "met", "chem", "sports", "zool", "int", "tradem", "net-sl", "n-pr", "archit", "ksb", "pn", "gikun"] as const

export const TagsLookup: Record<Tags, string> = {
    "v5uru": "Godan verb - Uru old class verb (old form of Eru)",
    "v2g-s": "Nidan verb (lower class) with 'gu' ending (archaic)",
    "dei": "deity",
    "ship": "ship name",
    "leg": "legend",
    "bra": "Brazilian",
    "music": "music",
    "quote": "quotation",
    "pref": "prefix",
    "ktb": "Kantou-ben",
    "rK": "rarely used kanji form",
    "derog": "derogatory",
    "abbr": "abbreviation",
    "exp": "expressions (phrases, clauses, etc.)",
    "astron": "astronomy",
    "v2g-k": "Nidan verb (upper class) with 'gu' ending (archaic)",
    "aux-v": "auxiliary verb",
    "ctr": "counter",
    "surg": "surgery",
    "baseb": "baseball",
    "serv": "service",
    "genet": "genetics",
    "geogr": "geography",
    "dent": "dentistry",
    "v5k-s": "Godan verb - Iku/Yuku special class",
    "horse": "horse racing",
    "ornith": "ornithology",
    "v2w-s": "Nidan verb (lower class) with 'u' ending and 'we' conjugation (archaic)",
    "sK": "search-only kanji form",
    "rk": "rarely used kana form",
    "hob": "Hokkaido-ben",
    "male": "male term or language",
    "motor": "motorsport",
    "vidg": "video games",
    "n-pref": "noun, used as a prefix",
    "n-suf": "noun, used as a suffix",
    "suf": "suffix",
    "hon": "honorific or respectful (sonkeigo) language",
    "biol": "biology",
    "pol": "polite (teineigo) language",
    "vulg": "vulgar expression or word",
    "v2n-s": "Nidan verb (lower class) with 'nu' ending (archaic)",
    "mil": "military",
    "golf": "golf",
    "min": "mineralogy",
    "X": "rude or X-rated term (not displayed in educational software)",
    "sk": "search-only kana form",
    "jpmyth": "Japanese mythology",
    "sl": "slang",
    "fict": "fiction",
    "art": "art, aesthetics",
    "stat": "statistics",
    "cryst": "crystallography",
    "pathol": "pathology",
    "photo": "photography",
    "food": "food, cooking",
    "n": "noun (common) (futsuumeishi)",
    "thb": "Touhoku-ben",
    "fish": "fishing",
    "v5r-i": "Godan verb with 'ru' ending (irregular verb)",
    "arch": "archaic",
    "v1": "Ichidan verb",
    "bus": "business",
    "tv": "television",
    "euph": "euphemistic",
    "embryo": "embryology",
    "v2y-k": "Nidan verb (upper class) with 'yu' ending (archaic)",
    "uk": "word usually written using kana alone",
    "rare": "rare term",
    "v2a-s": "Nidan verb with 'u' ending (archaic)",
    "hanaf": "hanafuda",
    "figskt": "figure skating",
    "agric": "agriculture",
    "given": "given name or forename, gender not specified",
    "physiol": "physiology",
    "v5u-s": "Godan verb with 'u' ending (special class)",
    "chn": "children's language",
    "ev": "event",
    "adv": "adverb (fukushi)",
    "prt": "particle",
    "vi": "intransitive verb",
    "v2y-s": "Nidan verb (lower class) with 'yu' ending (archaic)",
    "kyb": "Kyoto-ben",
    "vk": "Kuru verb - special class",
    "grmyth": "Greek mythology",
    "vn": "irregular nu verb",
    "electr": "electronics",
    "gardn": "gardening, horticulture",
    "adj-kari": "'kari' adjective (archaic)",
    "vr": "irregular ru verb, plain form ends with -ri",
    "vs": "noun or participle which takes the aux. verb suru",
    "internet": "Internet",
    "vt": "transitive verb",
    "cards": "card games",
    "stockm": "stock market",
    "vz": "Ichidan verb - zuru verb (alternative form of -jiru verbs)",
    "aux": "auxiliary",
    "v2h-s": "Nidan verb (lower class) with 'hu/fu' ending (archaic)",
    "kyu": "Kyuushuu-ben",
    "noh": "noh",
    "econ": "economics",
    "rommyth": "Roman mythology",
    "ecol": "ecology",
    "n-t": "noun (temporal) (jisoumeishi)",
    "psy": "psychiatry",
    "proverb": "proverb",
    "company": "company name",
    "poet": "poetical term",
    "ateji": "ateji (phonetic) reading",
    "paleo": "paleontology",
    "v2h-k": "Nidan verb (upper class) with 'hu/fu' ending (archaic)",
    "civeng": "civil engineering",
    "go": "go (game)",
    "adv-to": "adverb taking the 'to' particle",
    "ent": "entomology",
    "unc": "unclassified",
    "unclass": "unclassified name",
    "on-mim": "onomatopoeic or mimetic word",
    "yoji": "yojijukugo",
    "n-adv": "adverbial noun (fukushitekimeishi)",
    "print": "printing",
    "form": "formal or literary term",
    "obj": "object",
    "osb": "Osaka-ben",
    "adj-shiku": "'shiku' adjective (archaic)",
    "Christn": "Christianity",
    "hum": "humble (kenjougo) language",
    "obs": "obsolete term",
    "relig": "religion",
    "iK": "word containing irregular kanji usage",
    "v2k-s": "Nidan verb (lower class) with 'ku' ending (archaic)",
    "conj": "conjunction",
    "v2s-s": "Nidan verb (lower class) with 'su' ending (archaic)",
    "geol": "geology",
    "geom": "geometry",
    "anat": "anatomy",
    "nab": "Nagano-ben",
    "ski": "skiing",
    "hist": "historical term",
    "fam": "familiar language",
    "myth": "mythology",
    "gramm": "grammar",
    "v2k-k": "Nidan verb (upper class) with 'ku' ending (archaic)",
    "id": "idiomatic expression",
    "v5aru": "Godan verb - -aru special class",
    "psyanal": "psychoanalysis",
    "comp": "computing",
    "creat": "creature",
    "ik": "word containing irregular kana usage",
    "oth": "other",
    "v-unspec": "verb unspecified",
    "io": "irregular okurigana usage",
    "work": "work of art, literature, music, etc. name",
    "adj-ix": "adjective (keiyoushi) - yoi/ii class",
    "phil": "philosophy",
    "doc": "document",
    "math": "mathematics",
    "pharm": "pharmacology",
    "adj-nari": "archaic/formal form of na-adjective",
    "v2r-k": "Nidan verb (upper class) with 'ru' ending (archaic)",
    "adj-f": "noun or verb acting prenominally",
    "adj-i": "adjective (keiyoushi)",
    "audvid": "audiovisual",
    "rkb": "Ryuukyuu-ben",
    "adj-t": "'taru' adjective",
    "v2r-s": "Nidan verb (lower class) with 'ru' ending (archaic)",
    "Buddh": "Buddhism",
    "biochem": "biochemistry",
    "v2b-k": "Nidan verb (upper class) with 'bu' ending (archaic)",
    "vs-s": "suru verb - special class",
    "surname": "family or surname",
    "physics": "physics",
    "place": "place name",
    "v2b-s": "Nidan verb (lower class) with 'bu' ending (archaic)",
    "kabuki": "kabuki",
    "prowres": "professional wrestling",
    "product": "product name",
    "vs-c": "su verb - precursor to the modern suru",
    "tsug": "Tsugaru-ben",
    "adj-ku": "'ku' adjective (archaic)",
    "telec": "telecommunications",
    "vs-i": "suru verb - included",
    "v2z-s": "Nidan verb (lower class) with 'zu' ending (archaic)",
    "organization": "organization name",
    "char": "character",
    "engr": "engineering",
    "logic": "logic",
    "v2m-s": "Nidan verb (lower class) with 'mu' ending (archaic)",
    "col": "colloquial",
    "archeol": "archeology",
    "cop": "copula",
    "num": "numeric",
    "aviat": "aviation",
    "aux-adj": "auxiliary adjective",
    "m-sl": "manga slang",
    "fem": "female term or language",
    "MA": "martial arts",
    "finc": "finance",
    "v1-s": "Ichidan verb - kureru special class",
    "v2m-k": "Nidan verb (upper class) with 'mu' ending (archaic)",
    "manga": "manga",
    "shogi": "shogi",
    "group": "group",
    "adj-no": "nouns which may take the genitive case particle 'no'",
    "adj-na": "adjectival nouns or quasi-adjectives (keiyodoshi)",
    "sens": "sensitive",
    "law": "law",
    "vet": "veterinary terms",
    "mahj": "mahjong",
    "v4b": "Yodan verb with 'bu' ending (archaic)",
    "rail": "railway",
    "v4g": "Yodan verb with 'gu' ending (archaic)",
    "elec": "electricity, elec. eng.",
    "film": "film",
    "mining": "mining",
    "v4h": "Yodan verb with 'hu/fu' ending (archaic)",
    "v4k": "Yodan verb with 'ku' ending (archaic)",
    "v4m": "Yodan verb with 'mu' ending (archaic)",
    "v4n": "Yodan verb with 'nu' ending (archaic)",
    "sumo": "sumo",
    "v4s": "Yodan verb with 'su' ending (archaic)",
    "v4r": "Yodan verb with 'ru' ending (archaic)",
    "person": "full name of a particular person",
    "v4t": "Yodan verb with 'tsu' ending (archaic)",
    "boxing": "boxing",
    "oK": "word containing out-dated kanji or kanji usage",
    "cloth": "clothing",
    "joc": "jocular, humorous term",
    "politics": "politics",
    "v2t-k": "Nidan verb (upper class) with 'tsu' ending (archaic)",
    "tsb": "Tosa-ben",
    "v5b": "Godan verb with 'bu' ending",
    "ling": "linguistics",
    "bot": "botany",
    "v2t-s": "Nidan verb (lower class) with 'tsu' ending (archaic)",
    "v5g": "Godan verb with 'gu' ending",
    "med": "medicine",
    "v5k": "Godan verb with 'ku' ending",
    "mech": "mechanical engineering",
    "v5n": "Godan verb with 'nu' ending",
    "v5m": "Godan verb with 'mu' ending",
    "v2d-k": "Nidan verb (upper class) with 'dzu' ending (archaic)",
    "v5r": "Godan verb with 'ru' ending",
    "v5t": "Godan verb with 'tsu' ending",
    "v5s": "Godan verb with 'su' ending",
    "v5u": "Godan verb with 'u' ending",
    "Shinto": "Shinto",
    "station": "railway station",
    "chmyth": "Chinese mythology",
    "dated": "dated term",
    "v2d-s": "Nidan verb (lower class) with 'dzu' ending (archaic)",
    "psych": "psychology",
    "adj-pn": "pre-noun adjectival (rentaishi)",
    "ok": "out-dated or obsolete kana usage",
    "met": "meteorology",
    "chem": "chemistry",
    "sports": "sports",
    "zool": "zoology",
    "int": "interjection (kandoushi)",
    "tradem": "trademark",
    "net-sl": "Internet slang",
    "n-pr": "proper noun",
    "archit": "architecture",
    "ksb": "Kansai-ben",
    "pn": "pronoun",
    "gikun": "gikun (meaning as reading) or jukujikun (special kanji reading)"
}