import { describe, expect, it } from 'vitest';
import { DEFAULT_ENCODING, composeArgs, composeGifArgs, parseProbe, totalDuration, type Extras, type Input } from '../src/lib/compose';

const video = (name: string, duration: number, audio = true): Input => ({
  name,
  probe: { duration, video: { width: 1920, height: 1080, fps: 25 }, audio },
});
const none: Extras = { musicVolume: 0.1, fade: 1, loop: true, duck: true };
const graph = (args: string[]) => args[args.indexOf('-filter_complex') + 1];

describe('parseProbe', () => {
  it('reads the picture, the frame rate, the sound and the length', () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30000/1001' },
        { codec_type: 'audio' },
      ],
      format: { duration: '13.286621' },
    });
    const p = parseProbe(json);
    expect(p.video?.width).toBe(640);
    expect(p.video?.fps).toBeCloseTo(29.97, 2);
    expect(p).toMatchObject({ duration: 13.286621, audio: true });
  });

  it('takes a file with a cover image but no frame rate as a picture at 25 fps', () => {
    const p = parseProbe('{"streams":[{"codec_type":"video","width":500,"height":500,"avg_frame_rate":"0/0"}]}');
    expect(p.video?.fps).toBe(25);
  });

  it('reports a sound file as having no picture', () => {
    expect(parseProbe('{"streams":[{"codec_type":"audio"}],"format":{"duration":"5"}}')).toEqual({
      duration: 5,
      video: null,
      audio: true,
      audioStreams: 1,
    });
  });
});

