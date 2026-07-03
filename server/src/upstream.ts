// the single upstream websocket to Solana mainnet.
//
// strategy ladder:
//   1. blockSubscribe (one push per block; only some RPCs enable it)
//   2. refused → slotSubscribe drives HTTP getBlock polling — full block
//      data on any endpoint that serves getBlock (free Helius does)
//   3. polling keeps failing → slots-only, degraded status, keep serving

import WebSocket from "ws";
import type { FeedStatus } from "./protocol.js";
import type { RawBlock } from "./classify.js";

const BLOCK_SUB_ID = 1;
const SLOT_SUB_ID = 2;
// slots land every ~400ms; silence this long means the socket is dead
const WATCHDOG_MS = 15_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
// free push endpoints can throttle delivery and drift behind the chain;
// slot ticks tell us the real head, so reconnect if blocks go this stale
const LAG_RESET_SLOTS = 300; // ~2 minutes

export interface UpstreamEvents {
  onBlock: (slot: number, block: RawBlock) => void;
  onSlotTick: (slot: number) => void;
  onStatus: (status: FeedStatus) => void;
}

// getBlock polling: keep latency bounded, never hammer a limited RPC
const POLL_QUEUE_MAX = 6; // slots waiting to be fetched; older ones drop
const POLL_CONCURRENCY = 3; // blocks are ~4MB; parallel fetches tighten cadence
const POLL_TRIES = 5; // "block not available" retries (confirmed lags ~1s)
const POLL_RETRY_MS = 400;
const POLL_FAIL_LIMIT = 8; // consecutive hard failures → slots-only
const POLL_COOLDOWN_MS = 60_000; // then try polling again after this

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const startUpstream = (url: string, httpUrl: string, events: UpstreamEvents) => {
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = BACKOFF_MIN_MS;
  let watchdog: NodeJS.Timeout | null = null;
  let sawBlock = false;

  /* -------- HTTP getBlock polling (strategy 2) -------- */

  let polling = false;
  const pollQueue: number[] = [];
  let pollFails = 0;
  let pollDisabledUntil = 0;

  const fetchBlock = async (slot: number): Promise<RawBlock | "skipped" | null> => {
    for (let attempt = 0; attempt < POLL_TRIES; attempt++) {
      if (stopped) return null;
      try {
        const res = await fetch(httpUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getBlock",
            params: [
              slot,
              {
                encoding: "json",
                transactionDetails: "full",
                showRewards: false,
                maxSupportedTransactionVersion: 0,
                commitment: "confirmed",
              },
            ],
          }),
        });
        if (res.status === 429) {
          await sleep(2_000);
          continue;
        }
        const body = (await res.json()) as {
          result?: RawBlock;
          error?: { code: number; message: string };
        };
        if (body.result) return body.result;
        if (body.error) {
          // not yet available at confirmed — give it a moment
          if (body.error.code === -32004) {
            await sleep(POLL_RETRY_MS);
            continue;
          }
          // skipped slot / pruned — nothing will ever be there
          if (body.error.code === -32007 || body.error.code === -32009) return "skipped";
          return null;
        }
      } catch {
        await sleep(POLL_RETRY_MS);
      }
    }
    return null;
  };

  let lastEmittedSlot = 0;
  let lastTickSlot = 0;

  const startPollWorkers = () => {
    if (polling) return;
    polling = true;
    for (let i = 0; i < POLL_CONCURRENCY; i++) void pollLoop();
  };

  const pollLoop = async () => {
    while (!stopped) {
      const slot = pollQueue.shift();
      if (slot === undefined) {
        await sleep(50);
        continue;
      }
      // bound latency: drop the oldest when a limited RPC can't keep up
      while (pollQueue.length > POLL_QUEUE_MAX) pollQueue.shift();

      const block = await fetchBlock(slot);
      if (block === "skipped") continue;
      if (block) {
        pollFails = 0;
        if (!sawBlock) {
          sawBlock = true;
          events.onStatus("live");
          console.log("[upstream] live via getBlock polling — slot %d", slot);
        }
        // concurrent fetches can finish out of order; never rewind the feed
        if (slot > lastEmittedSlot) {
          lastEmittedSlot = slot;
          events.onBlock(slot, block);
        }
      } else {
        pollFails++;
        if (pollFails >= POLL_FAIL_LIMIT) {
          console.warn(
            "[upstream] getBlock failing repeatedly — slots-only for %ds",
            POLL_COOLDOWN_MS / 1000,
          );
          pollFails = 0;
          sawBlock = false;
          pollDisabledUntil = Date.now() + POLL_COOLDOWN_MS;
          pollQueue.length = 0;
          events.onStatus("slots");
        }
      }
    }
  };

  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      console.warn("[upstream] silent for %ds, reconnecting", WATCHDOG_MS / 1000);
      ws?.terminate();
    }, WATCHDOG_MS);
  };

  let pollMode = false;

  const connect = () => {
    if (stopped) return;
    events.onStatus("connecting");
    sawBlock = false;
    pollMode = false;
    pollQueue.length = 0;
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
            "[upstream] blockSubscribe refused (%s) — polling getBlock over HTTP",
            msg.error.message,
          );
          pollMode = true;
          startPollWorkers();
        } else {
          // accepted — blockNotification handler flips status to live
        }
        return;
      }

      if (msg.method === "slotNotification") {
        const r = msg.params?.result as { slot?: number } | undefined;
        if (typeof r?.slot === "number") {
          if (r.slot > lastTickSlot) lastTickSlot = r.slot;
          events.onSlotTick(r.slot);
          if (pollMode && Date.now() >= pollDisabledUntil) pollQueue.push(r.slot);
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
          if (lastTickSlot - v.slot > LAG_RESET_SLOTS) {
            console.warn(
              "[upstream] block stream %d slots behind head — resubscribing",
              lastTickSlot - v.slot,
            );
            ws?.terminate();
            return;
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
