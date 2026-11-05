import { describe, expect, it } from 'vitest';
import { sourceCommunities } from './registry';

describe('the sources registry', () => {
    it("reads each source's community, Wikidata and Wikipedia being one (decision D6)", () => {
        const communities = sourceCommunities('./data/sources');
        expect(communities.get('wikidata')).toBe('wikimedia');
        expect(communities.get('wikipedia')).toBe('wikimedia');
        expect(communities.get('tatoeba-cmn')).toBe(communities.get('tatoeba'));
        expect(communities.get('zhwiktionary')).not.toBe(communities.get('jawiktionary'));
    });
});
