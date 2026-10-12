import {
  ArrowLeftToLine,
  ArrowRightToLine,
  AudioLines,
  BetweenVerticalStart,
  Captions,
  Clapperboard,
  createIcons,
  Download,
  FilePlay,
  FileText,
  FolderOpen,
  Keyboard,
  MessageCircleOff,
  Music,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Undo2,
  Upload,
  WandSparkles,
} from 'lucide';
import './style.css';
import './plugins/builtin';
import * as autosave from './app/autosave';
import { Player, type Clip } from './app/player';
import { TranscriptView } from './app/transcript';
import { Waveform } from './app/waveform';
import { cutRanges, keptRanges, restoreCuts, type Range, type Silence } from './lib/cuts';
import { fillerIndexes } from './lib/fillers';
import { EditHistory } from './lib/history';
import { fromOtio, toOtio, type Additions } from './lib/otio';
import { keptBefore } from './lib/preview';
import { snapToQuiet } from './lib/silence';
import { editedWords } from './lib/subtitles';
import { list, pick } from './plugins/registry';
import type { ExporterPlugin, Progress } from './plugins/types';

const ICONS = {
  ArrowLeftToLine,
  ArrowRightToLine,
  AudioLines,
  BetweenVerticalStart,
  Captions,
  Clapperboard,
  Download,
  FilePlay,
  FileText,
  FolderOpen,
  Keyboard,
  MessageCircleOff,
  Music,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Undo2,
  Upload,
  WandSparkles,
};
const drawIcons = () => createIcons({ icons: ICONS, attrs: { 'aria-hidden': 'true' } });

const RATE = 16_000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  fileName: $<HTMLSpanElement>('file-name'),
  undo: $<HTMLButtonElement>('undo'),
  redo: $<HTMLButtonElement>('redo'),
  openMenu: $<HTMLDetailsElement>('open-menu'),
  saveMenu: $<HTMLDetailsElement>('save-menu'),
  saveList: $<HTMLDivElement>('save-list'),
  exportBtn: $<HTMLButtonElement>('export'),
  help: $<HTMLButtonElement>('help'),
  videoFile: $<HTMLInputElement>('video-file'),
  projectFile: $<HTMLInputElement>('project-file'),
  empty: $<HTMLElement>('empty'),
  drop: $<HTMLDivElement>('drop'),
  workspace: $<HTMLDivElement>('workspace'),
  scroll: $<HTMLDivElement>('script-scroll'),
  transcript: $<HTMLDivElement>('transcript'),
  transcriptEmpty: $<HTMLDivElement>('transcript-empty'),
  selectionTools: $<HTMLDivElement>('selection-tools'),
  selectionInfo: $<HTMLSpanElement>('selection-info'),
  strike: $<HTMLButtonElement>('strike'),
  restore: $<HTMLButtonElement>('restore'),
  playHere: $<HTMLButtonElement>('play-here'),
  video: $<HTMLVideoElement>('video'),
  play: $<HTMLButtonElement>('play'),
  clock: $<HTMLSpanElement>('clock'),
  summary: $<HTMLSpanElement>('edit-summary'),
  showVideo: $<HTMLInputElement>('show-video'),
  model: $<HTMLDivElement>('model'),
  language: $<HTMLSelectElement>('language'),
  transcribe: $<HTMLButtonElement>('transcribe'),
  transcribeNote: $<HTMLParagraphElement>('transcribe-note'),
  nextFiller: $<HTMLButtonElement>('next-filler'),
  cutFillers: $<HTMLButtonElement>('cut-fillers'),
  fillerNote: $<HTMLParagraphElement>('filler-note'),
  findSilences: $<HTMLButtonElement>('find-silences'),
  silenceNote: $<HTMLParagraphElement>('silence-note'),
  threshold: $<HTMLInputElement>('threshold'),
  thresholdOut: $<HTMLOutputElement>('threshold-out'),
  minSilence: $<HTMLInputElement>('min-silence'),
  margin: $<HTMLInputElement>('margin'),
  cutSilences: $<HTMLButtonElement>('cut-silences'),
  cutBefore: $<HTMLButtonElement>('cut-before'),
  cutAfter: $<HTMLButtonElement>('cut-after'),
  slots: $<HTMLUListElement>('slots'),
  slotFile: $<HTMLInputElement>('slot-file'),
  musicOptions: $<HTMLDivElement>('music-options'),
  musicVolume: $<HTMLInputElement>('music-volume'),
  musicVolumeOut: $<HTMLOutputElement>('music-volume-out'),
  fade: $<HTMLInputElement>('fade'),
  loop: $<HTMLInputElement>('loop'),
  duck: $<HTMLInputElement>('duck'),
  timeline: $<HTMLElement>('timeline'),
  ruler: $<HTMLDivElement>('ruler'),
  wave: $<HTMLCanvasElement>('wave'),
  playhead: $<HTMLDivElement>('playhead'),
  seek: $<HTMLInputElement>('seek'),
  status: $<HTMLParagraphElement>('status'),
  progress: $<HTMLProgressElement>('progress'),
  cancelJob: $<HTMLButtonElement>('cancel-job'),
  exportDialog: $<HTMLDialogElement>('export-dialog'),
  formats: $<HTMLDivElement>('formats'),
  formatOptions: $<HTMLDivElement>('format-options'),
  exportSummary: $<HTMLParagraphElement>('export-summary'),
  exportProgress: $<HTMLDivElement>('export-progress'),
  exportBar: $<HTMLProgressElement>('export-bar'),
  exportStatus: $<HTMLSpanElement>('export-status'),
  exportCancel: $<HTMLButtonElement>('export-cancel'),
  exportGo: $<HTMLButtonElement>('export-go'),
  helpDialog: $<HTMLDialogElement>('help-dialog'),
  eink: $<HTMLInputElement>('eink'),
};

