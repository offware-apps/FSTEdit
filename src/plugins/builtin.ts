/**
 * The plugins FSTEdit ships with. Each line is one swappable block: remove it
 * to drop the feature, or register another plugin with the same contract from
 * `./types` to replace or add one. Media plugins are tried top to bottom.
 */
import { fromSrt, toSrt } from '../lib/srt';
import { fromVtt, toVtt } from '../lib/vtt';
import { gifExport, m4aExport, mp3Export, mp4Export } from './export-ffmpeg';
import { browserMedia } from './media-browser';
import { ffmpegMedia } from './media-ffmpeg';
import { register } from './registry';
import { loudnessSilence } from './silence-loudness';
import { whisperFolder } from './transcribe-folder';
import { whisper } from './transcribe-whisper';

register('media', browserMedia);
register('media', ffmpegMedia);

// base first: on a 13 s test talk it wrote the same words as turbo, in 8 s against 113 s, both from cache
register('transcriber', whisper('onnx-community/whisper-base_timestamped', 'Light', 'Whisper base', 142));
register('transcriber', whisper('onnx-community/whisper-large-v3-turbo_timestamped', 'Best', 'Whisper turbo', 759));
register('transcriber', whisperFolder());

register('silence', loudnessSilence);

register('exporter', mp4Export);
register('exporter', m4aExport);
register('exporter', mp3Export);
register('exporter', gifExport);

register('transcript', { id: 'vtt', label: 'WebVTT', detail: 'with a time on every word', extension: 'vtt', read: fromVtt, write: toVtt });
register('transcript', { id: 'srt', label: 'SRT', detail: 'one time per line', extension: 'srt', read: fromSrt, write: toSrt });
