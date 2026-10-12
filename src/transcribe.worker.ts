/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import type { Word } from './lib/cuts';
import { findFile, type ModelFile } from './lib/local-model';

// the runtime comes from this site, never from a CDN, so it works offline
env.backends.onnx.wasm!.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
env.allowLocalModels = false;

const RATE = 16_000;
// each window fits Whisper's 30 s context in one pass, so no overlap is merged and no word comes out twice
const WINDOW_S = 24;
// each window ends at the quietest instant between 18 and 29 s, so no word is split
const EARLIER_S = 6;
const LATER_S = 5;

export type Request = {
  audio: Float32Array;
  model: string;
  language: string | null;
  /** The model's files, picked from a folder on this device; with them nothing is downloaded. */
  files?: ModelFile[];
  dtype?: string;
};
export type Reply =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'status'; text: string }
  | { type: 'transcribing'; done: number; total: number }
  | { type: 'done'; words: Word[]; model: string }
  | { type: 'error'; message: string };

type Chunk = { text: string; timestamp: [number, number | null] };

const post = (r: Reply) => self.postMessage(r);

/** Window edges in samples, each on the quietest 50 ms between 18 and 29 s after the one before. */
function windows(audio: Float32Array): [number, number][] {
  const edges = [0];
  const hop = RATE / 20;
  while (audio.length - edges[edges.length - 1] > (WINDOW_S + LATER_S) * RATE) {
    const target = edges[edges.length - 1] + WINDOW_S * RATE;
    let best = target;
    let bestEnergy = Infinity;
    for (let c = target - EARLIER_S * RATE; c < target + LATER_S * RATE; c += hop) {
      let e = 0;
      for (let i = c; i < c + hop; i++) e += audio[i] * audio[i];
      if (e < bestEnergy) {
        bestEnergy = e;
        best = c + hop / 2;
      }
    }
    edges.push(best);
  }
  edges.push(audio.length);
  return edges.slice(1).map((end, k) => [edges[k], end]);
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { audio, model, language, files, dtype } = e.data;
  if (files) {
    // every file the model asks for comes from the folder; a request for anything else fails rather than going out
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = {
      match: async (key: RequestInfo | URL) => {
        const url = typeof key === 'string' ? key : key instanceof URL ? key.href : key.url;
        const file = findFile(files, url, model);
        return file ? new Response(file, { headers: { 'content-length': String(file.size) } }) : undefined;
      },
      put: async () => {},
    };
  }
  try {
    post({ type: 'status', text: `Loading ${model}` });
    const asr = await pipeline('automatic-speech-recognition', model, {
      dtype: (dtype ?? 'q4') as 'q4',
      device: 'wasm',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file) {
          post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
        }
      },
    });
    const words: Word[] = [];
    const parts = windows(audio);
    for (const [k, [from, to]] of parts.entries()) {
      post({ type: 'transcribing', done: from, total: audio.length });
      const out = (await asr(audio.subarray(from, to), {
        return_timestamps: 'word',
        ...(language ? { language } : {}),
      })) as { chunks?: Chunk[] };
      const offset = from / RATE;
      for (const c of out.chunks ?? []) {
        const text = c.text.trim();
        if (!text) continue;
        words.push({ text, start: offset + c.timestamp[0], end: c.timestamp[1] === null ? NaN : offset + c.timestamp[1], cut: false });
      }
      if (k === parts.length - 1) post({ type: 'transcribing', done: audio.length, total: audio.length });
    }
    // a word Whisper left open ends where the next begins, so striking it removes something
    words.forEach((w, i) => {
      if (!(w.end > w.start)) w.end = Math.max(w.start + 0.05, words[i + 1]?.start ?? audio.length / RATE);
    });
    post({ type: 'done', words, model });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
