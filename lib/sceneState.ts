// mutable state shared between the feed, the HUD, and the render loops.
// everything here is written imperatively at 60fps — no React state.

import type { FeedTx } from "./feed";

export interface SceneFx {
  /** fired by the whale pool the frame a whale hits the core */
  onWhaleImpact: (intensity: number, amountSol: number) => void;
}

export interface SceneShared {
  /** regular particles waiting to spawn */
  queue: FeedTx[];
  /** whales get their own pool and their own drama */
  whaleQueue: FeedTx[];
  /** core flash, 1 at slot close → decays */
  pulse: { value: number };
  /** inward pull on all particles at slot close → decays fast */
  collapse: { value: number };
  /** camera shake amount → decays */
  shake: { value: number };
  /** bumped once per slot close; the block chain watches it */
  eject: { count: number };
  /** written by the quality governor, read by the render loops */
  quality: { particleBudget: number };
  fx: SceneFx;
}

export const createShared = (): SceneShared => ({
  queue: [],
  whaleQueue: [],
  pulse: { value: 0 },
  collapse: { value: 0 },
  shake: { value: 0 },
  eject: { count: 0 },
  quality: { particleBudget: 4000 },
  fx: { onWhaleImpact: () => {} },
});
