import type { Probe } from '../lib/compose';
import type { Range, Word } from '../lib/cuts';

/** Reports how far a long job has got, 0 to 1, with a line for the status bar. */
export type Progress = (ratio: number, label?: string) => void;

/** Every plugin names itself; the id is what a project file and the settings store. */
type Named = { id: string; label: string; detail?: string };

/**
 * Reads a media file: what it holds, its sound for transcription and the
 * silence finder, and a copy the browser can play when it cannot play the file.
 * Media plugins are tried in their registration order, first match wins.
 */
export type MediaPlugin = Named & {
  probe?(file: File): Promise<Probe>;
  /** Mono samples at `rate`, or null when this plugin cannot read the file. */
  decodeAudio(file: File, rate: number, progress: Progress, signal?: AbortSignal): Promise<Float32Array | null>;
  /** A file the browser plays, or null when this plugin cannot make one. */
  playable?(file: File, progress: Progress, signal?: AbortSignal): Promise<Blob | null>;
};

export type TranscribeOptions = { language: string | null; progress: Progress; signal?: AbortSignal };

/** Turns speech into words, each with its start and end. */
export type TranscriberPlugin = Named & {
  /** What it downloads the first time, in megabytes, shown before the user agrees. */
  downloadMB: number;
  transcribe(samples: Float32Array, rate: number, options: TranscribeOptions): Promise<Word[]>;
};

/** Finds stretches the edit can remove, without a transcript. */
export type SilencePlugin = Named & {
  find(samples: Float32Array, rate: number, options: { thresholdDb: number; minDuration: number; margin: number }): Range[];
};

/** A file around the talk, opened by the user. */
export type Addition = { file: File; duration: number };

/** Everything an exporter needs to write the finished edit. */
export type ExportJob = {
  talk: File;
  kept: Range[];
  intro?: File | null;
  outro?: File | null;
  music?: File | null;
  musicVolume: number;
  fade: number;
  loop: boolean;
  duck: boolean;
  /** Options this exporter declared in `options`, by key. */
  settings: Record<string, string>;
};

export type ExportOption = { key: string; label: string; choices: { value: string; label: string }[]; initial: string };

/** Writes the finished edit to a file. */
export type ExporterPlugin = Named & {
  extension: string;
  mime: string;
  options?: ExportOption[];
  export(job: ExportJob, progress: Progress, signal: AbortSignal): Promise<Blob>;
};

/** Reads and writes a transcript file. */
export type TranscriptFormatPlugin = Named & {
  extension: string;
  read(text: string): Word[];
  write?(words: Word[]): string;
};

export type PluginKinds = {
  media: MediaPlugin;
  transcriber: TranscriberPlugin;
  silence: SilencePlugin;
  exporter: ExporterPlugin;
  transcript: TranscriptFormatPlugin;
};
