// all sound is synthesized — no audio files. muted by default; enable() must
// be called from a user gesture so the AudioContext is allowed to start.
//
// sound design: everything is tuned to D major pentatonic over a slowly
// breathing drone, so chain-driven events always land consonant. slot closes
// walk a music-box arpeggio; whales are a deep sub swell plus a rising vocal
// "call" through a long shimmering reverb. the bed follows the network: TPS
// opens the air/halo layers and densifies the sparkle, and every couple of
// minutes the drone drifts to a related chord center so long sessions never
// go stale.

const ROOT = 73.42; // D2
// major pentatonic ratios relative to the root
const SCALE = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
// arpeggio walked by slot closes: [scale degree, octave above D4]
const PATTERN: [number, number][] = [
  [0, 0], [2, 0], [4, 0], [1, 1], [3, 0], [0, 1], [4, 0], [2, 0],
];
// chord centers the drone drifts between — D, B below, G above. the melody
// pool stays on D pentatonic, which is consonant over all three (D major,
// Bm11, Gmaj9).
const CENTERS = [1, 2 ** (-3 / 12), 2 ** (5 / 12)];

const degToFreq = (deg: number, octave: number) =>
  ROOT * 4 * SCALE[deg % SCALE.length] * 2 ** octave;

interface DroneVoice {
  osc: OscillatorNode;
  det: OscillatorNode;
  mult: number; // frequency relative to the current chord center root
}

