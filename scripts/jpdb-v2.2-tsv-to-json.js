import fs from "fs";

const INPUT_PATH = "./data/raw/jpdb_v2.2_freq_list_2024-10-13.csv";
const OUTPUT_PATH = "./data/raw/jpdb_v2.2_freq_list_2024-10-13.json";

const text = fs.readFileSync(INPUT_PATH, "utf-8");
const lines = text.split("\n");

// Remove header line
const [, ...rows] = lines;

const result = {};

for (const line of rows) {
  if (!line.trim()) continue;

  const [term, reading, freq, kanaFreq] = line.split("\t");

  if (!term || !reading || !freq) continue;

  if (!result[term]) {
    result[term] = {};
  }

  result[term][reading] = {
    frequency: Number(freq),
    kanaFrequency: kanaFreq ? Number(kanaFreq) : null,
  };
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2), "utf-8");

console.log(`✔ Converted ${rows.length} rows`);
console.log(`✔ Unique terms: ${Object.keys(result).length}`);
