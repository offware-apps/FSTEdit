import type { MediaPlugin } from './types';

const LOAD_TIMEOUT_MS = 8000;
// the browser decodes from one copy of the whole file plus every channel at once; past this, ffmpeg reads it in place
const MAX_DECODE_BYTES = 150 * 1024 * 1024;

/** Loads `file` into a media element and resolves once it plays, or null when the browser cannot. */
function load(file: File): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    const url = URL.createObjectURL(file);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(ok ? el : null);
    };
    const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS);
    el.onloadeddata = () => done(Number.isFinite(el.duration) && el.duration > 0);
    el.onerror = () => done(false);
    el.src = url;
  });
}

/**
 * The browser's own decoders: fast, and enough for MP4, WebM, MP3, WAV and
 * the other formats the browser plays. Anything else falls to the next plugin.
 */
export const browserMedia: MediaPlugin = {
  id: 'browser',
  label: 'Browser decoders',
  async decodeAudio(file, rate) {
    if (file.size > MAX_DECODE_BYTES) return null;
    try {
      const audio = await new OfflineAudioContext(1, 1, rate).decodeAudioData(await file.arrayBuffer());
      if (audio.numberOfChannels === 1) return audio.getChannelData(0);
      const mono = new Float32Array(audio.length);
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const data = audio.getChannelData(c);
        for (let i = 0; i < mono.length; i++) mono[i] += data[i] / audio.numberOfChannels;
      }
      return mono;
    } catch {
      return null;
    }
  },
  async playable(file) {
    const el = await load(file);
    // a video whose picture the browser cannot decode loads as sound alone, with no width
    if (!el || (file.type.startsWith('video') && el.videoWidth === 0)) return null;
    return file;
  },
};
