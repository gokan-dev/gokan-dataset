import fs from "fs";
import { Kanji } from "../src/models/kanji.model";
import { parseJPDBEntry } from "./build-common";
import { KKLCDatasetDTO, JLPTKanjiDatasetDTO, Kanjidic2DTO, KradfileDTO, RadkfileDTO } from "../src/models/data.model";
import {
    COMPONENT_STAND_INS, KANJIDIC_ORDERS, KANJI_ORDER_LISTS, KRADFILE_COMMON_FORMS, KanjidicOrder, componentForms, isCompatibilityIdeograph,
    kanjidicFields, orderList,
} from "../src/utils/kanjiSources";

const kklcPath = './data/raw/kklc.json';
const jpdbPath = './data/raw/jpdb_v2.json';
const jlptKanjiPath = './data/raw/jlpt-kanji.json';
const kanjidicPath = './data/raw/kanji/kanjidic2-all-3.6.2.json';
const kradfilePath = './data/raw/kanji/kradfile-3.6.2.json';
const radkfilePath = './data/raw/kanji/radkfile-3.6.2.json';

const kklc: KKLCDatasetDTO[] = JSON.parse(fs.readFileSync(kklcPath, 'utf-8'));
const jpdb: Record<string, string> = JSON.parse(fs.readFileSync(jpdbPath, 'utf-8'));
const jlptKanji: JLPTKanjiDatasetDTO = JSON.parse(fs.readFileSync(jlptKanjiPath, 'utf-8'));
const kanjidic: Kanjidic2DTO = JSON.parse(fs.readFileSync(kanjidicPath, 'utf-8'));
const kradfile: KradfileDTO = JSON.parse(fs.readFileSync(kradfilePath, 'utf-8'));
const radkfile: RadkfileDTO = JSON.parse(fs.readFileSync(radkfilePath, 'utf-8'));

// 〇 is in KKLC but is a symbol, not a kanji: KANJIDIC2 and KRADFILE do not list it.
const NOT_IN_KANJIDIC: Record<string, Pick<Kanji, 'meanings' | 'readings' | 'strokeCount' | 'components'>> = {
    '〇': { meanings: ['zero'], readings: { on: ['レイ'], kun: [], nanori: [] }, strokeCount: 1, components: [] },
};

const kanjidicByChar = new Map(kanjidic.characters.map(entry => [entry.literal, entry]));

// The KKLC position is the kanji's index in the KKLC chapters, as it has always been: vocab
// kklcStep is derived from it, so it must not move.
const kklcSteps = new Map<string, number>();
let kklcCounter = 1;
for (const group of kklc) {
    for (const chapter of group.chapters) {
        for (const char of chapter.kanji) {
            kklcSteps.set(char, kklcCounter++);
        }
    }
}

// The kanji set: KKLC first, in its order, then by code point every other kanji a learning order
// teaches, the JLPT list, the jouyou (grades 1-8) and the jinmeiyou (grade 9). Grade 10, an old form
// of a jouyou kanji allowed in names (德 for 徳), comes in only when an order teaches it.
const orderTypes = new Set<string>(Object.values(KANJIDIC_ORDERS));
const others = new Set<string>(Object.keys(jlptKanji));
for (const entry of kanjidic.characters) {
    const grade = entry.misc.grade;
    if ((grade !== null && grade <= 9) || entry.dictionaryReferences.some(ref => orderTypes.has(ref.type))) others.add(entry.literal);
}
for (const char of others) {
    if (isCompatibilityIdeograph(char)) others.delete(char);
}
const characters = [...kklcSteps.keys(), ...[...others].filter(char => !kklcSteps.has(char)).sort()];