type SlotName = 'intro' | 'outro' | 'music';
/** A file around the talk: open and playable, or only named by a project still waiting for it. */
type Slot = { name: string; duration: number; file: File | null; clip: Clip | null };
const SLOTS: { key: SlotName; label: string; accept: string }[] = [
  { key: 'intro', label: 'Intro', accept: 'video/*,image/gif,.mkv,.mov,.avi' },
  { key: 'outro', label: 'Outro', accept: 'video/*,image/gif,.mkv,.mov,.avi' },
  { key: 'music', label: 'Music', accept: 'audio/*,.flac,.opus,.ogg' },
];

const edit = new EditHistory();
const state = {
  file: null as File | null,
  samples: null as Float32Array | null,
  duration: 0,
  hasPicture: true,
  talkUrl: null as string | null,
  transcriptName: null as string | null,
  pendingKept: null as Range[] | null,
  model: list('transcriber')[0]?.id ?? '',
  exporter: list('exporter')[0]?.id ?? '',
  exportSettings: {} as Record<string, Record<string, string>>,
  slots: { intro: null, outro: null, music: null } as Record<SlotName, Slot | null>,
  job: null as { label: string; controller: AbortController } | null,
  fillerCursor: -1,
};

const coarse = matchMedia('(pointer: coarse)').matches;
const undoHint = coarse ? 'Undo ↶ brings it back.' : 'Ctrl+Z undoes it.';

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor(t / 60) % 60;
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const seconds = (s: number) => (s < 60 ? `${s.toFixed(1)} s` : clock(s));
const baseName = () => (state.file?.name ?? state.transcriptName ?? 'edit').replace(/\.[^.]+$/, '');
const transcriptEnd = () => edit.words.at(-1)?.end ?? 0;
const duration = () => state.duration || transcriptEnd();
// each edge lands on the quietest instant near it, so a cut never clips a consonant
const cuts = () => {
  const raw = cutRanges(edit.words, edit.silences);
  return state.samples ? snapToQuiet(raw, state.samples, RATE) : raw;
};
const kept = () => keptRanges(duration(), cuts());
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function musicSettings() {
  return {
    musicVolume: Number(ui.musicVolume.value) / 100,
    fade: Math.max(0, Number(ui.fade.value) || 0),
    loop: ui.loop.checked,
    duck: ui.duck.checked,
  };
}

// --- status bar and long jobs -------------------------------------------------

let spoken = '';

/**
 * Writes the status line. The progress bar moves on every call, the words a
 * screen reader hears change only on a new phase or every tenth of the way.
 */
function say(text: string, ratio?: number) {
  ui.progress.hidden = ratio === undefined;
  if (ratio !== undefined) ui.progress.value = Math.min(1, Math.max(0, ratio));
  const phase = text.replace(/[\d.]+\s*(%|MB|min|s)\b.*$/, '');
  const step = ratio === undefined ? -1 : Math.floor(ratio * 10);
  const key = `${phase}|${step}`;
  if (key !== spoken || ratio === undefined) {
    spoken = key;
    ui.status.textContent = text;
  } else ui.status.dataset.pending = text;
}

/**
 * Runs one long job at a time, with the progress bar and a Cancel button in
 * the status bar. A second job waits its turn by refusing, never by stopping the first.
 */
async function job<T>(label: string, run: (progress: Progress, signal: AbortSignal) => Promise<T>): Promise<T | null> {
  if (state.job) {
    say(`Wait for “${state.job.label}” to finish, or cancel it first.`);
    return null;
  }
  const controller = new AbortController();
  state.job = { label, controller };
  ui.cancelJob.hidden = false;
  say(label, 0);
  updateButtons();
  try {
    return await run((ratio, text) => say(text ?? `${label}, ${Math.round(ratio * 100)}%`, ratio), controller.signal);
  } catch (err) {
    say(isAbort(err) ? `${label}: cancelled.` : `${label} failed: ${message(err)}`);
    return null;
  } finally {
    state.job = null;
    ui.cancelJob.hidden = true;
    ui.progress.hidden = true;
    updateButtons();
  }
}

ui.cancelJob.addEventListener('click', () => state.job?.controller.abort());

// work in progress, or files only this tab holds, are worth a question before the tab closes
addEventListener('beforeunload', (e) => {
  if (state.job || exporting || Object.values(state.slots).some((s) => s?.file)) e.preventDefault();
});

// --- media, through the media plugins in order ---------------------------------

async function decodeSound(file: File, rate: number, progress: Progress, signal?: AbortSignal): Promise<Float32Array> {
  for (const m of list('media')) {
    const samples = await m.decodeAudio(file, rate, progress, signal);
    if (samples) return samples;
  }
  throw new Error(`no plugin reads the sound of ${file.name}`);
}

async function playableCopy(file: File, progress: Progress, signal?: AbortSignal): Promise<Blob> {
  for (const m of list('media')) {
    const blob = await m.playable?.(file, progress, signal);
    if (blob) return blob;
  }
  throw new Error(`no plugin can play ${file.name}`);
}

function mediaDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve(el.duration);
    el.onerror = () => reject(new Error('the browser cannot read its length'));
    el.src = url;
  });
}

// --- the edit's views ----------------------------------------------------------

const view = new TranscriptView(ui.transcript, edit, {
  select(seekTo) {
    if (seekTo !== null && !player.playing && state.talkUrl) ui.video.currentTime = seekTo;
    updateSelection();
  },
  toggle: () => toggleSelection(),
});

const player = new Player(
  ui.video,
  {
    kept,
    cuts,
    words: () => edit.words,
    intro: () => state.slots.intro?.clip ?? null,
    outro: () => state.slots.outro?.clip ?? null,
    music: () => state.slots.music?.clip ?? null,
    musicSettings,
  },
  () => tick(),
);

const wave = new Waveform(ui.wave, ui.playhead);

let lastTick = 0;

function tick() {
  // a slow screen gets one redraw a second while playing, not four
  const now = performance.now();
  if (document.documentElement.classList.contains('eink') && player.playing && now - lastTick < 1000) return;
  lastTick = now;
  const total = player.total();
  ui.clock.textContent = `${clock(player.editTime())} / ${clock(total)}`;
  ui.play.dataset.playing = String(player.playing);
  ui.play.setAttribute('aria-label', player.playing ? 'Pause' : 'Play the edit');
  const t = ui.video.currentTime;
  wave.moveTo(t);
  if (state.duration) {
    ui.seek.value = String(Math.round(t * 10));
    ui.seek.setAttribute('aria-valuetext', `${clock(t)} of ${clock(state.duration)}`);
  }
  view.setNow(player.playing && player.part === 'talk' ? t : -1);
}

/** Time labels above the waveform, spaced so they never crowd. */
function drawRuler() {
  const d = state.duration;
  const width = ui.ruler.clientWidth;
  if (!d || !width) return;
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  const step = steps.find((s) => (s / d) * width >= 70) ?? 3600;
  const labels: HTMLSpanElement[] = [];
  for (let t = 0; t <= d; t += step) {
    const s = document.createElement('span');
    s.style.left = `${(100 * t) / d}%`;
    s.textContent = clock(t);
    labels.push(s);
  }
  ui.ruler.replaceChildren(...labels);
}
new ResizeObserver(drawRuler).observe(ui.ruler);

/** Brings every view up to date after a change to the strikes. */
function changed() {
  view.refresh();
  wave.setCuts(cuts());
  updateSummary();
  updateSelection();
  updateButtons();
  tick();
  autosaveNow();
}

function autosaveNow() {
  const key = state.file ? autosave.keyOf(state.file) : state.transcriptName;
  if (!key || edit.words.length + edit.silences.length === 0) return;
  autosave.save(
    key,
    { words: edit.words, silences: edit.silences, transcriptName: state.transcriptName, additions: additions() },
    (why) => say(`Not kept in this browser: ${why}.`),
  );
}

function rebuilt() {
  view.rebuild();
  ui.transcriptEmpty.hidden = view.length > 0;
  changed();
}

function updateSummary() {
  const d = duration();
  if (!d) {
    ui.summary.textContent = '';
    return;
  }
  const removed = d - keptBefore(Infinity, kept());
  ui.summary.textContent = removed > 0.05 ? `−${seconds(removed)} cut` : '';
  const fillers = fillerIndexes(edit.words).length;
  ui.fillerNote.textContent = edit.words.length
    ? fillers
      ? `${plural(fillers, 'filler', 'fillers')} left: um, uh, euh, ben and the like.`
      : 'None left in the transcript.'
    : 'Transcribe first, then strike every um and euh at once.';
  const found = edit.silences.filter((s) => !s.label);
  ui.silenceNote.textContent = found.length
    ? `${found.length} found, ${found.filter((s) => s.cut).length} struck, ${seconds(found.reduce((s, x) => s + x.end - x.start, 0))} in all.`
    : 'Pauses longer than you set below.';
}

function placeSelectionBar() {
  const sel = view.selection();
  const show = !!sel && view.length > 0;
  ui.selectionTools.hidden = !show;
  if (!show) return;
  // on a narrow screen the bar stays at the bottom of the window, set in the stylesheet
  if (matchMedia('(max-width: 1100px)').matches) return;
  const first = ui.transcript.querySelector<HTMLElement>(`[data-k="${sel![0]}"]`);
  if (!first) return;
  const host = ui.selectionTools.parentElement!.getBoundingClientRect();
  const r = first.getBoundingClientRect();
  const bar = ui.selectionTools.getBoundingClientRect();
  const top = r.top - host.top - bar.height - 8;
  const left = Math.min(Math.max(8, r.left - host.left), host.width - bar.width - 8);
  ui.selectionTools.style.top = `${top < 8 ? r.bottom - host.top + 8 : top}px`;
  ui.selectionTools.style.left = `${left}px`;
}
ui.scroll.addEventListener('scroll', placeSelectionBar, { passive: true });
addEventListener('resize', placeSelectionBar);

function updateSelection() {
  const sel = view.selected();
  const n = sel.length;
  ui.selectionInfo.textContent = n > 1 ? `${n} selected` : '';
  ui.strike.disabled = !n || sel.every((e) => e.cut);
  ui.restore.disabled = !n || !sel.some((e) => e.cut);
  ui.playHere.disabled = !n || !state.talkUrl;
  placeSelectionBar();
}

