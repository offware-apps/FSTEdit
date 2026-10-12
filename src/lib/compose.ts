import type { Range } from './cuts';

/** What ffprobe reports about one file, the fields the render needs. */
export type Probe = {
  duration: number;
  video: { width: number; height: number; fps: number } | null;
  audio: boolean;
  /** How many sound tracks the file holds; OBS often records the voice and the desktop apart. */
  audioStreams?: number;
};

/** One input file, by its name inside ffmpeg's file system. */
export type Input = { name: string; probe: Probe };

export type Extras = {
  intro?: Input;
  outro?: Input;
  music?: Input;
  /** Music loudness under the talk, 0 to 1. */
  musicVolume: number;
  /** Seconds the music takes to rise at the start and fall at the end. */
  fade: number;
  /** Repeat the music until the video ends. */
  loop: boolean;
  /** Lower the music further while someone speaks. */
  duck: boolean;
};

const DEFAULT_SIZE = { width: 1280, height: 720, fps: 25 };
const RATE = 48_000;

/** The probe of `ffprobe -show_entries stream=codec_type,width,height,avg_frame_rate:format=duration -of json`. */
export function parseProbe(json: string): Probe {
  const data = JSON.parse(json) as {
    streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string }[];
    format?: { duration?: string };
  };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && s.width && s.height);
  let video: Probe['video'] = null;
  if (v) {
    const [n, d] = (v.avg_frame_rate ?? '0/0').split('/').map(Number);
    const fps = d > 0 && n > 0 ? n / d : DEFAULT_SIZE.fps;
    video = { width: v.width!, height: v.height!, fps };
  }
  return {
    duration: Number(data.format?.duration) || 0,
    video,
    audio: streams.some((s) => s.codec_type === 'audio'),
    audioStreams: streams.filter((s) => s.codec_type === 'audio').length,
  };
}

const n3 = (x: number) => x.toFixed(3);

/** The total length of the rendered video. */
export function totalDuration(kept: Range[], extras: Pick<Extras, 'intro' | 'outro'>): number {
  const talk = kept.reduce((s, r) => s + r.end - r.start, 0);
  return (extras.intro?.probe.duration ?? 0) + talk + (extras.outro?.probe.duration ?? 0);
}

/** How hard the encoder works, the quality it keeps, and whether the picture is written at all. */
export type Encoding = {
  preset: string;
  crf: number;
  audioBitrate: string;
  /** Sound alone, for a podcast feed. */
  audioOnly?: boolean;
  audioCodec?: 'aac' | 'libmp3lame';
};

export const DEFAULT_ENCODING: Encoding = { preset: 'veryfast', crf: 20, audioBitrate: '192k' };

/** The input's sound as one stream: several tracks are mixed, so a voice on its own track is never lost. */
export function soundIn(i: number, probe: Probe): string {
  const n = probe.audioStreams ?? 1;
  if (n <= 1) return `[${i}:a]`;
  return `${Array.from({ length: n }, (_, k) => `[${i}:a:${k}]`).join('')}amix=inputs=${n}:duration=longest:normalize=0,`;
}

// a join between two kept stretches fades over this long, so the sound never jumps and clicks
const JOIN_FADE = 0.005;

/** Moves a time onto the nearest frame, so the picture and the sound cut at the same instant. */
const onFrame = (t: number, fps: number) => Math.round(t * fps) / fps;

type Part = { video: string; audio: string };

/**
 * Filters for the talk: each kept stretch trimmed from a constant-rate copy
 * of the source, its sound faded in and out over a few milliseconds.
 * The trims run in time order, so no frame waits in memory for a later one.
 */
