// synthetic transaction feed — the milestone-1 stand-in for the real ingest
// service. it produces a realistic mix at a realistic rate so the visual can
// be built and tuned before any RPC work happens. the real feed will speak
// the same interface, so swapping it in later touches nothing in the scene.

export type TxKind = "vote" | "transfer" | "swap" | "nft" | "other";

export interface FeedTx {
  kind: TxKind;
  /** relative visual weight — whales land much heavier than dust */
  weight: number;
}

export interface SlotSummary {
  slot: number;
  txCount: number;
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
 * function.
 */
export const startSyntheticFeed = ({
  tps = 900,
  onTx,
  onSlot,
}: {
  tps?: number;
  onTx: (tx: FeedTx) => void;
  onSlot: (s: SlotSummary) => void;
}) => {
  let slot = 250_000_000;
  let txInSlot = 0;
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
      const weight =
        kind === "vote" ? 0.35 : Math.random() < 0.008 ? 6 : 0.8 + Math.random();
      onTx({ kind, weight });
    }
  }, 50);

  const slotTimer = setInterval(() => {
    onSlot({ slot: slot++, txCount: txInSlot });
    txInSlot = 0;
  }, 400);

  return () => {
    clearInterval(txTimer);
    clearInterval(slotTimer);
  };
};