function updateButtons() {
  const open = !!state.file || edit.words.length > 0;
  document.body.classList.toggle('open', open);
  ui.empty.hidden = open;
  ui.workspace.hidden = !open;
  ui.timeline.hidden = !state.samples;
  ui.fileName.hidden = !state.file;
  ui.fileName.textContent = state.file?.name ?? '';
  ui.undo.disabled = !edit.canUndo;
  ui.redo.disabled = !edit.canRedo;
  const busy = !!state.job;
  const model = pick('transcriber', state.model);
  ui.model.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.id === model.id;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  ui.transcribeNote.textContent = model.note?.() ?? '';
  ui.transcribe.disabled = !state.samples || busy;
  ui.transcribe.lastChild!.textContent = edit.words.length ? 'Transcribe again' : 'Transcribe';
  ui.findSilences.disabled = !state.samples;
  ui.cutSilences.disabled = !edit.silences.some((s) => !s.cut && !s.label);
  const fillers = fillerIndexes(edit.words).length;
  ui.cutFillers.disabled = fillers === 0;
  ui.nextFiller.disabled = fillers === 0;
  ui.cutBefore.disabled = ui.cutAfter.disabled = !state.talkUrl;
  ui.play.disabled = !state.talkUrl;
  for (const b of ui.slots.querySelectorAll<HTMLButtonElement>('button')) b.disabled = busy;
  const waiting = Object.values(state.slots).some((x) => x && !x.file);
  ui.exportBtn.disabled = !state.file || !state.duration || waiting;
  ui.exportBtn.title = waiting ? 'Open the files the project names, or remove them' : 'Export (Ctrl+E)';
}

// --- editing -------------------------------------------------------------------

function setSelection(value: boolean) {
  const sel = view.selected();
  if (!sel.length) return;
  edit.change(value ? 'strike' : 'restore', () => sel.forEach((e) => (e.cut = value)));
  changed();
  say(`${plural(sel.length, 'item', 'items')} ${value ? 'struck' : 'restored'}. ${undoHint}`);
}

function toggleSelection() {
  const sel = view.selected();
  if (sel.length) setSelection(!sel.every((e) => e.cut));
}

ui.strike.addEventListener('click', () => setSelection(true));
ui.restore.addEventListener('click', () => setSelection(false));
ui.playHere.addEventListener('click', () => {
  const s = view.selection();
  if (s) player.play(view.entry(s[0]).start);
});

function undo() {
  const label = edit.undo();
  if (label) {
    rebuilt();
    say(`Undid ${label}.`);
  }
}

function redo() {
  const label = edit.redo();
  if (label) {
    rebuilt();
    say(`Redid ${label}.`);
  }
}

ui.undo.addEventListener('click', undo);
ui.redo.addEventListener('click', redo);

ui.cutFillers.addEventListener('click', () => {
  const idx = fillerIndexes(edit.words);
  if (!idx.length) return;
  edit.change('strike filler words', () => idx.forEach((i) => (edit.words[i].cut = true)));
  changed();
  say(`${plural(idx.length, 'filler word', 'filler words')} struck. ${undoHint}`);
});

// one filler at a time, for a check before striking: it is selected, shown and played from
ui.nextFiller.addEventListener('click', () => {
  const idx = fillerIndexes(edit.words);
  if (!idx.length) return;
  const next = idx.find((i) => i > state.fillerCursor) ?? idx[0];
  state.fillerCursor = next;
  const w = edit.words[next];
  const k = [...ui.transcript.querySelectorAll<HTMLElement>('.w')].find((el) => el.textContent === w.text && view.entry(Number(el.dataset.k)) === w);
  if (k) {
    view.select(Number(k.dataset.k));
    k.scrollIntoView({ block: 'center' });
  }
  say(`“${w.text}” at ${clock(w.start)}, ${idx.indexOf(next) + 1} of ${idx.length}. Press X to strike it.`);
});

ui.threshold.addEventListener('input', () => (ui.thresholdOut.textContent = `${ui.threshold.value} dB`));
ui.thresholdOut.textContent = `${ui.threshold.value} dB`;

ui.findSilences.addEventListener('click', () => {
  if (!state.samples) return;
  const found = pick('silence').find(state.samples, RATE, {
    thresholdDb: Number(ui.threshold.value),
    minDuration: Number(ui.minSilence.value),
    margin: Number(ui.margin.value),
  });
  edit.change('find silences', () => (edit.silences = [...edit.silences.filter((s) => s.label), ...found.map((r) => ({ ...r, cut: false }))]));
  rebuilt();
  say(`${plural(found.length, 'silence', 'silences')} found. They show in the transcript as grey marks; strike them one by one or all at once.`);
});

ui.cutSilences.addEventListener('click', () => {
  const open = edit.silences.filter((s) => !s.cut && !s.label);
  edit.change('strike silences', () => open.forEach((s) => (s.cut = true)));
  changed();
  say(`${plural(open.length, 'silence', 'silences')} struck. ${undoHint}`);
});

/** Strikes everything before or after the playhead, as one marked stretch the transcript shows. */
function trim(side: 'before' | 'after') {
  const t = ui.video.currentTime;
  const d = state.duration;
  if (!d || (side === 'before' && t < 0.05) || (side === 'after' && t > d - 0.05)) return;
  const label = side === 'before' ? 'Before the start' : 'After the end';
  const range: Silence = side === 'before' ? { start: 0, end: t, cut: true, label } : { start: t, end: d, cut: true, label };
  edit.change(`cut ${side} the playhead`, () => (edit.silences = [...edit.silences.filter((s) => s.label !== label), range]));
  rebuilt();
  say(`${seconds(range.end - range.start)} ${side === 'before' ? 'before' : 'after'} ${clock(t)} cut. ${undoHint}`);
}
ui.cutBefore.addEventListener('click', () => trim('before'));
ui.cutAfter.addEventListener('click', () => trim('after'));

