// client-side decoder for the ingest wire protocol.
// keep in sync with server/src/protocol.ts — but never trust the wire:
// every accessor here is defensive, a malformed message decodes to null.

export const KINDS = ["vote", "transfer", "swap", "nft", "other"] as const;

export type FeedStatus = "connecting" | "live" | "slots" | "down";

export interface WireSlot {
  slot: number;
  /** counts by kind, same order as KINDS */
  counts: [number, number, number, number, number];
  volumeLamports: number;
  feeLamports: number;
  /** [kindIndex, lamports, whale] tuples, never votes */
  txs: [number, number, 0 | 1][];
  /** true when this is a slots-only tick without block data */
  partial: boolean;
}

export interface WireHello {
  status: FeedStatus;
  slot: number;
  whaleLamports: number;
}

export type Decoded =
  | { t: "slot"; slot: WireSlot }
  | { t: "hello"; hello: WireHello }
  | { t: "status"; status: FeedStatus };

const STATUSES: FeedStatus[] = ["connecting", "live", "slots", "down"];

const isCountTuple = (v: unknown): v is WireSlot["counts"] =>
  Array.isArray(v) && v.length === 5 && v.every((n) => typeof n === "number");

export const decode = (raw: string): Decoded | null => {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;

  if (msg.t === "s") {
    if (typeof msg.s !== "number" || !isCountTuple(msg.c)) return null;
    const txs: WireSlot["txs"] = [];
    if (Array.isArray(msg.x)) {
      for (const e of msg.x) {
        if (
          Array.isArray(e) &&
          typeof e[0] === "number" &&
          e[0] >= 1 &&
          e[0] <= 4 &&
          typeof e[1] === "number"
        ) {
          txs.push([e[0], e[1], e[2] === 1 ? 1 : 0]);
        }
      }
    }
    return {
      t: "slot",
      slot: {
        slot: msg.s,
        counts: msg.c,
        volumeLamports: typeof msg.vol === "number" ? msg.vol : 0,
        feeLamports: typeof msg.fee === "number" ? msg.fee : 0,
        txs,
        partial: msg.p === 1,
      },
    };
  }

  if (msg.t === "h") {
    const status = STATUSES.includes(msg.status as FeedStatus)
      ? (msg.status as FeedStatus)
      : "connecting";
    return {
      t: "hello",
      hello: {
        status,
        slot: typeof msg.slot === "number" ? msg.slot : 0,
        whaleLamports:
          typeof msg.whaleLamports === "number" ? msg.whaleLamports : 1e12,
      },
    };
  }

  if (msg.t === "st" && STATUSES.includes(msg.status as FeedStatus)) {
    return { t: "status", status: msg.status as FeedStatus };
  }

  return null;
};
