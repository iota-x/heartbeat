// heartbeat ingest — one upstream Solana websocket in, N browsers out.

import { config } from "./config.js";
import { aggregateBlock } from "./classify.js";
import { startUpstream } from "./upstream.js";
import { startHub } from "./hub.js";
import type { FeedStatus, SlotMsg } from "./protocol.js";

console.log(
  "[ingest] starting — upstream=%s whale=%d SOL, maxTxs/slot=%d",
  config.usingHelius ? "helius" : "public rpc",
  config.whaleLamports / 1e9,
  config.maxTxsPerSlot,
);

const hub = startHub(config.port, config.whaleLamports);

let status: FeedStatus = "connecting";
let lastBlockSlot = 0;

const stopUpstream = startUpstream(config.upstreamUrl, config.upstreamHttpUrl, {
  onStatus: (next) => {
    status = next;
    hub.setStatus(next);
  },

  onBlock: (slot, block) => {
    lastBlockSlot = slot;
    const agg = aggregateBlock(block, config.whaleLamports, config.maxTxsPerSlot);
    const msg: SlotMsg = {
      t: "s",
      s: slot,
      c: agg.counts,
      vol: agg.volumeLamports,
      fee: agg.feeLamports,
      x: agg.txs,
    };
    hub.broadcast(msg);
  },

  // in slots-only mode the tick itself is the only signal — forward it as a
  // partial slot so clients at least see real slot numbers
  onSlotTick: (slot) => {
    if (status !== "slots") return;
    if (slot <= lastBlockSlot) return;
    hub.broadcast({ t: "s", s: slot, c: [0, 0, 0, 0, 0], vol: 0, fee: 0, x: [], p: 1 });
  },
});

const shutdown = () => {
  console.log("[ingest] shutting down");
  stopUpstream();
  hub.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