// --- transcription -------------------------------------------------------------

ui.model.replaceChildren(
  ...list('transcriber').map((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.id = m.id;
    b.textContent = m.label;
    const small = document.createElement('small');
    small.textContent = m.downloadMB ? `${m.detail ?? ''}, ${m.downloadMB} MB` : (m.detail ?? '');
    b.append(small);
    b.addEventListener('click', () => {
      state.model = m.id;
      updateButtons();
    });
    return b;
  }),
);

/** Arrow keys move the choice in a group of radio buttons, as a screen reader announces them. */
function radioKeys(group: HTMLElement, choose: (b: HTMLButtonElement) => void) {
  group.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const all = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const at = all.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const next = all[(at + step + all.length) % all.length];
    choose(next);
    group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  });
}
radioKeys(ui.model, (b) => b.click());
radioKeys(ui.formats, (b) => b.click());

ui.transcribe.addEventListener('click', async (e) => {
  if (!state.samples) return;
  const plugin = pick('transcriber', state.model);
  // a plugin that needs something from the user, a folder for one, asks while the click still counts as theirs
  if (plugin.prepare) {
    try {
      if (!(await plugin.prepare(e.shiftKey))) return;
    } catch (err) {
      say(`${plugin.label}: ${message(err)}.`);
      return;
    } finally {
      updateButtons();
    }
  }
  if (edit.words.length && !confirm('Transcribe again? The strikes on the current transcript go, and Undo cannot bring them back.')) return;
  const started = performance.now();
  const words = await job(`Transcribing with ${plugin.detail ?? plugin.label}`, (progress, signal) =>
    plugin.transcribe(state.samples!, RATE, { language: ui.language.value || null, progress, signal }),
  );
  if (!words) return;
  edit.reset(words, edit.silences);
  state.transcriptName = `${baseName()}.vtt`;
  applyPendingKept();
  rebuilt();
  say(`${plural(words.length, 'word', 'words')} transcribed by ${plugin.detail ?? plugin.label} in ${clock((performance.now() - started) / 1000)}.`);
});

// --- opening files -------------------------------------------------------------

async function openMedia(file: File) {
  if (state.job) {
    say(`Wait for “${state.job.label}” to finish, or cancel it first.`);
    return;
  }
  player.stop();
  state.file = file;
  state.samples = null;
  state.duration = 0;
  if (state.talkUrl) URL.revokeObjectURL(state.talkUrl);
  state.talkUrl = null;
  Player.setSource(ui.video, null);
  edit.reset([], []);
  state.transcriptName = null;
  rebuilt();
  const samples = await job(`Reading the sound of ${file.name}`, (p, signal) => decodeSound(file, RATE, p, signal));
  if (!samples) return;
  state.samples = samples;
  state.duration = samples.length / RATE;
  ui.seek.max = String(Math.round(state.duration * 10));
  wave.setSound(samples, RATE);
  drawRuler();
  const saved = autosave.load(autosave.keyOf(file));
  if (saved?.words.length || saved?.silences.length) {
    edit.reset(saved.words, saved.silences);
    state.transcriptName = saved.transcriptName;
    if (saved.additions) applyAdditions(saved.additions);
  }
  applyPendingKept();
  rebuilt();
  const playable = await job('Preparing playback', (p, signal) => playableCopy(file, p, signal));
  if (playable) {
    state.talkUrl = URL.createObjectURL(playable);
    Player.setSource(ui.video, state.talkUrl);
    player.show('talk');
    ui.video.addEventListener('loadedmetadata', () => (state.hasPicture = ui.video.videoWidth > 0), { once: true });
  }
  const note =
    playable && playable !== file ? ' The browser cannot play this format, so you watch a lighter copy; the export uses the original.' : '';
  say(
    saved?.words.length
      ? `Restored your last edit of ${file.name}.${note}`
      : `${file.name} is open, ${clock(state.duration)} long. Transcribe it, or open its transcript.${note}`,
  );
  updateButtons();
}

function applyPendingKept() {
  if (!state.pendingKept || !duration()) return;
  const restored = restoreCuts(edit.words, duration(), state.pendingKept);
  edit.reset(restored.words, restored.silences);
  state.pendingKept = null;
}

const extension = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? '';
const isProjectFile = (f: File) => extension(f) === 'otio' || list('transcript').some((t) => t.extension === extension(f));

