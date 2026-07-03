// the single upstream websocket to Solana mainnet.
//
// strategy: blockSubscribe (one parse per block, exact vote counts) plus
// slotSubscribe as a liveness heartbeat. public RPCs usually refuse
// blockSubscribe — we then stay connected in slots-only mode and report a
// degraded status instead of dying.

import WebSocket from "ws";
import type { FeedStatus } from "./protocol.js";
import type { RawBlock } from "./classify.js";

const BLOCK_SUB_ID = 1;
const SLOT_SUB_ID = 2;
// slots land every ~400ms; silence this long means the socket is dead
const WATCHDOG_MS = 15_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export interface UpstreamEvents {
  onBlock: (slot: number, block: RawBlock) => void;
  onSlotTick: (slot: number) => void;
  onStatus: (status: FeedStatus) => void;
}

export const startUpstream = (url: string, events: UpstreamEvents) => {
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = BACKOFF_MIN_MS;
  let watchdog: NodeJS.Timeout | null = null;
  let blockSubOk = false;
  let sawBlock = false;

  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      console.warn("[upstream] silent for %ds, reconnecting", WATCHDOG_MS / 1000);
      ws?.terminate();
    }, WATCHDOG_MS);
  };

  const connect = () => {
    if (stopped) return;
    events.onStatus("connecting");
    blockSubOk = false;
    sawBlock = false;
    console.log("[upstream] connecting to %s", url.replace(/api-key=.*/, "api-key=***"));
    ws = new WebSocket(url, { handshakeTimeout: 10_000 });

    ws.on("open", () => {
      backoff = BACKOFF_MIN_MS;
      armWatchdog();
      ws?.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: BLOCK_SUB_ID,
          method: "blockSubscribe",
          params: [
            "all",
            {
              commitment: "confirmed",
              encoding: "json",
              transactionDetails: "full",
              showRewards: false,
              maxSupportedTransactionVersion: 0,
            },
          ],
        }),
      );
      ws?.send(
        JSON.stringify({ jsonrpc: "2.0", id: SLOT_SUB_ID, method: "slotSubscribe" }),
      );
    });

    ws.on("message", (data) => {
      armWatchdog();
      let msg: {
        id?: number;
        error?: { code: number; message: string };
        result?: unknown;
        method?: string;
        params?: { result?: unknown };
      };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      // subscription confirmations / rejections
      if (msg.id === BLOCK_SUB_ID) {
        if (msg.error) {
          console.warn(
            "[upstream] blockSubscribe refused (%s) — slots-only mode",
            msg.error.message,
          );
          events.onStatus("slots");
        } else {
          blockSubOk = true;
        }
        return;
      }

      if (msg.method === "slotNotification") {
        const r = msg.params?.result as { slot?: number } | undefined;
        if (typeof r?.slot === "number") {
          events.onSlotTick(r.slot);
          // blockSubscribe accepted but blocks lag slots by ~1.5s at
          // "confirmed"; only report live once real blocks flow
          if (blockSubOk && !sawBlock) events.onStatus("connecting");
        }
        return;
      }

      if (msg.method === "blockNotification") {
        const r = msg.params?.result as
          | { value?: { slot?: number; block?: RawBlock | null } }
          | undefined;
        const v = r?.value;
        if (v && typeof v.slot === "number" && v.block) {
          if (!sawBlock) {
            sawBlock = true;
            events.onStatus("live");
            console.log("[upstream] live — first block at slot %d", v.slot);
          }
          events.onBlock(v.slot, v.block);
        }
      }
    });

    ws.on("error", (err) => {
      console.warn("[upstream] socket error: %s", (err as Error).message);
    });

    ws.on("close", () => {
      if (watchdog) clearTimeout(watchdog);
      if (stopped) return;
      events.onStatus("down");
      const wait = backoff;
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      console.warn("[upstream] disconnected, retrying in %dms", wait);
      setTimeout(connect, wait);
    });
  };

  connect();

  return () => {
    stopped = true;
    if (watchdog) clearTimeout(watchdog);
    ws?.terminate();
  };
};
