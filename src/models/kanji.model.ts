export interface Kanji {
    character: string;
    steps: KanjiSteps;
    frequency?: number; // JPDB kanji frequency rank
    newspaperFrequency?: number; // KANJIDIC2 newspaper rank, 1-2500
    meanings: string[]; // English, KANJIDIC2 order (the main sense first)
    readings: KanjiReadings;
    strokeCount: number;
    grade?: number; // school grade: 1-6 kyouiku, 8 the rest of the jouyou, 9-10 jinmeiyou (names)
    radical?: KanjiRadical; // absent only for 〇, which no radical classifies
    components: string[]; // visual components (KRADFILE), real forms: 海 -> 氵 母 毋 𠂉
}

/**
 * The kanji's position in each learning order it belongs to (1 = taught first); absent when the
 * order does not teach it. `jlpt` is a level, not a position.
 */
export interface KanjiSteps {
    kklc?: number; // Kodansha Kanji Learner's Course
    rtk?: number; // Remembering the Kanji, 6th edition frame: 1-2200 book 1, 2201-3000 book 3
    rtkLegacy?: number; // Remembering the Kanji, editions 1-5 (before the 2010 jouyou revision)
    kanjiInContext?: number; // Kanji in Context (Nishiguchi, Kono)
    kanjiKana?: number; // Kanji & Kana, 2nd edition (Hadamitzky, Spahn): the jouyou by school grade
    henshall?: number; // A Guide to Remembering Japanese Characters (Henshall)
    essentialKanji?: number; // Essential Kanji (O'Neill)
    kanjiFlashcards?: number; // Japanese Kanji Flashcards (White Rabbit Press)
    tuttleCards?: number; // Tuttle Kanji Cards (Kask)
    maniette?: number; // Les Kanjis dans la tête (Maniette), the French adaptation of RTK
    jlpt?: number; // JLPT level, 5 (N5) to 1 (N1)
    frequency?: number; // reserved, currently unused
}

/**
 * KANJIDIC2 notation: in a kun reading "." marks where the okurigana starts (まな.ぶ is 学ぶ) and a
 * leading or trailing "-" marks a prefix or suffix reading.
 */
export interface KanjiReadings {
    on: string[]; // katakana
    kun: string[]; // hiragana
    nanori: string[]; // readings used only in names
}

/** The kanji's classical (Kangxi) radical, 1-214, and the character it is written with. */
export interface KanjiRadical {
    number: number;
    character: string;
}