async function openProjectFiles(files: File[]) {
  // the transcript first, so the project's strikes land on its words
  files.sort((a, b) => Number(extension(a) === 'otio') - Number(extension(b) === 'otio'));
  try {
    for (const f of files) {
      const text = await f.text();
      const format = list('transcript').find((t) => t.extension === extension(f));
      if (format) {
        edit.reset(format.read(text), edit.silences);
        state.transcriptName = f.name;
        // an edit made on the transcript alone, on a tablet without the video, comes back too
        const saved = !state.file ? autosave.load(f.name) : null;
        if (saved?.words.length === edit.words.length) {
          edit.reset(saved.words, saved.silences);
          say(`Restored your last edit of ${f.name}.`);
        } else say(`${plural(edit.words.length, 'word', 'words')} read from ${f.name}.`);
      } else {
        const p = fromOtio(text);
        if (state.file && p.media && p.media !== state.file.name) say(`${f.name} edits ${p.media}, and ${state.file.name} is open.`);
        // without the recording open, the project's own length stands in for it
        if (!state.samples) state.duration = p.duration;
        state.pendingKept = p.kept;
        if (p.additions) applyAdditions(p.additions);
        if (!edit.words.length && p.transcript) say(`Open ${p.transcript} too, to see the strikes.`);
      }
    }
    applyPendingKept();
  } catch (err) {
    say(`Could not open it: ${message(err)}`);
  }
  rebuilt();
}

async function openDropped(files: File[]) {
  const media = files.find((f) => !isProjectFile(f));
  if (media) await openMedia(media);
  const project = files.filter(isProjectFile);
  if (project.length) await openProjectFiles(project);
}

ui.videoFile.addEventListener('change', () => {
  const f = ui.videoFile.files?.[0];
  ui.videoFile.value = '';
  if (f) void openMedia(f);
});
ui.projectFile.addEventListener('change', () => {
  const files = [...(ui.projectFile.files ?? [])];
  ui.projectFile.value = '';
  void openProjectFiles(files);
});
for (const id of ['open-video', 'open-video-big']) {
  $(id).addEventListener('click', () => {
    closeMenus();
    ui.videoFile.click();
  });
}
$('open-project').addEventListener('click', () => {
  closeMenus();
  ui.projectFile.click();
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  ui.drop.classList.add('over');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) ui.drop.classList.remove('over');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  ui.drop.classList.remove('over');
  void openDropped([...(e.dataTransfer?.files ?? [])]);
});

// --- saving --------------------------------------------------------------------

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

function additions(): Additions | null {
  const { intro, outro, music } = state.slots;
  if (!intro && !outro && !music) return null;
  const plain = (x: Slot | null) => (x ? { name: x.name, duration: x.duration } : null);
  return { intro: plain(intro), outro: plain(outro), music: plain(music), ...musicSettings() };
}

function projectText() {
  return toOtio({
    name: baseName(),
    media: state.file?.name ?? '',
    transcript: edit.words.length ? (state.transcriptName ?? `${baseName()}.vtt`) : null,
    duration: duration(),
    kept: kept(),
    additions: additions(),
  });
}

function buildSaveMenu() {
  const writers = list('transcript').filter((t) => t.write);
  const items: { label: string; detail: string; act: () => void; enabled: boolean }[] = [
    {
      label: 'Project, .otio',
      detail: 'The cuts, the intro and the music; opens again here, and in Resolve',
      act: () => download(new Blob([projectText()], { type: 'application/json' }), `${baseName()}.otio`),
      enabled: duration() > 0,
    },
    ...writers.map((t) => ({
      label: `Transcript, .${t.extension}`,
      detail: `Every word at its original time, ${t.detail ?? t.label}`,
      act: () => download(new Blob([t.write!(edit.words)], { type: 'text/plain' }), `${baseName()}.${t.extension}`),
      enabled: edit.words.length > 0,
    })),
    ...writers.map((t) => ({
      label: `Subtitles for the edit, .${t.extension}`,
      detail: 'Struck words dropped, times matching the exported video',
      act: () => {
        const words = editedWords(edit.words, kept(), state.slots.intro?.duration ?? 0);
        download(new Blob([t.write!(words)], { type: 'text/plain' }), `${baseName()}-edit.${t.extension}`);
      },
      enabled: edit.words.length > 0,
    })),
  ];
  ui.saveList.replaceChildren(
    ...items.map(({ label, detail, act, enabled }) => {
      const b = document.createElement('button');
      b.type = 'button';
      const text = document.createElement('span');
      text.textContent = label;
      const small = document.createElement('small');
      small.textContent = detail;
      text.append(small);
      b.append(text);
      b.disabled = !enabled;
      b.addEventListener('click', () => {
        closeMenus();
        act();
      });
      return b;
    }),
  );
}

ui.saveMenu.addEventListener('toggle', () => ui.saveMenu.open && buildSaveMenu());

/** Closes the menus; focus inside one goes back to its button rather than to the top of the page. */
function closeMenus() {
  for (const m of [ui.openMenu, ui.saveMenu]) {
    if (m.open && m.contains(document.activeElement)) m.querySelector('summary')!.focus();
    m.open = false;
  }
}
document.addEventListener('pointerdown', (e) => {
  if (!(e.target as HTMLElement).closest('details.menu')) closeMenus();
});

// --- export dialog -------------------------------------------------------------

let exporting: AbortController | null = null;

function exporterSettings(p: ExporterPlugin): Record<string, string> {
  const s = (state.exportSettings[p.id] ??= {});
  for (const o of p.options ?? []) s[o.key] ??= o.initial;
  return s;
}

