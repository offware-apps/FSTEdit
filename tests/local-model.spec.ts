import { describe, expect, it } from 'vitest';
import { checkFolder, findFile, insidePath, pickDtype, type ModelFile } from '../src/lib/local-model';

const file = (name: string, text = '') => new File([text], name);
const folder = (paths: string[], generation = '{"alignment_heads":[[1,0]]}'): ModelFile[] =>
  paths.map((path) => ({ path, file: file(path.split('/').pop()!, path.endsWith('generation_config.json') ? generation : '') }));
const base = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json'];

describe('local model folder', () => {
  it('drops the picked folder from each path', () => {
    const f = Object.assign(file('encoder_model_q4.onnx'), { webkitRelativePath: 'whisper-base/onnx/encoder_model_q4.onnx' });
    expect(insidePath(f)).toBe('onnx/encoder_model_q4.onnx');
    expect(insidePath(file('config.json'))).toBe('config.json');
  });

  it('picks the smallest precision whose encoder and decoder are both there', () => {
    expect(pickDtype(['onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_fp16.onnx', 'onnx/encoder_model_q4.onnx'])).toBe('fp16');
    expect(pickDtype(['onnx/encoder_model_q4.onnx', 'onnx/decoder_model_merged_q4.onnx'])).toBe('q4');
    expect(pickDtype(['onnx/encoder_model.onnx', 'onnx/decoder_model_merged.onnx'])).toBe('fp32');
    expect(pickDtype(['onnx/encoder_model_q4.onnx'])).toBeNull();
  });

  it('finds the file a request names, by its path or by its name alone', () => {
    const files = folder(['onnx/encoder_model_q4.onnx', 'config.json']);
    expect(findFile(files, '/models/local/whisper/onnx/encoder_model_q4.onnx', 'local/whisper')).toBe(files[0].file);
    expect(findFile(folder(['encoder_model_q4.onnx']), 'https://x/local/whisper/onnx/encoder_model_q4.onnx', 'local/whisper')).toBeDefined();
    expect(findFile(files, '/models/other/config.json', 'local/whisper')).toBeUndefined();
  });

  it('accepts a complete timestamped export and names what a folder lacks', async () => {
    const onnx = ['onnx/encoder_model_q4.onnx', 'onnx/decoder_model_merged_q4.onnx'];
    expect(await checkFolder(folder([...base, ...onnx]))).toBeNull();
    expect(await checkFolder(folder(onnx))).toMatch(/no config.json/);
    expect(await checkFolder(folder(base))).toMatch(/ONNX pair/);
    expect(await checkFolder(folder([...base, ...onnx], '{}'))).toMatch(/_timestamped/);
  });
});
