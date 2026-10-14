// Procedural sound effects and a light tarantella-style music loop (WebAudio, no assets).
type Sfx = 'cash' | 'ding' | 'levelup' | 'error' | 'click' | 'door' | 'goal' | 'open' | 'close';

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  musicGain: GainNode | null = null;
  enabled = true;
  musicOn = false;
  volume = 0.6;
  private last: Record<string, number> = {};
  private musicTimer: number | null = null;
  private nextNote = 0;
  private step = 0;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.18;
      this.musicGain.connect(this.master);
      if (this.musicOn) this.startMusic();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, dest?: AudioNode, glide?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    g.connect(dest ?? this.master!);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  play(name: Sfx) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const gap = name === 'cash' ? 0.22 : 0.08;
    if ((this.last[name] ?? -1) > now - gap) return;
    this.last[name] = now;
    switch (name) {
      case 'cash':
        this.tone(1568, now, 0.09, 'square', 0.05);
        this.tone(2093, now + 0.07, 0.22, 'square', 0.045);
        break;
      case 'ding':
        this.tone(1318, now, 0.5, 'sine', 0.12);
        this.tone(2637, now, 0.3, 'sine', 0.03);
        break;
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, now + i * 0.09, 0.3, 'triangle', 0.12));
        break;
      case 'goal':
        [784, 988, 1175].forEach((f, i) => this.tone(f, now + i * 0.07, 0.25, 'triangle', 0.1));
        break;
      case 'error':
        this.tone(180, now, 0.18, 'sawtooth', 0.06, undefined, 120);
        break;
      case 'click':
        this.tone(900, now, 0.04, 'triangle', 0.05);
        break;
      case 'door':
        this.tone(880, now, 0.25, 'sine', 0.05);
        this.tone(660, now + 0.12, 0.3, 'sine', 0.05);
        break;
      case 'open':
        [392, 523, 659].forEach((f, i) => this.tone(f, now + i * 0.11, 0.35, 'triangle', 0.1));
        break;
      case 'close':
        [659, 523, 392].forEach((f, i) => this.tone(f, now + i * 0.13, 0.4, 'triangle', 0.08));
        break;
    }
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  // A minor tarantella feel: Am - Dm - E - Am arpeggios in 6/8.
  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.step = 0;
    const chords = [
      [220, 261.6, 329.6],
      [146.8, 220, 293.7],
      [164.8, 207.7, 246.9],
      [220, 261.6, 329.6],
    ];
    const pattern = [0, 1, 2, 1, 2, 1];
    const tick = () => {
      if (!this.ctx || !this.musicGain) return;
      while (this.nextNote < this.ctx.currentTime + 0.25) {
        const bar = Math.floor(this.step / 12) % 4;
        const ch = chords[bar];
        const i = this.step % 6;
        const octave = this.step % 12 >= 6 ? 2 : 1;
        this.tone(ch[pattern[i]] * octave, this.nextNote, 0.16, 'triangle', 0.25, this.musicGain);
        if (i === 0) this.tone(ch[0] / 2, this.nextNote, 0.5, 'sine', 0.3, this.musicGain);
        this.nextNote += 0.15;
        this.step++;
      }
    };
    this.musicTimer = window.setInterval(tick, 60);
  }
  private stopMusic() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const audio = new AudioEngine();