function drawExportDialog() {
  ui.formats.replaceChildren(
    ...list('exporter').map((p) => {
      const on = p.id === state.exporter;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'format';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      const strong = document.createElement('strong');
      strong.textContent = `${p.label}, .${p.extension}`;
      const small = document.createElement('small');
      small.textContent = p.detail ?? '';
      b.append(strong, small);
      b.addEventListener('click', () => {
        state.exporter = p.id;
        drawExportDialog();
      });
      return b;
    }),
  );
  const p = pick('exporter', state.exporter);
  const settings = exporterSettings(p);
  ui.formatOptions.replaceChildren(
    ...(p.options ?? []).map((o) => {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('label');
      label.className = 'label';
      label.htmlFor = `opt-${p.id}-${o.key}`;
      label.textContent = o.label;
      const select = document.createElement('select');
      select.id = label.htmlFor;
      select.className = 'input';
      for (const c of o.choices) select.add(new Option(c.label, c.value, false, c.value === settings[o.key]));
      select.addEventListener('change', () => (settings[o.key] = select.value));
      field.append(label, select);
      return field;
    }),
  );
  const picture = p.mime.startsWith('video') || p.mime.startsWith('image');
  const sound = !p.mime.startsWith('image');
  const parts = [
    state.slots.intro && 'the intro',
    'the talk',
    state.slots.outro && 'the outro',
    state.slots.music && sound && 'the music',
  ].filter(Boolean);
  ui.exportSummary.textContent = `${clock(player.total())}: ${parts.join(', ')}${picture ? '' : ', sound only'}. Made on this device from the original file.`;
}

function openExport() {
  if (ui.exportBtn.disabled) return;
  player.stop();
  // a recording with no picture starts on a sound format
  if (!state.hasPicture && pick('exporter', state.exporter).mime.startsWith('video')) {
    state.exporter = list('exporter').find((x) => x.mime.startsWith('audio'))?.id ?? state.exporter;
  }
  drawExportDialog();
  ui.exportProgress.hidden = true;
  ui.exportGo.disabled = false;
  ui.exportCancel.textContent = 'Close';
  ui.exportDialog.showModal();
}

ui.exportBtn.addEventListener('click', openExport);

ui.exportCancel.addEventListener('click', () => {
  if (exporting) exporting.abort();
  else ui.exportDialog.close();
});

ui.exportDialog.addEventListener('cancel', (e) => {
  // Esc stops a running export rather than hiding it
  if (exporting) {
    e.preventDefault();
    exporting.abort();
  }
});

ui.exportGo.addEventListener('click', async () => {
  if (!state.file) return;
  if (state.job) {
    ui.exportStatus.textContent = `Wait for “${state.job.label}” to finish first.`;
    ui.exportProgress.hidden = false;
    return;
  }
  const p = pick('exporter', state.exporter);
  exporting = new AbortController();
  ui.exportGo.disabled = true;
  ui.exportCancel.textContent = 'Stop';
  ui.exportProgress.hidden = false;
  ui.exportBar.value = 0;
  ui.exportStatus.textContent = 'Loading the encoder';
  const started = performance.now();
  let announced = -1;
  try {
    const blob = await p.export(
      {
        talk: state.file,
        kept: kept(),
        intro: state.slots.intro?.file,
        outro: state.slots.outro?.file,
        music: state.slots.music?.file,
        ...musicSettings(),
        settings: exporterSettings(p),
      },
      (ratio) => {
        ui.exportBar.value = ratio;
        // the text, which a screen reader reads, moves by quarters; the bar moves all the time
        const quarter = Math.floor(ratio * 4);
        if (quarter !== announced) {
          announced = quarter;
          ui.exportStatus.textContent = `Encoding, ${quarter * 25}%`;
        }
      },
      exporting.signal,
    );
    const took = clock((performance.now() - started) / 1000);
    download(blob, `${baseName()}-edit.${p.extension}`);
    ui.exportStatus.textContent = `Done in ${took}, ${(blob.size / 1e6).toFixed(1)} MB. The file is in your downloads.`;
    say(`Exported ${baseName()}-edit.${p.extension}.`);
  } catch (err) {
    ui.exportStatus.textContent = isAbort(err) ? 'Stopped.' : `Export failed: ${message(err)}`;
  } finally {
    exporting = null;
    ui.exportGo.disabled = false;
    ui.exportCancel.textContent = 'Close';
  }
});

// --- intro, outro and music ----------------------------------------------------

let picking: SlotName = 'intro';

async function readAddition(file: File, progress: Progress, signal: AbortSignal): Promise<Slot> {
  const playable = await playableCopy(file, progress, signal);
  const url = URL.createObjectURL(playable);
  const length = await mediaDuration(url);
  const sound = await decodeSound(file, 8000, () => {}, signal);
  return { name: file.name, duration: length, file, clip: { url, duration: length, sound: sound.some((v) => Math.abs(v) > 1e-4) } };
}

// a project names its files; each waits for the user to open it again
function applyAdditions(a: Additions) {
  for (const { key } of SLOTS) {
    const named = a[key];
    const open = state.slots[key];
    state.slots[key] = named ? (open?.name === named.name ? open : { ...named, file: null, clip: null }) : null;
  }
  ui.musicVolume.value = String(Math.round(a.musicVolume * 100));
  ui.fade.value = String(a.fade);
  ui.loop.checked = a.loop;
  ui.duck.checked = a.duck;
  drawSlots();
  sayMissing();
}

function sayMissing() {
  const missing = Object.values(state.slots)
    .filter((x) => x && !x.file)
    .map((x) => x!.name);
  if (missing.length) say(`Open ${missing.join(' and ')} in Intro & music to export with ${missing.length > 1 ? 'them' : 'it'}.`);
  return missing.length;
}