const missing: string[] = [];
const kanjis: Kanji[] = characters.map(char => {
    const entry = kanjidicByChar.get(char);
    const parts = kradfile.kanji[char] ?? kradfile.kanji[KRADFILE_COMMON_FORMS[char] ?? ''];
    const fallback = NOT_IN_KANJIDIC[char];
    if (!entry || !parts) {
        if (!fallback) missing.push(char);
    }
    const fields = entry ? kanjidicFields(entry) : undefined;
    const kklcStep = kklcSteps.get(char);
    return {
        character: char,
        steps: {
            ...(kklcStep !== undefined ? { kklc: kklcStep } : {}),
            ...fields?.steps,
            ...(jlptKanji[char] !== undefined ? { jlpt: jlptKanji[char] } : {}),
        },
        frequency: jpdb[char] ? parseJPDBEntry(jpdb[char]).kanjiRank : undefined,
        newspaperFrequency: fields?.newspaperFrequency,
        meanings: fields?.meanings ?? fallback?.meanings ?? [],
        readings: fields?.readings ?? fallback?.readings ?? { on: [], kun: [], nanori: [] },
        strokeCount: fields?.strokeCount ?? fallback?.strokeCount ?? 0,
        grade: fields?.grade,
        radical: fields?.radical,
        components: parts ? componentForms(parts) : fallback?.components ?? [],
    };
});
if (missing.length > 0) {
    throw new Error(`KANJIDIC2 or KRADFILE has no entry for ${missing.length} kanji: ${missing.join('')}`);
}

// A position is a kanji's place in a book's sequence, so two kanji sharing one means bad data.
for (const order of Object.keys(KANJIDIC_ORDERS) as KanjidicOrder[]) {
    const seen = new Map<number, string>();
    for (const kanji of kanjis) {
        const position = kanji.steps[order];
        if (position === undefined) continue;
        const previous = seen.get(position);
        if (previous) throw new Error(`${order} puts both ${previous} and ${kanji.character} at ${position}`);
        seen.set(position, kanji.character);
    }
}

fs.mkdirSync('./compiled/index', { recursive: true });

fs.writeFileSync(
    './compiled/kanji.json',
    JSON.stringify(kanjis, null, 2),
);

// One file per kanji, so a page showing one kanji does not download all of them.
fs.rmSync('./compiled/kanji', { recursive: true, force: true });
fs.mkdirSync('./compiled/kanji', { recursive: true });
for (const kanji of kanjis) {
    fs.writeFileSync(`./compiled/kanji/${kanji.character}.json`, JSON.stringify(kanji, null, 2));
}

fs.rmSync('./compiled/index/kanji-orders', { recursive: true, force: true });
fs.mkdirSync('./compiled/index/kanji-orders', { recursive: true });
for (const order of KANJI_ORDER_LISTS) {
    fs.writeFileSync(`./compiled/index/kanji-orders/${order}.json`, JSON.stringify(orderList(kanjis, order), null, 2));
}

const kklcKanjiIndex: Record<number, string[]> = {};

for (const kanji of kanjis) {
    const step = kanji.steps.kklc;
    if (!step) continue;

    if (!kklcKanjiIndex[step]) {
        kklcKanjiIndex[step] = [];
    }

    kklcKanjiIndex[step].push(kanji.character);
}

fs.writeFileSync(
    './compiled/index/kklc-kanji.json',
    JSON.stringify(kklcKanjiIndex, null, 2),
);

// Component -> its stroke count and the kanji drawn with it, for search by component.
const realForms = new Map(Object.entries(COMPONENT_STAND_INS));
const componentIndex: Record<string, { strokeCount: number; kanji: string[] }> = {};
for (const [part, { strokeCount }] of Object.entries(radkfile.radicals)) {
    componentIndex[realForms.get(part) ?? part] = { strokeCount, kanji: [] };
}
for (const kanji of kanjis) {
    for (const component of kanji.components) {
        const entry = componentIndex[component];
        if (!entry) throw new Error(`${kanji.character}: component ${component} is not in RADKFILE`);
        entry.kanji.push(kanji.character);
    }
}
for (const [component, entry] of Object.entries(componentIndex)) {
    if (entry.kanji.length === 0) delete componentIndex[component];
}

fs.writeFileSync(
    './compiled/index/kanji-components.json',
    JSON.stringify(componentIndex, null, 2),
);

console.log(`🈁 ${kanjis.length} kanji (${kklcSteps.size} in KKLC), ${Object.keys(componentIndex).length} components`);
console.log(`   orders: ${KANJI_ORDER_LISTS.map(order => `${order} ${orderList(kanjis, order).length}`).join(', ')}`);
