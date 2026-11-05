// Corroboration (docs/MULTILINGUAL.md, "Corroboration and review"; decision D6): a text is
// corroborated when a text from another community agrees with it, agreeing meaning sharing an
// equivalent once both are in Simplified characters. Communities, not sources, because the sources
// of one community copy each other. Disagreement is never a rejection: a text no other community
// agrees with stays `imported`.
import type { SourceRef } from '../models/text.model';
import { simplifiedForComparison, type HanVariants } from './hanScript';

/** The items a text lists, as the benchmark split them: brackets dropped, split at punctuation. */
export function agreementTokens(texts: string[], v: HanVariants): string[] {
    return texts
        .flatMap(t => simplifiedForComparison(t, v).replace(/[（(][^）)]*[）)]/g, ' ').split(/[，,。；;、：:\s/／|．.！!？?…]+/))
        .map(t => t.trim())
        .filter(Boolean);
}

/** A token found in another: whole for two characters or more, at its start for one (浅 agrees with 浅的, 运 with 运送). */
function within(long: string, short: string): boolean {
    return [...short].length >= 2 ? long.includes(short) : long.startsWith(short);
}

/** The first pair of tokens on which two token lists agree, if any (the benchmark's rule). */
export function agreeingTokens(a: string[], b: string[]): [string, string] | undefined {
    for (const x of a) for (const y of b) if (x === y || within(x, y) || within(y, x)) return [x, y];
    return undefined;
}

export function agree(a: string[], b: string[], v: HanVariants): boolean {
    return agreeingTokens(agreementTokens(a, v), agreementTokens(b, v)) !== undefined;
}

/** One text about one word, as corroboration sees it. */
export interface Claim {
    community: string;
    /** Texts are compared only within one language: Mandarin (either script) with Mandarin, Southern Min with Southern Min. */
    language: string;
    ref: SourceRef;
    texts: string[];
}

const refKey = (r: SourceRef): string => `${r.source}\u0000${r.ref ?? ''}`;

/**
 * For each claim, the texts of other communities that agree with it: its evidence, each source
 * and ref once, sorted. Empty when none does.
 */
export function corroborations(claims: Claim[], v: HanVariants): SourceRef[][] {
    const tokens = claims.map(c => agreementTokens(c.texts, v));
    return claims.map((claim, i) => {
        const evidence = new Map<string, SourceRef>();
        claims.forEach((other, j) => {
            if (other.community === claim.community || other.language !== claim.language) return;
            if (agreeingTokens(tokens[i] ?? [], tokens[j] ?? [])) evidence.set(refKey(other.ref), other.ref);
        });
        return [...evidence].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, ref]) => ref);
    });
}
