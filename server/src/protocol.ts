// wire protocol between the ingest service and browser clients.
// the client keeps its own defensive decoder in lib/protocol.ts — if you
// change anything here, change it there too.
//
// design rule: a few KB per slot max. votes are never sent individually,
// only counted; individual entries exist only for the interesting minority,
// sampled under load, whales always included.

/** kind indices — keep in sync with lib/protocol.ts */
export const KIND_INDEX = {
  vote: 0,
  transfer: 1,
  swap: 2,
  nft: 3,
  other: 4,
} as const;

export type TxKind = keyof typeof KIND_INDEX;

/** upstream health as the client should understand it */
export type FeedStatus =
  | "connecting" // upstream not yet delivering
  | "live" // full blocks flowing
  | "slots" // slot ticks only (RPC refused blockSubscribe) — degraded
  | "down"; // upstream lost, reconnecting

/** [kindIndex, lamports, whale(0|1)] — never kind 0 (votes) */
export type WireTx = [number, number, 0 | 1];

export interface SlotMsg {
  t: "s";
  /** slot number */
  s: number;
  /** counts per kind, indexed by KIND_INDEX: [vote, transfer, swap, nft, other] */
  c: [number, number, number, number, number];
  /** total SOL moved this slot, in lamports (max positive balance delta per tx) */
  vol: number;
  /** total fees paid this slot, in lamports */
  fee: number;
  /** sampled individual transactions (whales always present) */
  x: WireTx[];
  /** 1 when this is a slots-only tick with no block data */
  p?: 1;
}

export interface HelloMsg {
  t: "h";
  status: FeedStatus;
  /** last slot seen, 0 if none yet */
  slot: number;
  /** whale threshold in lamports, so the client can annotate */
  whaleLamports: number;
}

export interface StatusMsg {
  t: "st";
  status: FeedStatus;
}

export type ServerMsg = SlotMsg | HelloMsg | StatusMsg;
