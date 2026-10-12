import { soundIn } from '../lib/compose';
import { withFiles } from './ffmpeg/core';
import type { MediaPlugin } from './types';

const PREVIEW_HEIGHT = 480;

/**
 * ffmpeg.wasm reads every format ffmpeg reads, MKV, MOV, AVI, FLAC, Opus and
 * the rest, more slowly than the browser.
 */
export const ffmpegMedia: MediaPlugin = {
  id: 'ffmpeg',
  label: 'ffmpeg',
  probe(file) {
    return withFiles([file], ([path], s) => s.probe(path!));
  },
  decodeAudio(file, rate, progress, signal) {
    return withFiles([file], async ([path], s) => {
      const p = await s.probe(path!);
      if (!p.audio && !p.video) throw new Error(`${file.name} holds no sound or picture ffmpeg can read`);
      if (!p.audio) return new Float32Array(Math.ceil(p.duration * rate));
      // 16-bit sound is half the size of float in ffmpeg's memory; it widens to float here
      const mix = `${soundIn(0, p)}aformat=channel_layouts=mono`;
      await s.run(['-i', path!, '-filter_complex', `${mix}[s]`, '-map', '[s]', '-ar', String(rate), '-f', 's16le', '/out-sound.raw'], p.duration, progress);
      const bytes = await s.read('/out-sound.raw');
      const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
      const out = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
      return out;
    }, signal);
  },
  playable(file, progress, signal) {
    return withFiles([file], async ([path], s) => {
      const p = await s.probe(path!);
      const args = ['-i', path!];
      const graph: string[] = [];
      if (p.video) graph.push(`[0:v:0]scale=-2:'min(${PREVIEW_HEIGHT},ih)':flags=fast_bilinear,format=yuv420p[v]`);
      // every track mixed, as the export mixes them, so the preview sounds like the result
      if (p.audio) graph.push(`${soundIn(0, p)}anull[a]`);
      args.push('-filter_complex', graph.join(';'));
      if (p.video) args.push('-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30');
      if (p.audio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '96k');
      args.push('-movflags', '+faststart', '/out-preview.mp4');
      await s.run(args, p.duration, progress);
      return new Blob([await s.read('/out-preview.mp4')], { type: 'video/mp4' });
    }, signal);
  },
};
