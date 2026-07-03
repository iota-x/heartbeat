// all sound is synthesized — no audio files. muted by default; enable() must
// be called from a user gesture so the AudioContext is allowed to start.
//
// sound design: everything is tuned to D major pentatonic over a slowly
// breathing drone, so chain-driven events always land consonant. slot closes
// walk a music-box arpeggio; whales are a deep sub swell plus a rising vocal
// "call" through a long shimmering reverb.

const ROOT = 73.42; // D2
// major pentatonic ratios relative to the root
const SCALE = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
// arpeggio walked by slot closes: [scale degree, octave above D4]
const PATTERN: [number, number][] = [
  [0, 0], [2, 0], [4, 0], [1, 1], [3, 0], [0, 1], [4, 0], [2, 0],
];

const degToFreq = (deg: number, octave: number) =>
  ROOT * 4 * SCALE[deg % SCALE.length] * 2 ** octave;

export class HeartbeatAudio {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null; // pre-compressor mix bus
  private wet: GainNode | null = null; // reverb send
  private droneGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private glimmerTimer: ReturnType<typeof setTimeout> | null = null;
  private step = 0;
  enabled = false;

  enable() {
    if (!this.ctx) this.build();
    void this.ctx!.resume();
    this.enabled = true;
    this.scheduleGlimmer();
  }

  disable() {
    this.enabled = false;
    if (this.glimmerTimer) {
      clearTimeout(this.glimmerTimer);
      this.glimmerTimer = null;
    }
    void this.ctx?.suspend();
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;

    // bus -> gentle compressor -> master -> speakers
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 18;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    this.bus = ctx.createGain();
    this.bus.connect(comp).connect(master).connect(ctx.destination);

    // shared noise buffer: thump snaps, whooshes, the drone "air" layer
    const nLen = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;

    // long stereo reverb from a synthesized impulse response
    const irLen = Math.floor(ctx.sampleRate * 3.5);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++)
        d[i] = (Math.random() * 2 - 1) * (1 - i / irLen) ** 2.6;
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.9;
    this.wet.connect(verb).connect(this.bus);