export class HeartbeatAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null; // pre-compressor mix bus
  private wet: GainNode | null = null; // reverb send
  private droneGain: GainNode | null = null;
  private droneVoices: DroneVoice[] = [];
  private airGain: GainNode | null = null;
  private airFilter: BiquadFilterNode | null = null;
  private haloGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timers: Partial<Record<"glimmer" | "sparkle" | "drift", ReturnType<typeof setTimeout>>> = {};
  private step = 0;
  private center = 1; // current chord center multiplier
  private activity = 0.3; // smoothed 0..1 network load
  private volume = 0.5;
  enabled = false;

  enable() {
    if (!this.ctx) this.build();
    void this.ctx!.resume();
    this.enabled = true;
    this.scheduleGlimmer();
    this.scheduleSparkle();
    this.scheduleDrift();
  }

  disable() {
    this.enabled = false;
    for (const t of Object.values(this.timers)) clearTimeout(t);
    this.timers = {};
    void this.ctx?.suspend();
  }

  /** run `tick` in a self-rescheduling loop; no-op if already running */
  private loop(key: keyof typeof this.timers, delay: () => number, tick: () => void) {
    if (this.timers[key]) return;
    const run = () => {
      this.timers[key] = setTimeout(run, delay());
      if (this.enabled && this.ctx) tick();
    };
    this.timers[key] = setTimeout(run, delay());
  }

  /** master volume 0..1; safe to call while muted or before first enable() */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  /**
   * network load 0..1 — opens the air/halo layers, densifies sparkle and
   * glimmers, and lets the arpeggio double up. call as often as you like;
   * it is smoothed internally.
   */
  setActivity(a: number) {
    this.activity += (Math.max(0, Math.min(1, a)) - this.activity) * 0.15;
    const ctx = this.ctx;
    if (!ctx || !this.airGain || !this.haloGain || !this.airFilter) return;
    const t = ctx.currentTime;
    this.airGain.gain.setTargetAtTime(0.008 + 0.016 * this.activity, t, 1.5);
    this.haloGain.gain.setTargetAtTime(0.005 + 0.016 * this.activity, t, 1.5);
    this.airFilter.frequency.setTargetAtTime(450 + 650 * this.activity, t, 2);
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
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.bus = ctx.createGain();
    this.bus.connect(comp).connect(this.master).connect(ctx.destination);

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

    const voice = (mult: number, gain: number, lfoRate: number, lfoPhase: number) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = ROOT * mult;
      const det = ctx.createOscillator();
      det.type = "sine";
      det.frequency.value = ROOT * mult;
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
      this.droneVoices.push({ osc, det, mult });
      return g;
    };
    voice(1, 0.055, 0.05, 0.13); // root
    voice(1.5, 0.035, 0.037, 0.29); // fifth
    this.haloGain = voice(4, 0.01, 0.061, 0.41); // faint upper halo

    // "air": bandpass noise drifting slowly between 300 and 900 Hz
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.Q.value = 1.4;
    this.airFilter = bp;
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.023;
    const sg = ctx.createGain();
    sg.gain.value = 300;
    sweep.connect(sg).connect(bp.frequency);
    const ag = ctx.createGain();
    ag.gain.value = 0.014;
    this.airGain = ag;
    air.connect(bp).connect(ag);
    ag.connect(drone);
    ag.connect(this.wet!);
    air.start();
    sweep.start();
  }

  /** every ~2 min the bed migrates to a related chord center over ~12s */
  private scheduleDrift() {
    this.loop("drift", () => 90_000 + Math.random() * 60_000, () => {
      const ctx = this.ctx!;
      const next = CENTERS.filter((c) => c !== this.center)[
        Math.floor(Math.random() * (CENTERS.length - 1))
      ];
      this.center = next;
      const t = ctx.currentTime;
      for (const v of this.droneVoices) {
        const f = ROOT * next * v.mult;
        v.osc.frequency.setTargetAtTime(f, t, 4);
        v.det.frequency.setTargetAtTime(f, t, 4);
      }
    });
  }

  /** occasional long pad swell — keeps the bed evolving so ears don't tune out */
  private scheduleGlimmer() {
    // busier network -> glimmers come noticeably closer together
    this.loop("glimmer", () => 4_000 + (1 - this.activity) * 8_000 + Math.random() * 4_000, () => {
      const ctx = this.ctx!;
      const t = ctx.currentTime;
      const deg = Math.floor(Math.random() * SCALE.length);
      const oct = Math.random() < 0.35 ? 2 : 1;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.4 - 0.7;
      pan.connect(this.wet!);
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
    });
  }

  /** dust: a continuous rain of tiny grains whose density tracks the tx flow */
  private scheduleSparkle() {
    // 0.5 grains/s when idle, up to 8/s when the chain runs hot
    this.loop("sparkle", () => (1_000 / (0.5 + 7.5 * this.activity)) * (0.5 + Math.random()), () => {
      const ctx = this.ctx!;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value =
        degToFreq(Math.floor(Math.random() * SCALE.length), 2) *
        (Math.random() < 0.3 ? 2 : 1);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.004 + Math.random() * 0.007, t + 0.005);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + Math.random() * 0.1);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.8 - 0.9;
      osc.connect(env).connect(pan).connect(this.wet!);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  /**
   * whale impact: deep swell + call + bell cluster. intensity 0..1 sets the
   * punch; amountSol sets the character — bigger whales call lower, longer,
   * with more bells.
   */
  thump(intensity: number, amountSol = 0) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.bus || !this.wet || !this.noise) return;
    const t = ctx.currentTime;
    // 10 SOL ≈ 0.3, 1k SOL ≈ 0.86, 3k+ SOL = 1
    const size = Math.min(1, Math.log10(Math.max(10, amountSol)) / 3.5);
    const root = ROOT * this.center;

    // duck the drone so the whale owns the moment, then breathe back in
    if (this.droneGain) {
      this.droneGain.gain.cancelScheduledValues(t);
      this.droneGain.gain.setTargetAtTime(0.45 - 0.15 * size, t, 0.06);
      this.droneGain.gain.setTargetAtTime(0.9, t + 0.5 + 0.8 * size, 0.8);
    }

    // sub swell: felt more than heard; giants linger
    const subDur = 1.1 + 1.1 * size;
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(root, t);
    sub.frequency.exponentialRampToValueAtTime(root / 2.6, t + subDur * 0.8);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.4 + 0.35 * intensity, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.001, t + subDur + 0.3);
    sub.connect(sg).connect(this.bus);
    sub.start(t);
    sub.stop(t + subDur + 0.4);

    // the "call": glides up a fifth with growing vibrato. big whales start an
    // octave down and stretch out — slower, deeper, more animal.
    const callDur = 0.9 + 1.3 * size;
    const callF = (root * 2) / (1 + size);
    const call = ctx.createOscillator();
    call.type = "sine";
    call.frequency.setValueAtTime(callF, t);
    call.frequency.exponentialRampToValueAtTime(callF * 1.5, t + callDur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.5 - 1.5 * size;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(6 + 8 * intensity, t + callDur);
    vib.connect(vg).connect(call.frequency);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(0.10 + 0.10 * intensity + 0.05 * size, t + 0.25);
    cg.gain.exponentialRampToValueAtTime(0.001, t + callDur + 0.9);
    const cpan = ctx.createStereoPanner();
    cpan.pan.value = Math.random() * 0.8 - 0.4;
    call.connect(cg).connect(cpan);
    cpan.connect(this.wet);
    cpan.connect(this.bus);
    call.start(t);
    call.stop(t + callDur + 1);
    vib.start(t);
    vib.stop(t + callDur + 1);

    // shimmering bell cluster fanning upward through the reverb
    const deg = Math.floor(Math.random() * SCALE.length);
    const bells = 3 + Math.round(2 * size);
    for (let i = 0; i < bells; i++) {
      const off = i * 2;
      const at = t + 0.08 + i * 0.09;
      this.chime(degToFreq(deg + off, 1 + Math.floor((deg + off) / SCALE.length)),
        0.03 + 0.025 * intensity, at, (i - (bells - 1) / 2) * 0.4);
    }

    // airy whoosh rising with the call
    const whoosh = ctx.createBufferSource();
    whoosh.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(250, t);
    bp.frequency.exponentialRampToValueAtTime(1_800 - 600 * size, t + callDur);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0, t);
    wg.gain.linearRampToValueAtTime(0.05 + 0.09 * intensity, t + 0.3);
    wg.gain.exponentialRampToValueAtTime(0.001, t + callDur + 0.2);
    whoosh.connect(bp).connect(wg).connect(this.wet);
    whoosh.start(t);
    whoosh.stop(t + callDur + 0.3);
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

    // under load the melody doubles up: an off-beat echo one step higher
    if (Math.random() < this.activity * 0.45) {
      this.chime(degToFreq(deg + 1, oct), 0.02, t + 0.2, -pan);
    }
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
