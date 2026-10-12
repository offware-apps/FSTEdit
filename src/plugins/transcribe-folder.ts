import { checkFolder, insidePath, pickDtype, type ModelFile } from '../lib/local-model';
import { runWhisper } from './transcribe-whisper';
import type { TranscriberPlugin } from './types';

// the name the worker loads the folder under; any valid model id would do, since nothing is fetched
const MODEL = 'local/whisper';

/** Lets the user pick files, a whole folder where the browser allows it; resolves to [] when they cancel. */
function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // a phone browser picks files but not folders; the files then match by name
    if ('webkitdirectory' in input && !matchMedia('(pointer: coarse)').matches) input.webkitdirectory = true;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/**
 * Whisper from a folder on this device, an ONNX export such as
 * `onnx-community/whisper-base_timestamped`, so nothing is downloaded at all.
 */
export function whisperFolder(): TranscriberPlugin {
  let files: ModelFile[] | null = null;
  let name = '';
  let dtype = 'q4';
  return {
    id: 'folder',
    label: 'Your folder',
    detail: 'Whisper on disk',
    downloadMB: 0,
    note: () =>
      files
        ? `${name}: ${files.length} files, ${dtype}. Nothing is downloaded. Transcribe again with Shift held to pick another folder.`
        : 'Pick a folder holding a Whisper ONNX export with word times, such as whisper-base_timestamped. Nothing is downloaded.',
    async prepare(again) {
      if (files && !again) return true;
      const picked = await pickFiles();
      if (!picked.length) return false;
      const candidate = picked.map((file) => ({ path: insidePath(file), file }));
      const problem = await checkFolder(candidate);
      if (problem) throw new Error(problem);
      files = candidate;
      dtype = pickDtype(candidate.map((f) => f.path))!;
      name = (picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0] || 'Your files';
      return true;
    },
    transcribe(samples, rate, options) {
      if (!files) throw new Error('pick the model folder first');
      return runWhisper({ model: MODEL, files, dtype }, samples, rate, name, options);
    },
  };
}
