import { composeArgs, composeGifArgs, totalDuration, type Encoding, type Input } from '../lib/compose';
import { withFiles, type Session } from './ffmpeg/core';
import type { ExportJob, ExporterPlugin } from './types';

/** Probes each mounted file, in the order talk, intro, outro, music. */
async function inputs(paths: (string | null)[], s: Session): Promise<(Input | undefined)[]> {
  const out: (Input | undefined)[] = [];
  for (const path of paths) out.push(path ? { name: path, probe: await s.probe(path) } : undefined);
  return out;
}

/** An exporter that renders the whole edit, the intro, the outro and the music, through `composeArgs`. */
function editExporter(
  base: Omit<ExporterPlugin, 'export'>,
  encoding: (settings: Record<string, string>) => Encoding,
): ExporterPlugin {
  return {
    ...base,
    export(job, progress, signal) {
      const out = `/out-edit.${base.extension}`;
      return withFiles(
        [job.talk, job.intro, job.outro, job.music],
        async (paths, s) => {
          const [talk, intro, outro, music] = await inputs(paths, s);
          const extras = { intro, outro, music, musicVolume: job.musicVolume, fade: job.fade, loop: job.loop, duck: job.duck };
          await s.run(composeArgs(talk!, job.kept, extras, out, encoding(job.settings)), totalDuration(job.kept, extras), progress);
          return new Blob([await s.read(out)], { type: base.mime });
        },
        signal,
      );
    },
  };
}

const QUALITY: Record<string, Pick<Encoding, 'preset' | 'crf'>> = {
  draft: { preset: 'ultrafast', crf: 26 },
  good: { preset: 'veryfast', crf: 20 },
  best: { preset: 'medium', crf: 18 },
};

/** An H.264 MP4, the format YouTube, PeerTube and every player take. */
export const mp4Export = editExporter(
  {
    id: 'mp4',
    label: 'Video, MP4',
    detail: 'For YouTube, PeerTube and every player',
    extension: 'mp4',
    mime: 'video/mp4',
    options: [
      {
        key: 'quality',
        label: 'Quality',
        initial: 'good',
        choices: [
          { value: 'draft', label: 'Draft, fastest' },
          { value: 'good', label: 'Good, for the web' },
          { value: 'best', label: 'Best, slowest' },
        ],
      },
    ],
  },
  (s) => ({ ...(QUALITY[s.quality] ?? QUALITY.good), audioBitrate: s.quality === 'draft' ? '128k' : '192k' }),
);

/** Sound alone in AAC, for a podcast feed or an audio player. */
export const m4aExport = editExporter(
  { id: 'm4a', label: 'Sound, M4A', detail: 'AAC, for podcast feeds', extension: 'm4a', mime: 'audio/mp4' },
  () => ({ preset: 'veryfast', crf: 20, audioBitrate: '160k', audioOnly: true }),
);

/** Sound alone in MP3, which every device plays. */
export const mp3Export = editExporter(
  { id: 'mp3', label: 'Sound, MP3', detail: 'Plays on every device', extension: 'mp3', mime: 'audio/mpeg' },
  () => ({ preset: 'veryfast', crf: 20, audioBitrate: '192k', audioOnly: true, audioCodec: 'libmp3lame' }),
);

/** An animated GIF of the picture alone, for a chat, a README or a slide. */
export const gifExport: ExporterPlugin = {
  id: 'gif',
  label: 'Animated GIF',
  detail: 'Picture only, loops, no sound',
  extension: 'gif',
  mime: 'image/gif',
  options: [
    {
      key: 'width',
      label: 'Width',
      initial: '480',
      choices: [
        { value: '320', label: '320 px' },
        { value: '480', label: '480 px' },
        { value: '720', label: '720 px' },
      ],
    },
    {
      key: 'fps',
      label: 'Frames per second',
      initial: '12',
      choices: [
        { value: '8', label: '8, smallest file' },
        { value: '12', label: '12' },
        { value: '20', label: '20, smoothest' },
      ],
    },
    {
      key: 'limit',
      label: 'Length',
      initial: '15',
      choices: [
        { value: '5', label: 'First 5 s' },
        { value: '15', label: 'First 15 s' },
        { value: '60', label: 'First minute' },
        { value: 'all', label: 'The whole edit' },
      ],
    },
  ],
  export(job, progress, signal) {
    return withFiles(
      [job.talk, job.intro, job.outro],
      async (paths, s) => {
        const [talk, intro, outro] = await inputs(paths, s);
        const limit = job.settings.limit === 'all' ? null : Number(job.settings.limit) || 15;
        const args = composeGifArgs(
          talk!,
          job.kept,
          { intro, outro },
          { width: Number(job.settings.width) || 480, fps: Number(job.settings.fps) || 12, limit },
          '/out-edit.gif',
        );
        const total = totalDuration(job.kept, { intro, outro });
        await s.run(args, limit ? Math.min(limit, total) : total, progress);
        return new Blob([await s.read('/out-edit.gif')], { type: 'image/gif' });
      },
      signal,
    );
  },
};
