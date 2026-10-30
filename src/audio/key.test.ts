import { describe, it, expect } from 'vitest';
import { DEFAULT_PARAMS, configHash, parseVoiceConfig, type SynthesisParams } from './config';
import { clipKey, type ClipRecipe } from './key';

const recipe: ClipRecipe = {
    engine: 'voicevox',
    engineVersion: '0.26.0',
    styleId: 14,
    params: DEFAULT_PARAMS,
    format: 'opus-24k',
    input: '今日は人気がない。',
};

describe('clipKey', () => {
    it('is stable: the same recipe always names the same clip, so nothing is written twice', () => {
        // Pinned: a change here renames every clip and rewrites the whole bucket.
        expect(clipKey(recipe)).toBe('6e0053230655acd8');
        expect(clipKey({ ...recipe })).toBe(clipKey(recipe));
    });

    it('does not depend on the order of the parameters', () => {
        const reordered: SynthesisParams = { postPhonemeLength: 0.1, prePhonemeLength: 0.1, volumeScale: 1, intonationScale: 1, pitchScale: 0, speedScale: 1 };
        expect(clipKey({ ...recipe, params: reordered })).toBe(clipKey(recipe));
    });

    it('changes with every input that changes the sound', () => {
        const variants: ClipRecipe[] = [
            { ...recipe, engineVersion: '0.26.1' },
            { ...recipe, styleId: 8 },
            { ...recipe, params: { ...DEFAULT_PARAMS, speedScale: 0.9 } },
            { ...recipe, format: 'aac-32k' },
            { ...recipe, input: '今日はひとけがない。' },
        ];
        const keys = new Set([clipKey(recipe), ...variants.map(clipKey)]);
        expect(keys.size).toBe(variants.length + 1);
    });
});

describe('parseVoiceConfig', () => {
    const valid = {
        engine: 'voicevox', engineVersion: '0.26.0', speaker: '冥鳴ひまり', speakerUuid: 'u', style: 'ノーマル', styleId: 14,
        variant: 'forced', params: DEFAULT_PARAMS, format: 'opus-24k', credit: 'VOICEVOX:冥鳴ひまり', termsUrl: 'https://example.org',
    };

    it('accepts a full config', () => {
        expect(parseVoiceConfig(valid).credit).toBe('VOICEVOX:冥鳴ひまり');
    });

    it('fails without the credit the voice terms require', () => {
        expect(() => parseVoiceConfig({ ...valid, credit: '' })).toThrow(/credit/);
        const { credit: _credit, ...noCredit } = valid;
        expect(() => parseVoiceConfig(noCredit)).toThrow(/credit/);
    });

    it('fails on an unknown format or variant', () => {
        expect(() => parseVoiceConfig({ ...valid, format: 'mp3' })).toThrow(/format/);
        expect(() => parseVoiceConfig({ ...valid, variant: 'both' })).toThrow(/variant/);
    });

    it('hashes only what changes the sound: a new credit keeps every clip', () => {
        const config = parseVoiceConfig(valid);
        expect(configHash({ ...config, credit: 'VOICEVOX:other', termsUrl: 'x' })).toBe(configHash(config));
        expect(configHash({ ...config, styleId: 8 })).not.toBe(configHash(config));
    });
});
