/**
 * Lightweight sound effects via Web Audio API (no external files).
 */
export class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    this.init();
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  _tone(freq, duration, type = "sine", gain = 0.3, when = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  _noise(duration, gain = 0.15, when = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + when;
    const len = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 800;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  /** Cannon fire when a correct letter is typed */
  shoot() {
    this._noise(0.08, 0.12);
    this._tone(180, 0.1, "square", 0.12);
    this._tone(90, 0.15, "sawtooth", 0.08);
  }

  /** Letter impact on word */
  hit() {
    this._tone(520, 0.06, "sine", 0.15);
    this._tone(780, 0.05, "triangle", 0.1, 0.02);
  }

  /** Word fully destroyed */
  destroy() {
    this._noise(0.25, 0.2);
    this._tone(220, 0.2, "sawtooth", 0.15);
    this._tone(440, 0.18, "square", 0.12, 0.05);
    this._tone(880, 0.25, "sine", 0.1, 0.1);
    this._tone(1100, 0.3, "triangle", 0.08, 0.15);
  }

  /** Wrong key */
  miss() {
    this._tone(140, 0.18, "sawtooth", 0.18);
    this._tone(90, 0.22, "square", 0.12, 0.04);
  }

  /** Enemy laser hit on player */
  enemyShot() {
    this._noise(0.1, 0.14);
    this._tone(220, 0.08, "square", 0.14);
    this._tone(90, 0.16, "sawtooth", 0.12, 0.03);
  }

  /** Combo milestone (×2 / ×3) */
  comboUp() {
    this._tone(523, 0.1, "sine", 0.15);
    this._tone(659, 0.1, "sine", 0.15, 0.08);
    this._tone(784, 0.15, "sine", 0.18, 0.16);
    this._tone(1047, 0.2, "triangle", 0.12, 0.24);
  }

  /** Game start */
  start() {
    this._tone(330, 0.12, "square", 0.12);
    this._tone(440, 0.12, "square", 0.12, 0.1);
    this._tone(554, 0.2, "sine", 0.15, 0.2);
  }

  /** Game over fanfare */
  gameOver() {
    this._tone(392, 0.2, "sine", 0.15);
    this._tone(349, 0.2, "sine", 0.15, 0.18);
    this._tone(294, 0.35, "triangle", 0.18, 0.36);
  }

  /** Soft campfire crackle (ambient loop tick) */
  crackle() {
    if (Math.random() > 0.4) return;
    this._noise(0.04 + Math.random() * 0.06, 0.02 + Math.random() * 0.03);
  }

  /** Boss warning siren */
  warning() {
    this._tone(440, 0.25, "sawtooth", 0.18);
    this._tone(370, 0.25, "sawtooth", 0.18, 0.22);
    this._tone(440, 0.25, "sawtooth", 0.18, 0.44);
    this._tone(330, 0.35, "square", 0.14, 0.66);
  }

  /** Boss appears */
  boss() {
    this._tone(110, 0.3, "sawtooth", 0.2);
    this._tone(146, 0.3, "square", 0.15, 0.15);
    this._tone(185, 0.4, "sawtooth", 0.18, 0.3);
    this._noise(0.35, 0.12, 0.1);
  }

  /** Boss defeated */
  bossDown() {
    this._tone(523, 0.15, "sine", 0.16);
    this._tone(659, 0.15, "sine", 0.16, 0.12);
    this._tone(784, 0.15, "sine", 0.16, 0.24);
    this._tone(1047, 0.35, "triangle", 0.2, 0.36);
    this._noise(0.3, 0.15, 0.2);
  }
}
