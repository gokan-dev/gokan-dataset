import { describe, expect, it } from 'vitest';
import type { Label, TextFile } from '../models/text.model';
import { episodeId, episodeText } from './media';
import { rendering, sharedFrom } from './renderings';
import { isLowercaseTag, licenseProblem, renderingProblems, textFileProblems, type SourceInfo } from './validate';

const sources = new Map<string, SourceInfo>([
    ['kanjidic2', { id: 'kanjidic2', license: 'CC-BY-SA-4.0', languages: ['en', 'fr'], roles: ['label'] }],
]);
const label = (value: string, lang = 'en'): Label =>
    rendering<Label>('kanji', '紙', lang, { role: 'label', source: { source: 'kanjidic2', ref: '紙' }, match: 'id', status: 'imported', value });

describe('tags and licences', () => {
    it('accepts lowercase BCP 47 tags only', () => {
        expect(['en', 'zh-hans', 'nan', 'zh-hant-tw'].every(isLowercaseTag)).toBe(true);
        expect(['zh-Hans', 'EN', 'e', 'en_US'].some(isLowercaseTag)).toBe(false);
    });

    it('accepts compatible SPDX licences and named terms, nothing else', () => {
        expect(licenseProblem('CC-BY-SA-4.0')).toBeNull();
        expect(licenseProblem('LicenseRef-Tatoeba')).toBeNull();
        expect(licenseProblem('CC-BY-NC-4.0')).toMatch(/not an SPDX id known to be compatible/);
    });
});

describe('renderingProblems', () => {
    it('finds nothing wrong with a well-made rendering', () => {
        expect(renderingProblems(label('paper'), 'kanji', '紙', 'en', sources)).toEqual([]);
    });

    it('catches an unregistered source, a language the source does not give, and a tampered value', () => {
        const unknown = { ...label('paper'), source: { source: 'cedict' } };
        expect(renderingProblems(unknown, 'kanji', '紙', 'en', sources).join()).toMatch(/not in data\/sources/);
        expect(renderingProblems(label('papel', 'es'), 'kanji', '紙', 'es', sources).join()).toMatch(/does not list language es/);
        expect(renderingProblems({ ...label('paper'), value: 'pulp' }, 'kanji', '紙', 'en', sources).join()).toMatch(/does not match its content/);
    });

    it('needs evidence on a corroborated rendering, from registered sources', () => {
        const bare = rendering<Label>('kanji', '紙', 'en', { role: 'label', source: { source: 'kanjidic2', ref: '紙' }, match: 'id', status: 'corroborated', value: 'paper' });
        expect(renderingProblems(bare, 'kanji', '紙', 'en', sources).join()).toMatch(/names no evidence/);
        const unknown = { ...bare, evidence: [{ source: 'cedict', ref: '纸' }] };
        expect(renderingProblems(unknown, 'kanji', '紙', 'en', sources).join()).toMatch(/evidence source "cedict" is not in data\/sources/);
        expect(licenseProblem('Unicode-3.0')).toBeNull();
    });

    it('rejects a derived value without an allowlisted transform', () => {
        const derived = { ...label('paper'), value: { value: 'paper', derivedFrom: { value: 'papier', lang: 'fr', transform: 'translate' } } } as unknown as Label;
        expect(renderingProblems(derived, 'kanji', '紙', 'en', sources).join()).toMatch(/allowlisted transform/);
    });
});

describe('a rendering carried for another entity', () => {
    it("is checked against its owner's identity, and an owner it does not name fails", () => {
        const shared = sharedFrom(label('paper'), 'kanji', '紙');
        expect(renderingProblems(shared, 'grammar', 'n5-001#abc', 'en', sources)).toEqual([]);
        expect(renderingProblems(label('paper'), 'grammar', 'n5-001#abc', 'en', sources).join()).toMatch(/does not match its content/);
    });
});

describe('textFileProblems', () => {
    it('checks the file language against its folder, and repeated renderings', () => {
        const r = label('paper');
        const file: TextFile = { kind: 'kanji', lang: 'en', entities: { 紙: { renderings: [r, r] } } };
        expect(textFileProblems(file, 'fr', sources).join('|')).toMatch(/not its folder's, fr.*appears twice/);
    });
});

describe('media text', () => {
    it("identifies an episode's title as a text of its title's media file", () => {
        const jiten = new Map<string, SourceInfo>([['jiten', { id: 'jiten', license: 'CC-BY-SA-4.0', languages: ['en'], roles: ['label'] }]]);
        const [episode] = episodeText('7', 3, 'Episode 3').en?.renderings ?? [];
        if (!episode) throw new Error('no episode label');
        expect(renderingProblems(episode, 'media', episodeId('7', 3), 'en', jiten)).toEqual([]);
    });
});
