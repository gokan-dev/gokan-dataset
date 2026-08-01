export interface Kanji {
    character: string;
    steps: {
        kklc?: number;
        jlpt?: number;
        frequency?: number;
    };
    frequency?: number; // JPDB kanji frequency
}