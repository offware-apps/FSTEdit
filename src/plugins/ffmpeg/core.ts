import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { parseProbe, type Probe } from '../../lib/compose';
import type { Progress } from '../types';

let loading: Promise<FFmpeg> | null = null;
let busy: Promise<unknown> = Promise.resolve();

/** The one ffmpeg.wasm instance, loaded on first use. */
function instance(): Promise<FFmpeg> {
  loading ??= (async () => {
    const f = new FFmpeg();
    await f.load({ coreURL, wasmURL });
    return f;
  })();
  return loading;
}

/** What ffmpeg has written so far, in seconds, read off one line of its log. */
export function loggedTime(line: string): number | null {
  const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export type Session = {
  /** Runs ffmpeg; progress counts against `total` seconds of output. */
  run(args: string[], total?: number, progress?: Progress): Promise<void>;
  probe(path: string): Promise<Probe>;
  /** The file's bytes; the file leaves ffmpeg's memory at once, so a large output is never held twice. */
  read(path: string): Promise<Uint8Array<ArrayBuffer>>;
};

let mountCount = 0;

/**
 * Mounts each file read-only, so a file of any size is read in place rather
 * than copied into ffmpeg's memory, then runs `job` with their paths. Jobs
 * queue, since one ffmpeg instance runs one command at a time.
 */
export function withFiles<T>(
  files: (File | null | undefined)[],
  job: (paths: (string | null)[], s: Session) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const next = busy.then(async () => {
    if (signal?.aborted) throw abortError();
    const f = await instance();
    if (signal?.aborted) throw abortError();
    const dirs: string[] = [];
    const written: string[] = [];
    // stopping ffmpeg mid-command is only possible by ending its worker
    const onAbort = () => {
      f.terminate();
      loading = null;
    };
    signal?.addEventListener('abort', onAbort);
    try {
      const paths: (string | null)[] = [];
      for (const file of files) {
        if (!file) {
          paths.push(null);
          continue;
        }
        const dir = `/in${mountCount++}`;
        await f.createDir(dir);
        // the package exports this enum as a type only
        await f.mount('WORKERFS' as Parameters<FFmpeg['mount']>[0], { files: [file] }, dir);
        dirs.push(dir);
        // the file: prefix keeps a colon in a file name from reading as a protocol
        paths.push(`file:${dir}/${file.name}`);
      }
      const session: Session = {
        async run(args, total, progress) {
          const log = ({ message }: { message: string }) => {
            const t = loggedTime(message);
            if (t !== null && total && progress) progress(Math.min(1, t / total));
          };
          f.on('log', log);
          try {
            for (const a of args) if (a.startsWith('/out')) written.push(a);
            // a probe's -v error outlives its call in ffmpeg.wasm and would hide the progress lines
            const code = await f.exec(['-hide_banner', '-loglevel', 'info', '-y', ...args]);
            if (signal?.aborted) throw abortError();
            if (code !== 0) throw new Error(`ffmpeg stopped with code ${code}`);
          } finally {
            f.off('log', log);
          }
        },
        async probe(path) {
          const out = `/out-probe-${mountCount++}.json`;
          written.push(out);
          await f.ffprobe([
            '-v', 'error',
            '-show_entries', 'stream=codec_type,width,height,avg_frame_rate:format=duration',
            '-of', 'json', path, '-o', out,
          ]);
          return parseProbe(new TextDecoder().decode((await f.readFile(out)) as Uint8Array));
        },
        async read(path) {
          // the worker sends a fresh buffer, never a shared one
          const bytes = (await f.readFile(path)) as Uint8Array<ArrayBuffer>;
          await f.deleteFile(path).catch(() => {});
          return bytes;
        },
      };
      return await job(paths, session);
    } catch (err) {
      if (signal?.aborted) throw abortError();
      // an engine that ran out of memory or crashed is replaced, so the next job starts clean
      f.terminate();
      loading = null;
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (!signal?.aborted && loading) {
        for (const w of written) await f.deleteFile(w).catch(() => {});
        for (const d of dirs) {
          await f.unmount(d).catch(() => {});
          await f.deleteDir(d).catch(() => {});
        }
      }
    }
  });
  busy = next.catch(() => {});
  return next;
}

export function abortError(): Error {
  return new DOMException('Stopped', 'AbortError');
}
