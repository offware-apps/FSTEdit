import type { Word } from '../lib/cuts';
import type { Reply, Request } from '../transcribe.worker';
import { abortError } from './ffmpeg/core';
import type { TranscribeOptions, TranscriberPlugin } from './types';

/** Runs one transcription in a fresh worker, reporting the download, the loading and the time left. */
export function runWhisper(
  request: Omit<Request, 'audio' | 'language'>,
  samples: Float32Array,
  rate: number,
  name: string,
  { language, progress, signal }: TranscribeOptions,
): Promise<Word[]> {
  if (rate !== 16_000) throw new Error('Whisper needs sound at 16 kHz');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../transcribe.worker.ts', import.meta.url), { type: 'module' });
    const files = new Map<string, { loaded: number; total: number }>();
    let started: { at: number; done: number } | undefined;
    const end = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      end();
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const r = e.data;
      if (r.type === 'progress') {
        files.set(r.file, r);
        const loaded = [...files.values()].reduce((s, f) => s + f.loaded, 0);
        const total = [...files.values()].reduce((s, f) => s + f.total, 0);
        progress(total ? loaded / total : 0, `Loading ${name}, ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB`);
      } else if (r.type === 'status') {
        progress(0, `Loading ${name}`);
      } else if (r.type === 'transcribing') {
        // the time left, from the pace of the windows done so far
        started ??= { at: performance.now(), done: r.done };
        const ratio = r.done / r.total;
        const pace = (performance.now() - started.at) / Math.max(1, r.done - started.done);
        const left = r.done > started.done ? Math.round((pace * (r.total - r.done)) / 1000) : null;
        const eta = left === null ? '' : left > 90 ? `, about ${Math.round(left / 60)} min left` : `, about ${left} s left`;
        progress(ratio, `Transcribing on this device, ${Math.round(ratio * 100)}%${eta}`);
      } else if (r.type === 'done') {
        end();
        resolve(r.words);
      } else {
        end();
        reject(new Error(r.message));
      }
    };
    const message: Request = { ...request, audio: samples.slice(), language };
    worker.postMessage(message, [message.audio.buffer]);
  });
}

// where transformers.js keeps what it downloads, each file under the address it came from
const CACHE = 'transformers-cache';

/** Whether every file of one of the sets of `model` files is stored. */
async function stored(model: string, sets: string[][]): Promise<boolean> {
  try {
    if (!(await caches.has(CACHE))) return false;
    const cache = await caches.open(CACHE);
    const has = async (f: string) => !!(await cache.match(`https://huggingface.co/${model}/resolve/main/onnx/${f}`));
    for (const set of sets) if ((await Promise.all(set.map(has))).every(Boolean)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Whisper running in a worker through transformers.js, downloaded once from Hugging Face; one plugin per model. */
export function whisper(id: string, label: string, detail: string, downloadMB: number): TranscriberPlugin {
  let have = false;
  return {
    id,
    label,
    detail,
    downloadMB,
    note: () => (have ? `${detail}: already in this browser, works offline.` : `${detail}: downloads ${downloadMB} MB the first time, then works offline.`),
    downloaded: async () => (have = await stored(id, [['encoder_model_q4.onnx', 'decoder_model_merged_q4.onnx']])),
    transcribe: (samples, rate, options) => runWhisper({ model: id }, samples, rate, detail, options),
  };
}

/**
 * Mistral's Voxtral Mini 4B Realtime, on the graphics chip through WebGPU:
 * half precision where the chip has it, else 4-bit with full-precision sums.
 */
export function voxtral(id: string, label: string, detail: string, downloadMB: number): TranscriberPlugin {
  let have = false;
  const size = `${(downloadMB / 1000).toFixed(1)} GB`;
  return {
    id,
    label,
    detail,
    downloadMB,
    note: () =>
      !('gpu' in navigator)
        ? `${detail} needs WebGPU, which this browser does not offer; Chrome or Edge on a computer with a graphics chip has it.`
        : have
          ? `${detail}: already in this browser, runs on the graphics chip, works offline.`
          : `${detail}: downloads ${size} the first time, runs on the graphics chip, then works offline.`,
    downloaded: async () =>
      (have = await stored(id, [
        ['audio_encoder_q4f16.onnx_data', 'decoder_model_merged_q4f16.onnx_data', 'embed_tokens_q4f16.onnx_data'],
        ['audio_encoder_q4.onnx_data', 'decoder_model_merged_q4.onnx_data_1', 'embed_tokens_q4.onnx_data'],
      ])),
    transcribe: (samples, rate, options) => runWhisper({ model: id, engine: 'voxtral' }, samples, rate, detail, options),
  };
}