    this.buildDrone(ctx);
  }

  /** the ever-present bed: root + fifth breathing slowly, plus airy noise */
  private buildDrone(ctx: AudioContext) {
    const drone = ctx.createGain();
    drone.gain.value = 0.9;
    drone.connect(this.bus!);
    drone.connect(this.wet!);
    this.droneGain = drone;

    const voice = (freq: number, gain: number, lfoRate: number, lfoPhase: number) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const det = ctx.createOscillator();
      det.type = "sine";
      det.frequency.value = freq;
      det.detune.value = 4; // slow chorus beating against its twin
      const g = ctx.createGain();
      g.gain.value = gain;
      // sub-audio LFO makes the pad breathe instead of sitting static
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lg = ctx.createGain();
      lg.gain.value = gain * 0.45;
      lfo.connect(lg).connect(g.gain);
      const t = ctx.currentTime;
      osc.connect(g);
      det.connect(g);
      g.connect(drone);
      osc.start(t);
      det.start(t + lfoPhase); // desync the beating between voices
      lfo.start(t);
    };
    voice(ROOT, 0.055, 0.05, 0.13); // D2 root
    voice(ROOT * 1.5, 0.035, 0.037, 0.29); // A2 fifth
    voice(ROOT * 4, 0.012, 0.061, 0.41); // faint D4 halo

    // "air": bandpass noise drifting slowly between 300 and 900 Hz
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.Q.value = 1.4;
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.023;
    const sg = ctx.createGain();
    sg.gain.value = 300;
    sweep.connect(sg).connect(bp.frequency);
    const ag = ctx.createGain();
    ag.gain.value = 0.014;
    air.connect(bp).connect(ag);
    ag.connect(drone);
    ag.connect(this.wet!);
    air.start();
    sweep.start();
  }

  /** occasional long pad swell — keeps the bed evolving so ears don't tune out */
  private scheduleGlimmer() {
    if (this.glimmerTimer) return;
    const tick = () => {
      this.glimmerTimer = setTimeout(tick, 5_000 + Math.random() * 7_000);
      const ctx = this.ctx;
      if (!this.enabled || !ctx || !this.wet) return;
      const t = ctx.currentTime;
      const deg = Math.floor(Math.random() * SCALE.length);
      const oct = Math.random() < 0.35 ? 2 : 1;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.4 - 0.7;
      pan.connect(this.wet);
      for (const [f, g] of [
        [degToFreq(deg, oct), 0.05],
        [degToFreq(deg, oct) * 1.5, 0.028],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = f;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(g, t + 1.8);
        env.gain.exponentialRampToValueAtTime(0.001, t + 5.5);
        osc.connect(env).connect(pan);
        osc.start(t);
        osc.stop(t + 5.6);
      }
    };
    this.glimmerTimer = setTimeout(tick, 1_200);
  }

  /** deep swell + rising call + bell cluster for whale impacts; intensity 0..1 */
  thump(intensity: number) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.bus || !this.wet || !this.noise) return;
    const t = ctx.currentTime;

    // duck the drone so the whale owns the moment, then breathe back in
    if (this.droneGain) {
      this.droneGain.gain.cancelScheduledValues(t);
      this.droneGain.gain.setTargetAtTime(0.45, t, 0.06);
      this.droneGain.gain.setTargetAtTime(0.9, t + 0.5, 0.8);
    }

    // sub swell: felt more than heard
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(ROOT, t);
    sub.frequency.exponentialRampToValueAtTime(ROOT / 2.6, t + 1.1);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.4 + 0.35 * intensity, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    sub.connect(sg).connect(this.bus);
    sub.start(t);
    sub.stop(t + 1.5);

    // the "call": a vowel-ish tone gliding root -> fifth with growing vibrato
    const call = ctx.createOscillator();
    call.type = "sine";
    call.frequency.setValueAtTime(ROOT * 2, t);
    call.frequency.exponentialRampToValueAtTime(ROOT * 3, t + 0.9);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.5;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(6 + 8 * intensity, t + 0.9);
    vib.connect(vg).connect(call.frequency);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(0.10 + 0.10 * intensity, t + 0.25);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    const cpan = ctx.createStereoPanner();
    cpan.pan.value = Math.random() * 0.8 - 0.4;
    call.connect(cg).connect(cpan);
    cpan.connect(this.wet);
    cpan.connect(this.bus);
    call.start(t);
    call.stop(t + 1.9);
    vib.start(t);
    vib.stop(t + 1.9);

    // shimmering bell cluster fanning upward through the reverb
    const deg = Math.floor(Math.random() * SCALE.length);
    [0, 2, 4].forEach((off, i) => {
      const at = t + 0.08 + i * 0.09;
      this.chime(degToFreq(deg + off, 1 + (deg + off >= SCALE.length ? 1 : 0)),
        0.03 + 0.025 * intensity, at, (i - 1) * 0.5);
    });

    // airy whoosh rising with the call
    const whoosh = ctx.createBufferSource();
    whoosh.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(250, t);
    bp.frequency.exponentialRampToValueAtTime(1_800, t + 0.9);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0, t);
    wg.gain.linearRampToValueAtTime(0.05 + 0.09 * intensity, t + 0.3);
    wg.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    whoosh.connect(bp).connect(wg).connect(this.wet);
    whoosh.start(t);
    whoosh.stop(t + 1.2);
  }

  /** slot close — a soft pulse plus the next step of the music-box arpeggio */
  beat() {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.bus) return;
    const t = ctx.currentTime;

    // round sub pulse, barely there — the heartbeat itself
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(55, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g).connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.2);

    // the chain plays the melody: each slot advances the arpeggio one step
    const [deg, oct] = PATTERN[this.step % PATTERN.length];
    const accent = this.step % PATTERN.length === 0 ? 1.35 : 1;
    const pan = (this.step % 2 === 0 ? -1 : 1) * (0.25 + 0.2 * Math.random());
    this.step++;
    this.chime(degToFreq(deg, oct), 0.038 * accent, t, pan);
  }

  /** crystalline music-box voice: fundamental + soft octave partial, wet-heavy */
  private chime(freq: number, gain: number, at: number, pan: number) {
    const ctx = this.ctx;
    if (!ctx || !this.bus || !this.wet) return;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    const dry = ctx.createGain();
    dry.gain.value = 0.5;
    p.connect(this.wet);
    p.connect(dry).connect(this.bus);
    for (const [mult, g] of [
      [1, gain],
      [2.001, gain * 0.35], // hair of detune keeps the partial alive
      [3.5, gain * 0.12], // inharmonic partial = glassy, not organ-like
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * mult;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(g, at + 0.004);
      env.gain.exponentialRampToValueAtTime(0.001, at + 1.1);
      osc.connect(env).connect(p);
      osc.start(at);
      osc.stop(at + 1.2);
    }
  }
}
