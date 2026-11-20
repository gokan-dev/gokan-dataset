/**
 * The committed accent snapshots, data/raw/accents/*.tsv: one row per (written form, reading),
 * its accents as the source writes them, tab-separated. Lines starting with `#` say where and
 * when the snapshot was taken. Rows are sorted, so a new fetch diffs only what the source changed.
 */

export interface AccentRow {
    /** The written form the source gives the accent for (a Wiktionary page title, a UniDic orthBase). */
    form: string;
    /** Its reading, as the source writes it (hiragana or katakana). */
    reading: string;
    /** Its accents in the source's order, as written: `1`, `0`, `h`, `o`, `1+0`... */
    accents: string[];
}

/** A snapshot's text: its header lines, then its rows, deduplicated and sorted. */
export function formatSnapshot(header: string[], rows: AccentRow[]): string {
    const lines = new Set<string>();
    for (const row of rows) {
        const cells = [row.form, row.reading, ...row.accents];
        if (cells.some(c => /[\t\n]/.test(c))) throw new Error(`accent row with a tab or newline: ${JSON.stringify(row)}`);
        lines.add(cells.join('\t'));
    }
    const body = [...lines].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return [...header.map(h => `# ${h}`), ...body].join('\n') + '\n';
}

/** A snapshot's rows. Fails on a row without a reading or an accent. */
export function parseSnapshot(text: string): AccentRow[] {
    const rows: AccentRow[] = [];
    for (const [i, line] of text.split('\n').entries()) {
        if (line === '' || line.startsWith('#')) continue;
        const [form = '', reading = '', ...accents] = line.split('\t');
        if (form === '' || reading === '' || accents.length === 0) throw new Error(`accent snapshot line ${i + 1}: expected form, reading and at least one accent: ${line}`);
        rows.push({ form, reading, accents });
    }
    return rows;
}