function drawSlots() {
  ui.slots.replaceChildren(
    ...SLOTS.map(({ key, label, accept }) => {
      const slot = state.slots[key];
      const li = document.createElement('li');
      li.className = 'slot';
      const tag = document.createElement('span');
      tag.className = 'slot-label';
      tag.textContent = label;
      const name = document.createElement('span');
      name.className = `slot-file${slot ? (slot.file ? '' : ' missing') : ' none'}`;
      name.textContent = slot ? slot.name : 'None';
      if (slot) {
        const small = document.createElement('small');
        small.textContent = slot.file ? clock(slot.duration) : 'not open';
        name.append(small);
      }
      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'ghost';
      pickBtn.textContent = slot?.file ? 'Change' : slot ? 'Open' : 'Add';
      pickBtn.setAttribute('aria-label', `${pickBtn.textContent} the ${label.toLowerCase()}`);
      pickBtn.addEventListener('click', () => {
        picking = key;
        ui.slotFile.accept = accept;
        ui.slotFile.click();
      });
      li.append(tag, name, pickBtn);
      if (slot) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = '✕';
        remove.setAttribute('aria-label', `Remove the ${label.toLowerCase()}`);
        remove.addEventListener('click', () => {
          if (slot.clip) URL.revokeObjectURL(slot.clip.url);
          state.slots[key] = null;
          drawSlots();
          autosaveNow();
        });
        li.append(remove);
      }
      return li;
    }),
  );
  ui.musicOptions.hidden = !state.slots.music;
  ui.musicVolumeOut.textContent = `${ui.musicVolume.value}%`;
  player.sync();
  tick();
  updateButtons();
}

ui.slotFile.addEventListener('change', async () => {
  const file = ui.slotFile.files?.[0];
  ui.slotFile.value = '';
  if (!file) return;
  const key = picking;
  const slot = await job(`Reading ${file.name}`, (p, signal) => readAddition(file, p, signal));
  if (!slot) return;
  const old = state.slots[key];
  if (old?.clip) URL.revokeObjectURL(old.clip.url);
  state.slots[key] = slot;
  drawSlots();
  autosaveNow();
  if (!sayMissing()) say(`${file.name} added, ${clock(slot.duration)}. Play the edit to hear it in place.`);
});

for (const input of [ui.musicVolume, ui.fade, ui.loop, ui.duck]) input.addEventListener('change', autosaveNow);
ui.musicVolume.addEventListener('input', () => (ui.musicVolumeOut.textContent = `${ui.musicVolume.value}%`));

// --- playback and timeline -----------------------------------------------------

function play(rate = 1) {
  player.rate = rate;
  const s = view.selection();
  player.play(s && s[0] > 0 ? view.entry(s[0]).start : 0);
}

function togglePlay() {
  if (player.playing) player.stop();
  else play();
}

ui.play.addEventListener('click', togglePlay);
ui.showVideo.addEventListener('change', () => {
  player.showPicture = ui.showVideo.checked;
  player.show(player.part ?? 'talk');
});
ui.seek.addEventListener('input', () => {
  if (!state.duration || !state.talkUrl) return;
  if (player.playing) player.stop();
  ui.video.currentTime = Number(ui.seek.value) / 10;
});

// --- tabs, dialogs, settings and keys ------------------------------------------

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
function selectTab(tab: HTMLButtonElement, focus = false) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')!).hidden = !on;
  }
  if (focus) tab.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
  });
});

ui.help.addEventListener('click', () => ui.helpDialog.showModal());

/** The e-ink look: black on white, no motion, one redraw a second while playing. */
function setEink(on: boolean) {
  document.documentElement.classList.toggle('eink', on);
  view.follow = !on;
  ui.eink.checked = on;
  try {
    localStorage.setItem('fstedit-eink', on ? '1' : '0');
  } catch {
    // the choice holds for this visit
  }
}
ui.eink.addEventListener('change', () => setEink(ui.eink.checked));
try {
  setEink(localStorage.getItem('fstedit-eink') === '1' || matchMedia('(update: slow)').matches);
} catch {
  setEink(false);
}

const FRAME = 1 / 25;

document.addEventListener('keydown', (e) => {
  const target = e.target instanceof Element ? e.target : document.body;
  const typing = target.matches('input, select, textarea') && !target.matches('[type="range"]');
  if (typing || document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  // the single-key shortcuts act only from the transcript or the page, never from a control that has its own use for them
  const free = target === ui.transcript || target === document.body || target === ui.seek;
  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && key === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && key === 'e') {
    e.preventDefault();
    openExport();
  } else if (e.key === 'Escape') {
    player.stop();
    closeMenus();
  } else if (mod || !free) {
    return;
  } else if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (key === 'l') {
    play(player.playing ? Math.min(2, player.rate + 0.5) : 1);
  } else if (key === 'k') {
    player.stop();
  } else if (key === 'j') {
    const back = Math.max(0, ui.video.currentTime - 5);
    if (player.playing) player.play(back);
    else ui.video.currentTime = back;
  } else if ((key === ',' || key === '.') && !player.playing && state.talkUrl) {
    ui.video.currentTime = Math.max(0, ui.video.currentTime + (key === '.' ? FRAME : -FRAME));
  } else if (e.key === '?') {
    ui.helpDialog.showModal();
  }
});

ui.video.addEventListener('seeked', () => !player.playing && tick());

// --- offline -------------------------------------------------------------------

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}
// the model and the engines are large; asking the browser to keep them spares a second download offline
void navigator.storage?.persist?.().catch(() => {});

drawIcons();
drawSlots();
rebuilt();