function talkParts(
  i: number,
  input: Input,
  keep: Range[],
  picture: { W: number; H: number; fps: number; fit: string } | null,
  sound: string,
  filters: string[],
): Part[] {
  const fps = picture?.fps ?? DEFAULT_SIZE.fps;
  const ranges = keep
    .map((r) => (input.probe.video && picture ? { start: onFrame(r.start, fps), end: onFrame(r.end, fps) } : r))
    .filter((r) => r.end - r.start > 0.001);
  const K = ranges.length;
  const fan = (label: string) => (K > 1 ? ranges.map((_, k) => `[${label}${k}]`).join('') : `[${label}0]`);
  if (picture && input.probe.video) {
    filters.push(`[${i}:v]fps=${fps},${picture.fit}${K > 1 ? `,split=${K}` : ''}${fan('tvs')}`);
    ranges.forEach((r, k) => filters.push(`[tvs${k}]trim=start=${n3(r.start)}:end=${n3(r.end)},setpts=PTS-STARTPTS[tv${k}]`));
  } else if (picture) {
    ranges.forEach((r, k) =>
      filters.push(`color=c=black:s=${picture.W}x${picture.H}:r=${fps}:d=${n3(r.end - r.start)},format=yuv420p,setsar=1[tv${k}]`),
    );
  }
  if (input.probe.audio) {
    filters.push(`${soundIn(i, input.probe)}${sound}${K > 1 ? `,asplit=${K}` : ''}${fan('tas')}`);
    ranges.forEach((r, k) => {
      const len = r.end - r.start;
      const d = Math.min(JOIN_FADE, len / 4);
      filters.push(
        `[tas${k}]atrim=start=${n3(r.start)}:end=${n3(r.end)},asetpts=PTS-STARTPTS,afade=t=in:d=${n3(d)},afade=t=out:st=${n3(len - d)}:d=${n3(d)}[ta${k}]`,
      );
    });
  } else {
    ranges.forEach((r, k) => filters.push(`anullsrc=r=${RATE}:cl=stereo,atrim=duration=${n3(r.end - r.start)}[ta${k}]`));
  }
  return ranges.map((_, k) => ({ video: `[tv${k}]`, audio: `[ta${k}]` }));
}

/**
 * The ffmpeg arguments that render the talk's kept stretches between the
 * intro and the outro, every part brought to the talk's picture size and
 * frame rate, with the music mixed under all of it.
 */
export function composeArgs(main: Input, kept: Range[], extras: Extras, output: string, encoding = DEFAULT_ENCODING): string[] {
  if (!kept.length) throw new Error('the edit keeps nothing');
  const size = main.probe.video ?? extras.intro?.probe.video ?? extras.outro?.probe.video ?? DEFAULT_SIZE;
  // H.264 in 4:2:0 refuses an odd width or height
  const W = size.width - (size.width % 2);
  const H = size.height - (size.height % 2);
  const fps = Math.round(size.fps * 1000) / 1000;
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`;
  const sound = `aformat=sample_fmts=fltp:sample_rates=${RATE}:channel_layouts=stereo`;

  const args: string[] = ['-hide_banner', '-y'];
  const filters: string[] = [];
  const parts: Part[] = [];
  let index = 0;
  // sound alone, for a podcast feed, builds no picture at all
  const video = !encoding.audioOnly;

  // a part with no picture gets black, and a part with no sound gets silence
  const addWhole = (input: Input, label: string) => {
    const i = index++;
    args.push('-i', input.name);
    if (video && input.probe.video) filters.push(`[${i}:v]${fit},fps=${fps}[${label}v]`);
    else if (video) filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${n3(input.probe.duration)},format=yuv420p,setsar=1[${label}v]`);
    if (input.probe.audio) filters.push(`${soundIn(i, input.probe)}${sound}[${label}a]`);
    else filters.push(`anullsrc=r=${RATE}:cl=stereo,atrim=duration=${n3(input.probe.duration)}[${label}a]`);
    parts.push({ video: `[${label}v]`, audio: `[${label}a]` });
  };

  if (extras.intro) addWhole(extras.intro, 'intro');
  args.push('-i', main.name);
  parts.push(...talkParts(index++, main, kept, video ? { W, H, fps, fit } : null, sound, filters));
  if (extras.outro) addWhole(extras.outro, 'outro');

  if (video) filters.push(`${parts.map((p) => p.video + p.audio).join('')}concat=n=${parts.length}:v=1:a=1[outv][speech]`);
  else filters.push(`${parts.map((p) => p.audio).join('')}concat=n=${parts.length}:v=0:a=1[speech]`);
  let audioOut = '[speech]';

  if (extras.music) {
    const i = index++;
    if (extras.loop) args.push('-stream_loop', '-1');
    args.push('-i', extras.music.name);
    const total = totalDuration(kept, extras);
    const heard = extras.loop ? total : Math.min(total, extras.music.probe.duration);
    const fade = Math.min(extras.fade, heard / 2);
    const fades =
      fade > 0 ? `,afade=t=in:d=${n3(fade)},afade=t=out:st=${n3(heard - fade)}:d=${n3(fade)}` : '';
    filters.push(
      `[${i}:a]atrim=duration=${n3(heard)},asetpts=PTS-STARTPTS,${sound},volume=${extras.musicVolume}${fades}[music]`,
    );
    let bed = '[music]';
    if (extras.duck) {
      filters.push('[speech]asplit=2[speechmix][speechkey]');
      filters.push('[music][speechkey]sidechaincompress=threshold=0.008:ratio=5:attack=20:release=600[ducked]');
      bed = '[ducked]';
      audioOut = '[speechmix]';
    }
    filters.push(`${audioOut}${bed}amix=inputs=2:duration=first:dropout_transition=0:normalize=0[outa]`);
    audioOut = '[outa]';
  }

  args.push('-filter_complex', filters.join(';'));
  if (video) {
    args.push(
      '-map', '[outv]',
      '-c:v', 'libx264', '-preset', encoding.preset, '-crf', String(encoding.crf),
      '-profile:v', 'high', '-g', String(Math.max(1, Math.round(fps * 2))), '-bf', '2',
    );
  }
  args.push('-map', audioOut, '-c:a', encoding.audioCodec ?? 'aac', '-b:a', encoding.audioBitrate);
  if (!output.endsWith('.mp3')) args.push('-movflags', '+faststart');
  args.push(output);
  return args;
}

