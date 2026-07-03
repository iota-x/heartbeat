# Heartbeat

A live, full-screen 3D visualization of Solana. Every light is a real
transaction: votes fall as ambient dust, transfers and swaps stream in as
colored particles, and whale transfers arrive as golden comets that spiral
into the core, shake the camera, and land with a synthesized sub-bass thump.
Every ~400ms a slot closes — the accumulated energy collapses inward, the
core flashes, and a block is ejected into a receding chain of recent blocks.
There are no tables and no charts; the scene is the interface, and the
numbers exist only as dim monospace annotations in the corners.

![heartbeat](docs/screenshot.png)

## Architecture

```
 Solana mainnet
      │  one websocket: blockSubscribe + slotSubscribe
      │  (Helius if HELIUS_API_KEY, else SOLANA_WS_URL / public RPC)
      ▼
┌─────────────────┐   parse each block once: classify by program ID,
│  server/        │   count votes, extract lamports, flag whales,
│  Node 20 + ws   │   stride-sample the rest to ≤150 txs/slot
└─────────────────┘
      │  compact JSON, ~1.8 KB per slot, fan-out to N clients
      │  (votes only ever travel as a per-slot count)
      ▼
┌─────────────────┐   lib/feedSource.ts adapts the wire protocol into
│  Next.js app    │   FeedTx/SlotSummary; if the feed is missing, down,
│  R3F + bloom    │   or slots-only, the synthetic feed takes over
└─────────────────┘   automatically (badge shown, never a black screen)
```

Feed modes, all verified end to end:

| mode | what's real | when |
|---|---|---|
| `live` | everything | RPC supports `blockSubscribe` (e.g. Helius) |
| `hybrid` | slot numbers + cadence | keyless public RPC (refuses `blockSubscribe`) |
| `synthetic` | nothing (realistic mix) | no feed URL, feed down, or WebGL-less poster |

## Running locally

Node 20 (`.nvmrc`). Two processes, both optional beyond the first:

```sh
npm install && npm run dev        # web app — synthetic feed, zero config
```

To feed it real chain data:

```sh
cd server && npm install && cd ..
npm run dev:ingest                # keyless: real slots, degraded to hybrid
echo 'NEXT_PUBLIC_FEED_URL=ws://localhost:8787' > .env.local
npm run dev
```

With a free [Helius](https://helius.dev) key the full firehose flows:

```sh
echo 'HELIUS_API_KEY=<key>' > server/.env   # or export it
npm run dev:ingest
```

Server env (all optional): `HELIUS_API_KEY`, `SOLANA_WS_URL`, `PORT` (8787),
`WHALE_SOL` (1000), `MAX_TXS_PER_SLOT` (150). No keys ever reach the client;
the only `NEXT_PUBLIC_` var is the feed URL.

## Measured numbers

Real measurements, not aspirations. Setup: M-series MacBook, production
build (`next build && next start`), Chrome 1512×900.

- **60.0 fps** sustained (rAF-measured over 10s after warmup, synthetic
  feed at ~900 tps, bloom on, DPR 1). Adaptive governor steps down
  4000→2500→1500 particles, then bloom off, then DPR 1.0 if a machine
  can't hold 48 fps; hidden tabs pause rendering entirely.
- **4,272 instances, 4 draw calls** for the whole scene: particle pool
  4,000 + whale pool 264 (24 whales × head+10-ghost trail) + 8-block chain,
  one `InstancedMesh` each, plus the core. Zero allocations in any
  `useFrame` loop — flat preallocated `Float32Array`s, one reused dummy.
- **~4.4 KB/s per client** downstream. Slot 430,532,682 (1,171 txs,
  3.43 MB upstream JSON) aggregates to a **1,762-byte** slot message —
  a ~1,950× reduction. Slots-only mode is ~70 B per slot.
- **~11 ms per slot** of server CPU against that same real block:
  10.1 ms `JSON.parse` + 0.89 ms classify/aggregate — ~2.7% of one core
  at mainnet's 400ms cadence.
- **567 KB transferred** for the whole page (10 requests, prod build).
- Classification of that block: 701 votes / 172 transfers / 71 swaps /
  7 NFT / 220 other — votes are ~60% of mainnet, which is why they only
  ever travel as a count.

## Deploying

- **Web** — Vercel: import the repo, set `NEXT_PUBLIC_FEED_URL=wss://…`,
  done (`vercel.json` included). Without the env var the site runs
  synthetic — infra can die without the demo dying.
- **Ingest** — Fly.io: `server/Dockerfile` + `server/fly.toml` are ready;
  `fly launch --copy-config --no-deploy && fly secrets set
  HELIUS_API_KEY=… && fly deploy` from `server/`. One always-on machine
  holds the single upstream subscription for all viewers.

## Non-goals

No historical replay, no click-to-explorer, no wallet connection, no
multi-chain. One live view, done properly.
