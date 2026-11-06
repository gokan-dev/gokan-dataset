// A media title's text in the text layer: what Jiten says about it (its English title, its
// community tags, its episodes' titles) and the names Gokan gives Jiten's genre ids, each a
// label in the language it is written in. Built by scripts/build-media.ts, read back by
// src/layout/legacy.ts.
import { JITEN_GENRES } from '../models/media.model';
import type { Label, LanguageTag, TextByLanguage } from '../models/text.model';
import { addRenderings, rendering } from './renderings';

/** The language Jiten's titles, tags and episode titles are in, and Gokan's genre names. */
export const MEDIA_LANG: LanguageTag = 'en';

export const MEDIA_FIELDS = { title: 'title', genre: 'genre', tag: 'tag', episodeTitle: 'title' } as const;

/** An episode's id among a title's text holders: the title's id and the episode's number. */
export function episodeId(titleId: string, number: number): string {
    return `${titleId}#${number}`;
}

function label(id: string, field: string, value: string, source: 'jiten' | 'gokan', ref: string): Label {
    // Episodes are text holders of their title's file, so they share its kind, as grammar examples do.
    return rendering<Label>('media', id, MEDIA_LANG, {
        role: 'label',
        field,
        source: { source, ref },
        match: 'id',
        // Gokan's own hand-written text is reviewed (decision D4).
        status: source === 'gokan' ? 'reviewed' : 'imported',
        value,
    });
}

/** A title's text: its English title when Jiten has one, its genres' names, its tags, in that order. */
export function mediaTitleText(titleId: string, english: string | null, genreIds: number[], tags: string[]): TextByLanguage {
    const text: TextByLanguage = {};
    addRenderings(text, MEDIA_LANG, [
        ...(english ? [label(titleId, MEDIA_FIELDS.title, english, 'jiten', titleId)] : []),
        ...genreIds.map(id => label(titleId, MEDIA_FIELDS.genre, JITEN_GENRES[id] ?? '', 'gokan', String(id))),
        ...tags.map(tag => label(titleId, MEDIA_FIELDS.tag, tag, 'jiten', titleId)),
    ]);
    return text;
}

export function episodeText(titleId: string, number: number, title: string): TextByLanguage {
    const id = episodeId(titleId, number);
    const text: TextByLanguage = {};
    addRenderings(text, MEDIA_LANG, [label(id, MEDIA_FIELDS.episodeTitle, title, 'jiten', id)]);
    return text;
}
