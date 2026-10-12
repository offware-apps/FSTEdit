import { skipCut, type Range, type Word } from '../lib/cuts';
import { keptBefore, musicGain, speakingAt } from '../lib/preview';

export type Part = 'intro' | 'talk' | 'outro';

/** One file around the talk, ready to play: its length, whether it has sound, a URL the browser plays. */
export type Clip = { url: string; duration: number; sound: boolean };

export type PlayerSource = {
  kept(): Range[];
  cuts(): Range[];
  words(): Word[];
  intro(): Clip | null;
  outro(): Clip | null;
  music(): Clip | null;
  musicSettings(): { musicVolume: number; fade: number; loop: boolean; duck: boolean };
};

/**
 * Plays the finished edit before it is rendered: the intro, the talk with its
 * cuts skipped, the outro, and the music under all of it.
 */
export class Player {
  readonly intro = document.createElement('video');
  readonly outro = document.createElement('video');
  readonly music = document.createElement('audio');
  part: Part | null = null;
  playing = false;
  private timer = 0;
  private musicTimer = 0;
  private check = () => {};
  showPicture = true;
  /** Playback speed, which J, K and L change. */
  rate = 1;

  constructor(
    readonly talk: HTMLVideoElement,
    private source: PlayerSource,
    private onChange: () => void,
  ) {
    for (const v of [this.outro, this.intro]) {
      v.preload = 'auto';
      v.playsInline = true;
      v.hidden = true;
      talk.after(v);
    }
    this.music.preload = 'auto';
    this.intro.addEventListener('ended', () => this.playing && this.part === 'intro' && this.startTalk(0));
    this.outro.addEventListener('ended', () => this.playing && this.part === 'outro' && this.stop());
    talk.addEventListener('timeupdate', () => {
      this.check();
      this.onChange();
    });
    for (const v of [this.intro, this.outro]) v.addEventListener('timeupdate', () => this.onChange());
  }

  /** Points an element at `url`, leaving it alone when it already plays that. */
  static setSource(el: HTMLMediaElement, url: string | null) {
    if ((el.getAttribute('src') ?? null) === url) return;
    if (url) el.src = url;
    else {
      el.removeAttribute('src');
      el.load();
    }
  }

  sync() {
    Player.setSource(this.intro, this.source.intro()?.url ?? null);
    Player.setSource(this.outro, this.source.outro()?.url ?? null);
    Player.setSource(this.music, this.source.music()?.url ?? null);
  }

  show(p: Part) {
    this.talk.hidden = !this.showPicture || p !== 'talk';
    this.intro.hidden = !this.showPicture || p !== 'intro';
    this.outro.hidden = !this.showPicture || p !== 'outro';
  }

  /** The finished video's length: intro, kept talk, outro. */
  total(): number {
    return (this.source.intro()?.duration ?? 0) + keptBefore(Infinity, this.source.kept()) + (this.source.outro()?.duration ?? 0);
  }

  /** Seconds into the finished video at this moment. */
  editTime(): number {
    const intro = this.source.intro()?.duration ?? 0;
    const kept = this.source.kept();
    if (this.part === 'intro') return this.intro.currentTime;
    if (this.part === 'outro') return intro + keptBefore(Infinity, kept) + this.outro.currentTime;
    return intro + keptBefore(this.talk.currentTime, kept);
  }

  private updateMusic() {
    const m = this.source.music();
    if (!m || !this.playing) return;
    const s = this.source.musicSettings();
    const total = this.total();
    const speaking =
      this.part === 'talk'
        ? speakingAt(this.talk.currentTime, this.source.words())
        : !!(this.part === 'intro' ? this.source.intro() : this.source.outro())?.sound;
    this.music.volume = musicGain({
      at: this.editTime(),
      heardUntil: s.loop ? total : Math.min(total, m.duration),
      volume: s.musicVolume,
      fade: s.fade,
      duck: s.duck,
      speaking,
    });
  }

  private startMusic() {
    const m = this.source.music();
    if (!m) return;
    const at = this.editTime();
    this.music.loop = this.source.musicSettings().loop;
    if (!this.music.loop && at >= m.duration) return;
    this.music.currentTime = this.music.loop ? at % m.duration : at;
    this.music.volume = 0;
    void this.music.play().catch(() => {});
    clearInterval(this.musicTimer);
    this.musicTimer = window.setInterval(() => this.updateMusic(), 100);
    this.updateMusic();
  }

  // a timer set to the next cut, since animation frames stop while the page is not drawn
  private startTalk(from: number) {
    this.part = 'talk';
    this.show('talk');
    const cuts = this.source.cuts();
    const end = this.source.kept().at(-1)?.end ?? this.talk.duration;
    // a seek takes a moment to land, so a cut is jumped a few milliseconds before it starts
    const AHEAD = 0.015;
    this.check = () => {
      if (!this.playing || this.part !== 'talk') return;
      const t = this.talk.currentTime;
      const landing = skipCut(t + AHEAD, cuts);
      const next = landing === t + AHEAD ? t : landing;
      if (next !== t) this.talk.currentTime = next;
      if (next >= end || this.talk.ended) return this.endTalk();
      const boundary = Math.min(end, ...cuts.filter((r) => r.start > next).map((r) => r.start));
      clearTimeout(this.timer);
      this.timer = window.setTimeout(this.check, ((boundary - next) * 1000) / this.talk.playbackRate);
    };
    this.talk.currentTime = skipCut(from, cuts);
    this.talk.playbackRate = this.rate;
    void this.talk.play().then(this.check, () => this.stop());
    // where the browser reports each frame, the check runs on every one; elsewhere the timer above covers it
    const v = this.talk as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const onFrame = () => {
      if (!this.playing || this.part !== 'talk') return;
      this.check();
      v.requestVideoFrameCallback?.(onFrame);
    };
    v.requestVideoFrameCallback?.(onFrame);
  }

  private endTalk() {
    clearTimeout(this.timer);
    this.talk.pause();
    if (this.source.outro()) {
      this.part = 'outro';
      this.show('outro');
      this.outro.currentTime = 0;
      void this.outro.play().catch(() => this.stop());
    } else this.stop();
  }

  /** Plays the finished video from `from` seconds of the talk; from 0, the intro comes first. */
  play(from = 0) {
    this.stop();
    this.playing = true;
    for (const el of [this.talk, this.intro, this.outro, this.music]) el.playbackRate = this.rate;
    if (from === 0 && this.source.intro()) {
      this.part = 'intro';
      this.show('intro');
      this.intro.currentTime = 0;
      void this.intro.play().catch(() => this.stop());
    } else this.startTalk(from);
    this.startMusic();
    this.onChange();
  }

  stop() {
    const was = this.playing;
    this.playing = false;
    clearTimeout(this.timer);
    clearInterval(this.musicTimer);
    for (const el of [this.talk, this.intro, this.outro, this.music]) el.pause();
    this.part = null;
    this.show('talk');
    if (was) this.onChange();
  }
}