export type GifOptions = {
  /** Width of the GIF in pixels; the height follows the talk's shape. */
  width: number;
  fps: number;
  /** Longest the GIF runs, in seconds, or null for the whole edit. */
  limit: number | null;
};

/**
 * The ffmpeg arguments for an animated GIF of the edit: the intro, the kept
 * talk and the outro, without sound, colours chosen for the whole clip.
 */
export function composeGifArgs(
  main: Input,
  kept: Range[],
  extras: Pick<Extras, 'intro' | 'outro'>,
  { width, fps, limit }: GifOptions,
  output: string,
): string[] {
  if (!kept.length) throw new Error('the edit keeps nothing');
  const shape = main.probe.video ?? extras.intro?.probe.video ?? extras.outro?.probe.video ?? DEFAULT_SIZE;
  const W = width - (width % 2);
  const raw = Math.round((W * shape.height) / shape.width);
  const H = raw - (raw % 2);
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`;
  const args: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  const parts: [Input, Range[] | null][] = [];
  if (extras.intro) parts.push([extras.intro, null]);
  parts.push([main, kept]);
  if (extras.outro) parts.push([extras.outro, null]);
  parts.forEach(([input, keep], i) => {
    args.push('-i', input.name);
    const length = keep ? keep.reduce((s, r) => s + r.end - r.start, 0) : input.probe.duration;
    if (input.probe.video) {
      const select = keep
        ? `select='${keep.map((r) => `between(t,${n3(r.start)},${n3(r.end)})`).join('+')}',setpts=N/FRAME_RATE/TB,`
        : '';
      filters.push(`[${i}:v]${select}${fit}[p${i}]`);
    } else {
      filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${n3(length)},setsar=1[p${i}]`);
    }
    labels.push(`[p${i}]`);
  });
  const trim = limit ? `,trim=duration=${n3(limit)}` : '';
  filters.push(`${labels.join('')}concat=n=${labels.length}:v=1:a=0${trim}[cat]`);
  // one palette for the whole clip, then each frame drawn from it
  filters.push('[cat]split[a][b]');
  filters.push('[a]palettegen=stats_mode=diff[pal]');
  filters.push('[b][pal]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[gif]');
  args.push('-filter_complex', filters.join(';'), '-map', '[gif]', '-loop', '0', output);
  return args;
}
