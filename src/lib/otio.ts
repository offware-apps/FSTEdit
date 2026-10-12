import type { Range } from './cuts';

/** Timeline ticks per second: milliseconds, since a browser does not expose the frame rate. */
const RATE = 1000;
const VERSION = 1;

/** A file added around the talk, by name, with its length in seconds. */
export type Added = { name: string; duration: number };

/** What surrounds the talk: the intro, the outro, and the music under all of it. */
export type Additions = {
  intro: Added | null;
  outro: Added | null;
  music: Added | null;
  musicVolume: number;
  fade: number;
  loop: boolean;
  duck: boolean;
};

/** What an FSTEdit project holds: the media, its transcript, and what the edit keeps. */
export type Project = {
  name: string;
  /** The video, by file name, read relative to the project file. */
  media: string;
  /** The WebVTT transcript, by file name, or null before transcription. */
  transcript: string | null;
  duration: number;
  kept: Range[];
  additions: Additions | null;
};

const time = (seconds: number) => ({
  OTIO_SCHEMA: 'RationalTime.1',
  rate: RATE,
  value: Math.round(seconds * RATE),
});

const range = (start: number, duration: number) => ({
  OTIO_SCHEMA: 'TimeRange.1',
  start_time: time(start),
  duration: time(duration),
});

function clip(name: string, media: string, mediaDuration: number, r: Range, role: string) {
  return {
    OTIO_SCHEMA: 'Clip.2',
    name,
    metadata: { fstedit: { role } },
    effects: [],
    markers: [],
    enabled: true,
    source_range: range(r.start, r.end - r.start),
    active_media_reference_key: 'DEFAULT_MEDIA',
    media_references: {
      DEFAULT_MEDIA: {
        OTIO_SCHEMA: 'ExternalReference.1',
        name: media,
        metadata: {},
        target_url: media,
        available_range: range(0, mediaDuration),
      },
    },
  };
}

function track(name: string, kind: 'Video' | 'Audio', children: unknown[]) {
  return {
    OTIO_SCHEMA: 'Track.1',
    name,
    kind,
    metadata: {},
    effects: [],
    markers: [],
    enabled: true,
    source_range: null,
    children,
  };
}

const whole = (a: Added, role: string) => clip(a.name, a.name, a.duration, { start: 0, end: a.duration }, role);

function sequence(p: Project) {
  const a = p.additions;
  return [
    ...(a?.intro ? [whole(a.intro, 'intro')] : []),
    ...p.kept.map((r, i) => clip(`${p.media} ${i + 1}`, p.media, p.duration, r, 'talk')),
    ...(a?.outro ? [whole(a.outro, 'outro')] : []),
  ];
}

// one clip as long as the music is heard; a looping bed says so in the metadata
function musicTrack(p: Project) {
  const a = p.additions!;
  const m = a.music!;
  const talk = p.kept.reduce((s, r) => s + r.end - r.start, 0);
  const total = (a.intro?.duration ?? 0) + talk + (a.outro?.duration ?? 0);
  const heard = a.loop ? total : Math.min(total, m.duration);
  return track('Music', 'Audio', [clip(m.name, m.name, m.duration, { start: 0, end: heard }, 'music')]);
}

/** The project as an OpenTimelineIO timeline, one clip per kept stretch. */
export function toOtio(p: Project): string {
  const timeline = {
    OTIO_SCHEMA: 'Timeline.1',
    name: p.name,
    metadata: {
      fstedit: { version: VERSION, transcript: p.transcript, duration: p.duration, additions: p.additions },
    },
    global_start_time: null,
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      metadata: {},
      effects: [],
      markers: [],
      enabled: true,
      source_range: null,
      children: [
        track('V1', 'Video', sequence(p)),
        track('A1', 'Audio', sequence(p)),
        ...(p.additions?.music ? [musicTrack(p)] : []),
      ],
    },
  };
  return `${JSON.stringify(timeline, null, 2)}\n`;
}

type Json = Record<string, unknown>;

function seconds(t: unknown): number {
  const rt = t as Json;
  const value = Number(rt?.value);
  const rate = Number(rt?.rate);
  if (!Number.isFinite(value) || !(rate > 0)) throw new Error('bad RationalTime in .otio');
  return value / rate;
}

/** The project an .otio file describes, read from its first video track. */
export function fromOtio(text: string): Project {
  const t = JSON.parse(text) as Json;
  if (typeof t.OTIO_SCHEMA !== 'string' || !t.OTIO_SCHEMA.startsWith('Timeline.')) {
    throw new Error('not an OpenTimelineIO timeline');
  }
  const meta = ((t.metadata as Json)?.fstedit ?? {}) as Json;
  const tracks = ((t.tracks as Json)?.children ?? []) as Json[];
  const video = tracks.find((tr) => tr.kind === 'Video') ?? tracks[0];
  if (!video) throw new Error('the timeline has no track');
  const role = (c: Json) => ((c.metadata as Json)?.fstedit as Json | undefined)?.role;
  // a clip FSTEdit did not mark, as another editor writes it, counts as talk
  const clips = ((video.children ?? []) as Json[]).filter(
    (c) => String(c.OTIO_SCHEMA).startsWith('Clip.') && (role(c) ?? 'talk') === 'talk',
  );
  const kept = clips.map((c) => {
    const sr = c.source_range as Json;
    const start = seconds(sr?.start_time);
    return { start, end: start + seconds(sr?.duration) };
  });
  const ref = ((clips[0]?.media_references as Json)?.DEFAULT_MEDIA ?? clips[0]?.media_reference) as
    | Json
    | undefined;
  const duration = Number(meta.duration) || Math.max(0, ...kept.map((r) => r.end));
  return {
    name: String(t.name ?? ''),
    media: String(ref?.target_url ?? ''),
    transcript: typeof meta.transcript === 'string' ? meta.transcript : null,
    duration,
    kept,
    additions: readAdditions(meta.additions),
  };
}

const added = (x: unknown): Added | null => {
  const a = x as Json | null;
  return a && typeof a.name === 'string' && Number(a.duration) > 0
    ? { name: a.name, duration: Number(a.duration) }
    : null;
};

function readAdditions(x: unknown): Additions | null {
  const a = x as Json | null | undefined;
  if (!a) return null;
  const volume = Number(a.musicVolume);
  const fade = Number(a.fade);
  return {
    intro: added(a.intro),
    outro: added(a.outro),
    music: added(a.music),
    musicVolume: volume >= 0 && volume <= 1 ? volume : 0.15,
    fade: fade >= 0 && fade <= 10 ? fade : 1,
    loop: a.loop !== false,
    duck: a.duck !== false,
  };
}
