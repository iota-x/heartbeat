// the one feed the scene talks to.
//
// NEXT_PUBLIC_FEED_URL set → live websocket to the ingest service, adapted
// into the FeedTx/SlotSummary interface. unset, unreachable, or degraded →
// the synthetic feed takes over automatically; the scene never sees a gap.
//
// three modes surface in the HUD:
//   live      — full mainnet blocks
//   hybrid    — real slot ticks, synthetic particles (RPC refused blocks)
//   synthetic — everything local

import { startSyntheticFeed, type FeedTx, type SlotSummary } from "./feed";
import { decode, KINDS, type WireSlot } from "./protocol";

export type FeedMode = "live" | "hybrid" | "synthetic";

export interface FeedState {
  mode: FeedMode;
  /** short HUD line, lowercase */
  label: string;
}

export interface FeedHandlers {
  onTx: (tx: FeedTx) => void;
  onSlot: (s: SlotSummary) => void;
  onState: (s: FeedState) => void;
}

const DRIP_MS = 40; // spread each slot's particles across the slot
const MAX_DUST_PER_SLOT = 500; // votes rendered as ambient dust, sampled
const WATCHDOG_MS = 6_000; // slots arrive every 400ms; this is very dead
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 15_000;
const CONNECT_GRACE_MS = 1_500; // synthetic kicks in if live isn't up by then

// votes are visually identical — one shared immutable object, zero
// allocation for the dominant tx type (consumers only read kind/weight)
const DUST: FeedTx = Object.freeze({ kind: "vote", weight: 0.35 });

const LAMPORTS_PER_SOL = 1e9;

const toFeedTx = ([kindIdx, lamports, whale]: WireSlot["txs"][number]): FeedTx => {
  const sol = lamports / LAMPORTS_PER_SOL;
  return {
    kind: KINDS[kindIdx] ?? "other",
    weight: whale ? 5 + Math.min(3, sol / 2_000) : 0.8 + Math.min(1.4, sol * 0.02),
    ...(whale ? { whale: true } : null),
    amountSol: sol,
  };
};

export const startFeed = ({ onTx, onSlot, onState }: FeedHandlers) => {
  const url = process.env.NEXT_PUBLIC_FEED_URL;
  let stopped = false;

  /* ---------------- synthetic side ---------------- */

  let stopSynthetic: (() => void) | null = null;
  let hybridTxCount = 0; // synthetic txs since last real tick (hybrid mode)
  let lastRealSlot = 0; // best-known mainnet slot, for seamless takeover

  const countingOnTx = (tx: FeedTx) => {
    hybridTxCount++;
    onTx(tx);
  };

  let syntheticEmitsSlots = true;
  const ensureSynthetic = (emitSlots: boolean) => {
    if (stopSynthetic && syntheticEmitsSlots === emitSlots) return;
    stopSynthetic?.();
    syntheticEmitsSlots = emitSlots;
    hybridTxCount = 0;
    stopSynthetic = startSyntheticFeed({
      emitSlots,
      startSlot: lastRealSlot > 0 ? lastRealSlot : undefined,
      onTx: emitSlots ? onTx : countingOnTx,
      onSlot,
    });
  };

  const killSynthetic = () => {
    stopSynthetic?.();
    stopSynthetic = null;
  };

  /* ---------------- live side ---------------- */

  if (!url) {
    ensureSynthetic(true);
    onState({ mode: "synthetic", label: "synthetic feed" });
    return () => {
      stopped = true;
      killSynthetic();
    };
  }

  let ws: WebSocket | null = null;
  let backoff = BACKOFF_MIN_MS;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let mode: FeedMode | "starting" = "starting";

  // per-slot drip buffers: interesting txs FIFO + a dust counter, drained on
  // a fixed timer so a slot's burst spreads across ~8 ticks
  let pending: FeedTx[] = [];
  let pendingDust = 0;

  const drip = setInterval(() => {
    if (mode !== "live") return;
    if (pending.length > 0) {
      const n = Math.max(1, Math.ceil(pending.length / 8));
      for (let i = 0; i < n && pending.length > 0; i++) onTx(pending.shift()!);
    }
    if (pendingDust > 0) {
      const n = Math.max(1, Math.ceil(pendingDust / 8));
      for (let i = 0; i < n; i++) onTx(DUST);
      pendingDust -= n;
    }
  }, DRIP_MS);

  const setMode = (next: FeedMode, label: string) => {
    if (mode === next) return;
    mode = next;
    if (next === "live") killSynthetic();
    else ensureSynthetic(next === "synthetic");
    onState({ mode: next, label });
  };

  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => ws?.close(), WATCHDOG_MS);
  };

  const handleSlot = (s: WireSlot) => {
    lastRealSlot = s.slot;
    if (s.partial) {
      // slots-only: real cadence + real slot numbers, synthetic particles
      setMode("hybrid", "mainnet slots · simulated tx");
      onSlot({ slot: s.slot, txCount: hybridTxCount });
      hybridTxCount = 0;
      return;
    }
    setMode("live", "solana mainnet");
    const total = s.counts.reduce((a, b) => a + b, 0);
    pending = pending.length > 200 ? s.txs.map(toFeedTx) : pending.concat(s.txs.map(toFeedTx));
    pendingDust = Math.min(s.counts[0], MAX_DUST_PER_SLOT);
    onSlot({
      slot: s.slot,
      txCount: total,
      feeLamports: s.feeLamports,
      volumeSol: s.volumeLamports / LAMPORTS_PER_SOL,
    });
  };

  const connect = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(url);
    } catch {
      setMode("synthetic", "synthetic feed");
      return;
    }
    // synthetic covers the gap unless live data shows up fast
    if (mode === "starting") {
      graceTimer = setTimeout(() => {
        if (mode === "starting") setMode("synthetic", "connecting to mainnet…");
      }, CONNECT_GRACE_MS);
    }

    ws.onmessage = (ev) => {
      armWatchdog();
      backoff = BACKOFF_MIN_MS;
      const msg = decode(typeof ev.data === "string" ? ev.data : "");
      if (!msg) return;
      if (msg.t === "slot") handleSlot(msg.slot);
      else if (msg.t === "hello") {
        if (msg.hello.slot > 0) lastRealSlot = msg.hello.slot;
      } else if (msg.t === "status") {
        if (msg.status === "down" || msg.status === "connecting")
          setMode("synthetic", "mainnet feed reconnecting · synthetic");
      }
    };

    ws.onclose = () => {
      if (watchdog) clearTimeout(watchdog);
      if (stopped) return;
      setMode("synthetic", "feed unreachable · synthetic");
      const wait = backoff;
      backoff = Math.min(backoff * 1.7, BACKOFF_MAX_MS);
      setTimeout(connect, wait);
    };
    ws.onerror = () => ws?.close();
  };

  connect();

  return () => {
    stopped = true;
    clearInterval(drip);
    if (watchdog) clearTimeout(watchdog);
    if (graceTimer) clearTimeout(graceTimer);
    killSynthetic();
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  };
};
