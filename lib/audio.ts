// all sound is synthesized — no audio files. muted by default; enable() must
// be called from a user gesture so the AudioContext is allowed to start.

export class HeartbeatAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = false;

  enable() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // one shared noise buffer, reused by every thump attack
      const len = Math.floor(this.ctx.sampleRate * 0.25);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    void this.ctx?.suspend();
  }

  /** deep sub-bass thump for whale impacts; intensity 0..1 */
  thump(intensity: number) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(72, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55 + 0.35 * intensity, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.85);

    // low-passed noise snap gives the attack some body
    const snap = ctx.createBufferSource();
    snap.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400 + 1200 * intensity;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08 + 0.18 * intensity, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    snap.connect(lp);
    lp.connect(ng);
    ng.connect(this.master);
    snap.start(t);
  }

  /** the heartbeat itself — a barely-there pulse on every slot close */
  beat() {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(55, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }
}
