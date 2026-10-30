/**
 * A clip of a word or sentence read aloud. The file is `audio/{clip}.{extension}` on the
 * site, the extension given by `index/audio.json`. Clips are committed in data/audio/clips/
 * (Git LFS), but they are text-to-speech in the voice `index/audio.json` names, under that
 * voice's terms, not this dataset's licence (see README, License, and docs/SCHEMA.md, Audio).
 */
export interface AudioRef {
    /** The clip's content key: the same input, voice and engine always give the same key. */
    clip: string;
}

/** `compiled/index/audio.json`: the one voice every clip is read in, how to name its files and how to credit it. */
export interface AudioIndex {
    engine: 'voicevox';
    engineVersion: string;
    voice: string;
    style: string;
    /** The credit the voice's terms require, shown wherever clips play ("VOICEVOX:冥鳴ひまり"). */
    credit: string;
    termsUrl: string;
    extension: string;
    contentType: string;
}
