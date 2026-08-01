import type { IpadicFeatures, Tokenizer } from 'kuromoji';

export interface TokenMatch {
    start: number;
    length: number;
    reading?: string;
}

function katakanaToHiragana(katakana: string): string {
    return katakana.replace(/[\u30A1-\u30F6]/g, function (match) {
        return String.fromCharCode(match.charCodeAt(0) - 0x60);
    });
}

export class SentenceTokenizer {
    private tokenizer: Tokenizer<IpadicFeatures>;

    constructor(tokenizer: Tokenizer<IpadicFeatures>) {
        this.tokenizer = tokenizer;
    }

    /**
     * Finds matches for a given vocabulary within a Japanese sentence.
     * @param text The full Japanese sentence
     * @param vocabularies An array or Set of known vocabulary words to search for
     * @returns A map of vocab words to their match positions in the sentence
     */
    public extractMatches(text: string, vocabularies: string[] | Set<string>): Record<string, TokenMatch[]> {
        const matches: Record<string, TokenMatch[]> = {};
        const vocabSet = vocabularies instanceof Set ? vocabularies : new Set(vocabularies);
        const tokens = this.tokenizer.tokenize(text);

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            // 1. Direct dictionary form matching
            const targetTerm = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form;

            if (vocabSet.has(targetTerm)) {
                if (!matches[targetTerm]) matches[targetTerm] = [];
                const startPos = token.word_position - 1;

                let extendedLength = token.surface_form.length;
                let extendedReading = token.reading || "";

                // Look ahead for verb/adjective conjugations (auxiliary verbs, non-independent verbs, connection particles)
                if (token.pos === '動詞' || token.pos === '形容詞') {
                    for (let k = i + 1; k < tokens.length; k++) {
                        const nextToken = tokens[k];
                        const isAux = nextToken.pos === '助動詞';
                        const isNonIndepVerb = nextToken.pos === '動詞' && nextToken.pos_detail_1 === '非自立'; // e.g., て[いる], て[おく], て[みる]
                        const isConjParticle = nextToken.pos === '助詞' && nextToken.pos_detail_1 === '接続助詞'; // e.g., [出]て, [食べ]れば
                        const isSuffix = nextToken.pos === '名詞' && nextToken.pos_detail_1 === '接尾'; // e.g., 楽し[さ]

                        if (isAux || isNonIndepVerb || isConjParticle || isSuffix) {
                            extendedLength += nextToken.surface_form.length;
                            extendedReading += nextToken.reading || "";
                        } else {
                            break;
                        }
                    }
                }

                if (!matches[targetTerm].some(m => m.start === startPos)) {
                    matches[targetTerm].push({
                        start: startPos,
                        length: extendedLength,
                        reading: extendedReading ? katakanaToHiragana(extendedReading) : undefined
                    });
                }
            }

            // 2. Sliding window compound matching
            let surfaceWindow = "";
            let readingWindow = "";
            const startPos = token.word_position - 1;

            for (let j = 0; j < 5 && (i + j) < tokens.length; j++) {
                surfaceWindow += tokens[i + j].surface_form;
                readingWindow += tokens[i + j].reading || "";

                const readingHiragana = readingWindow ? katakanaToHiragana(readingWindow) : undefined;

                if (vocabSet.has(surfaceWindow)) {
                    if (!matches[surfaceWindow]) matches[surfaceWindow] = [];
                    if (!matches[surfaceWindow].some(m => m.start === startPos && m.length === surfaceWindow.length)) {
                        matches[surfaceWindow].push({
                            start: startPos,
                            length: surfaceWindow.length,
                            reading: readingHiragana
                        });
                    }
                }

                if (surfaceWindow.endsWith("かい")) {
                    const deinflectedHiragana = surfaceWindow.slice(0, -2) + "かう";
                    if (vocabSet.has(deinflectedHiragana)) {
                        if (!matches[deinflectedHiragana]) matches[deinflectedHiragana] = [];
                        if (!matches[deinflectedHiragana].some(m => m.start === startPos && m.length === surfaceWindow.length)) {
                            matches[deinflectedHiragana].push({
                                start: startPos,
                                length: surfaceWindow.length,
                                reading: readingHiragana
                            });
                        }
                    }

                    const deinflectedKanji = surfaceWindow.slice(0, -2) + "買う";
                    if (vocabSet.has(deinflectedKanji)) {
                        if (!matches[deinflectedKanji]) matches[deinflectedKanji] = [];
                        if (!matches[deinflectedKanji].some(m => m.start === startPos && m.length === surfaceWindow.length)) {
                            matches[deinflectedKanji].push({
                                start: startPos,
                                length: surfaceWindow.length,
                                reading: readingHiragana
                            });
                        }
                    }
                }
            }
        }

        return matches;
    }
}
