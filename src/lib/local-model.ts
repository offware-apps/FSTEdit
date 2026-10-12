/** One file of a model folder, by its path inside that folder, `onnx/encoder_model_q4.onnx`. */
export type ModelFile = { path: string; file: File };

// the precisions a Whisper export ships, smallest first, each with the suffix its ONNX files carry
const DTYPES: [string, string][] = [
  ['q4', '_q4'],
  ['q8', '_quantized'],
  ['int8', '_int8'],
  ['fp16', '_fp16'],
  ['fp32', ''],
];

/** A file's path inside the folder the user picked: the picked folder's own name dropped. */
export function insidePath(file: File & { webkitRelativePath?: string }): string {
  const rel = file.webkitRelativePath || file.name;
  const parts = rel.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : rel;
}

/** The smallest precision whose encoder and decoder are both in the folder, or null. */
export function pickDtype(paths: string[]): string | null {
  const names = new Set(paths.map((p) => p.split('/').pop()));
  for (const [dtype, suffix] of DTYPES) {
    if (names.has(`encoder_model${suffix}.onnx`) && names.has(`decoder_model_merged${suffix}.onnx`)) return dtype;
  }
  return null;
}

/**
 * The model file a request names, matched on its path inside the model, then
 * on its file name alone, so files picked without their folder still match.
 */
export function findFile(files: ModelFile[], request: string, model: string): File | undefined {
  const at = request.indexOf(`${model}/`);
  if (at < 0) return undefined;
  const rel = decodeURIComponent(request.slice(at + model.length + 1).split('?')[0]);
  const exact = files.find((f) => f.path === rel);
  if (exact) return exact.file;
  const name = rel.split('/').pop();
  return files.find((f) => f.path.split('/').pop() === name)?.file;
}

/** What is missing from a folder for Whisper to run with a time on every word, or null when nothing is. */
export async function checkFolder(files: ModelFile[]): Promise<string | null> {
  const names = new Set(files.map((f) => f.path.split('/').pop()));
  const needed = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json'];
  const missing = needed.filter((n) => !names.has(n));
  if (missing.length) return `the folder has no ${missing.join(', ')}`;
  if (!pickDtype(files.map((f) => f.path))) return 'the folder has no encoder_model and decoder_model_merged ONNX pair';
  const generation = files.find((f) => f.path.split('/').pop() === 'generation_config.json')!.file;
  try {
    const config = JSON.parse(await generation.text()) as { alignment_heads?: unknown };
    // word times come from the attention heads the export lists; an export without them gives sentences only
    if (!config.alignment_heads) return 'this Whisper export gives no word times; use a "_timestamped" one';
  } catch {
    return 'generation_config.json is not JSON';
  }
  return null;
}