describe('composeArgs', () => {
  const kept = [{ start: 0, end: 2 }, { start: 5, end: 6.5 }];

  it('trims each kept stretch from a constant-rate copy and fades its sound at both ends', () => {
    const args = composeArgs(video('talk.mp4', 10), kept, none, 'out.mp4');
    const g = graph(args);
    expect(args.filter((a) => a === '-i')).toHaveLength(1);
    expect(g).toContain('[0:v]fps=25,scale=1920:1080');
    expect(g).toContain(',split=2[tvs0][tvs1]');
    expect(g).toContain('[tvs1]trim=start=5.000:end=6.520,setpts=PTS-STARTPTS[tv1]');
    expect(g).toContain('[tas0]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st=1.995:d=0.005[ta0]');
    expect(g).toContain('[tv0][ta0][tv1][ta1]concat=n=2:v=1:a=1[outv][speech]');
    expect(args.filter((a, i) => args[i - 1] === '-map')).toEqual(['[outv]', '[speech]']);
  });

  it('cuts the picture and the sound on the same frame', () => {
    const g = graph(composeArgs(video('talk.mp4', 10), [{ start: 1.013, end: 2.031 }], none, 'out.mp4'));
    expect(g).toContain('trim=start=1.000:end=2.040');
    expect(g).toContain('atrim=start=1.000:end=2.040');
  });

  it('encodes at the chosen quality, with a keyframe every two seconds', () => {
    const args = composeArgs(video('talk.mp4', 10), kept, none, 'out.mp4', { preset: 'medium', crf: 18, audioBitrate: '320k' });
    expect(args.join(' ')).toContain('-preset medium -crf 18 -profile:v high -g 50 -bf 2 -map [speech] -c:a aac -b:a 320k');
  });

  it('puts the intro first and the outro last, at the talk picture size', () => {
    const intro: Input = { name: 'intro.mp4', probe: { duration: 3, video: { width: 320, height: 240, fps: 30 }, audio: true } };
    const args = composeArgs(video('talk.mp4', 10), kept, { ...none, intro, outro: video('outro.mp4', 2) }, 'out.mp4');
    const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
    expect(inputs).toEqual(['intro.mp4', 'talk.mp4', 'outro.mp4']);
    expect(graph(args)).toContain('[0:v]scale=1920:1080:force_original_aspect_ratio=decrease');
    expect(graph(args)).toContain('[introv][introa][tv0][ta0][tv1][ta1][outrov][outroa]concat=n=4');
  });

  it('fills a silent part with silence and a sound-only part with black', () => {
    const outro = video('outro.mp4', 2, false);
    const talk: Input = { name: 'talk.m4a', probe: { duration: 10, video: null, audio: true } };
    const g = graph(composeArgs(talk, kept, { ...none, outro }, 'out.mp4'));
    expect(g).toContain('anullsrc=r=48000:cl=stereo,atrim=duration=2.000[outroa]');
    expect(g).toContain('color=c=black:s=1920x1080:r=25:d=2.000,format=yuv420p,setsar=1[tv0]');
    expect(g).toContain('color=c=black:s=1920x1080:r=25:d=1.500,format=yuv420p,setsar=1[tv1]');
  });

  it('loops the music, fades it at both ends and lowers it under speech', () => {
    const music: Input = { name: 'music.mp3', probe: { duration: 4, video: null, audio: true } };
    const args = composeArgs(video('talk.mp4', 10), kept, { ...none, music, intro: video('intro.mp4', 1.5) }, 'out.mp4');
    expect(args[args.indexOf('music.mp3') - 3]).toBe('-stream_loop');
    const g = graph(args);
    expect(g).toContain('[2:a]atrim=duration=5.000');
    expect(g).toContain('afade=t=in:d=1.000,afade=t=out:st=4.000:d=1.000');
    expect(g).toContain('[music][speechkey]sidechaincompress');
    expect(g).toContain('[speechmix][ducked]amix=inputs=2:duration=first');
    expect(args[args.lastIndexOf('-map') + 1]).toBe('[outa]');
  });

  it('plays music once, ending where it ends, when it does not loop', () => {
    const music: Input = { name: 'music.mp3', probe: { duration: 2, video: null, audio: true } };
    const args = composeArgs(video('talk.mp4', 10), kept, { ...none, music, loop: false, duck: false }, 'out.mp4');
    expect(args).not.toContain('-stream_loop');
    expect(graph(args)).toContain('atrim=duration=2.000');
    expect(graph(args)).toContain('afade=t=out:st=1.000:d=1.000');
    expect(graph(args)).toContain('[speech][music]amix');
  });

  it('rounds an odd picture size down to even, which H.264 needs', () => {
    const odd: Input = { name: 'talk.mp4', probe: { duration: 10, video: { width: 853, height: 481, fps: 25 }, audio: true } };
    expect(graph(composeArgs(odd, kept, none, 'out.mp4'))).toContain('scale=852:480');
  });

  it('writes sound alone for a podcast, with no picture filter', () => {
    const args = composeArgs(video('talk.mp4', 10), kept, { ...none, intro: video('i.mp4', 2) }, 'out.mp3', {
      ...DEFAULT_ENCODING,
      audioOnly: true,
      audioCodec: 'libmp3lame',
    });
    const g = graph(args);
    expect(g).not.toMatch(/:v\]|color=|\btrim=start|[^a]setpts/);
    expect(g).toContain('[introa][ta0][ta1]concat=n=3:v=0:a=1[speech]');
    expect(args).not.toContain('[outv]');
    expect(args.join(' ')).toContain('-c:a libmp3lame');
    expect(args).not.toContain('+faststart');
  });

  it('mixes every sound track of a file, so a voice on its own track is kept', () => {
    const obs: Input = { name: 'obs.mkv', probe: { duration: 10, video: { width: 1920, height: 1080, fps: 30 }, audio: true, audioStreams: 2 } };
    expect(graph(composeArgs(obs, kept, none, 'out.mp4'))).toContain('[0:a:0][0:a:1]amix=inputs=2:duration=longest:normalize=0,aformat');
  });

  it('refuses an edit that keeps nothing', () => {
    expect(() => composeArgs(video('talk.mp4', 10), [], none, 'out.mp4')).toThrow('the edit keeps nothing');
  });
});

describe('composeGifArgs', () => {
  const kept = [{ start: 0, end: 2 }];

  it('keeps the talk shape at the chosen width, without sound, looping', () => {
    const args = composeGifArgs(video('talk.mp4', 10), kept, {}, { width: 480, fps: 12, limit: null }, 'out.gif');
    const g = graph(args);
    expect(g).toContain('scale=480:270:force_original_aspect_ratio=decrease');
    expect(g).toContain('concat=n=1:v=1:a=0[cat]');
    expect(g).toContain('palettegen');
    expect(args.slice(-3)).toEqual(['-loop', '0', 'out.gif']);
    expect(g).not.toContain(':a]');
  });

  it('stops at the limit and joins the intro and the outro', () => {
    const g = graph(
      composeGifArgs(video('talk.mp4', 10), kept, { intro: video('i.mp4', 2), outro: video('o.mp4', 1) }, { width: 320, fps: 10, limit: 5 }, 'out.gif'),
    );
    expect(g).toContain('[p0][p1][p2]concat=n=3:v=1:a=0,trim=duration=5.000[cat]');
  });
});

describe('totalDuration', () => {
  it('adds the intro, the kept talk and the outro', () => {
    expect(totalDuration([{ start: 1, end: 3 }], { intro: video('i', 2), outro: video('o', 1.5) })).toBe(5.5);
  });
});
