// The review files of data/reviews/, read for the stages that need them (build:text, check:text,
// the benchmark). Node only; the parsing is src/text/reviews.ts.
import fs from 'node:fs';
import path from 'node:path';
import { emptyReviews, parseReviewFile, type Reviews } from './reviews';

/** Every review file in the directory, in name order, and every problem with them. None when it does not exist. */
export function readReviews(dir: string): { reviews: Reviews; problems: string[] } {
    const reviews = emptyReviews();
    const problems: string[] = [];
    if (!fs.existsSync(dir)) return { reviews, problems };
    for (const name of fs.readdirSync(dir).sort()) problems.push(...parseReviewFile(name, fs.readFileSync(path.join(dir, name), 'utf8'), reviews));
    return { reviews, problems };
}
