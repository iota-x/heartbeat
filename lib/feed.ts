// synthetic transaction feed — originally the milestone-1 stand-in, now the
// permanent fallback: the deployed site must never be a black screen because
// infra is down. the live feed (lib/feedSource.ts) speaks this exact
// interface, so the scene never knows which one is running.

export type TxKind = "vote" | "transfer" | "swap" | "nft" | "other";

export interface FeedTx {
  kind: TxKind;
  /** relative visual weight — whales land much heavier than dust */
  weight: number;
  /** set on transfers/swaps above the whale threshold — dramatized by the scene */
  whale?: boolean;
  /** SOL moved, when known (live feed always knows, synthetic approximates) */
  amountSol?: number;
}

export interface SlotSummary {
  slot: number;
  txCount: number;
  /** total fees paid in the slot, lamports — HUD derives priority-fee level */
  feeLamports?: number;
  /** total SOL moved in the slot */
  volumeSol?: number;
}

// rough mainnet-ish mix: validator votes dominate, whales are rare
const MIX: [TxKind, number][] = [
  ["vote", 0.7],
  ["transfer", 0.12],
  ["swap", 0.12],
  ["nft", 0.03],
  ["other", 0.03],
];

const pickKind = (): TxKind => {
  let r = Math.random();
  for (const [kind, p] of MIX) {
    if ((r -= p) <= 0) return kind;
  }
  return "other";
};

/**
 * Emits ~`tps` transactions per second (batched on a coarse timer) and a
 * slot summary every ~400ms, mirroring Solana's blocktime. Returns a stop
 * function. `emitSlots: false` lets a caller drive slot cadence from real
 * mainnet ticks while this feed only supplies particles.
 */
export const startSyntheticFeed = ({
  tps = 900,
  startSlot = 250_000_000,
  emitSlots = true,
  onTx,
  onSlot,
}: {
  tps?: number;
  startSlot?: number;
  emitSlots?: boolean;
  onTx: (tx: FeedTx) => void;
  onSlot?: (s: SlotSummary) => void;
}) => {
  let slot = startSlot;
  let txInSlot = 0;
  let feeInSlot = 0;
  let volInSlot = 0;
  let carry = 0;
  let last = performance.now();

  const txTimer = setInterval(() => {
    const now = performance.now();
    carry += ((now - last) / 1000) * tps;
    last = now;
    while (carry >= 1) {
      carry -= 1;
      txInSlot++;
      const kind = pickKind();
      const whale = kind !== "vote" && Math.random() < 0.008;
      const weight = kind === "vote" ? 0.35 : whale ? 6 : 0.8 + Math.random();
      const amountSol =
        kind === "vote"
          ? 0
          : whale
            ? 1_000 + Math.random() * 20_000
            : Math.random() * 40;
      feeInSlot += kind === "vote" ? 5000 : 5000 + Math.random() * 40_000;
      volInSlot += amountSol;
      onTx(whale ? { kind, weight, whale, amountSol } : { kind, weight, amountSol });
    }
  }, 50);

  const slotTimer = emitSlots
    ? setInterval(() => {
        onSlot?.({
          slot: slot++,
          txCount: txInSlot,
          feeLamports: feeInSlot,
          volumeSol: volInSlot,
        });
        txInSlot = 0;
        feeInSlot = 0;
        volInSlot = 0;
      }, 400)
    : null;

  return () => {
    clearInterval(txTimer);
    if (slotTimer) clearInterval(slotTimer);
  };
};
