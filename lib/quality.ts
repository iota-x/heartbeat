// adaptive quality: measure real fps after load, degrade in steps, never
// oscillate back up. each step trades the least-visible thing first.

export interface QualityTier {
  particleBudget: number;
  bloom: boolean;
  dpr: number;
}

export const TIERS: QualityTier[] = [
  { particleBudget: 4000, bloom: true, dpr: 1.5 },
  { particleBudget: 2500, bloom: true, dpr: 1.25 },
  { particleBudget: 1500, bloom: false, dpr: 1 },
];

export const WARMUP_S = 6; // let shaders compile & caches warm before judging
export const WINDOW_S = 2; // evaluation window
export const MIN_FPS = 48; // below this for a full window → step down
