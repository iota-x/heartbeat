# Heartbeat — build prompt

Build "Heartbeat" end to end in this repo: a live, full-screen 3D visualization
of Solana where every transaction on the network is rendered in real time.
This is not a dashboard — no tables, no charts. The scene IS the interface;
numbers exist only as ambient HUD annotations.

## What already exists (read these first, keep their contracts)

- `components/Scene.tsx` — milestone-1 skeleton: single InstancedMesh particle
  pool (zero per-frame allocations), transactions fall from an outer ring into
  a wireframe core that pulses every 400ms slot close, colors by tx kind,
  minimal HUD. Evolve this, don't rewrite from scratch.
- `lib/feed.ts` — synthetic feed emitting `FeedTx` + `SlotSummary` at a
  realistic mainnet mix (~70% votes, rare whales). The real feed must speak
  this exact interface so the scene never knows the difference.
- Node 20 required (`.nvmrc` present). Next.js 16, App Router, Tailwind,
  React Three Fiber already installed.

## Architecture to build

1. **Ingest service** in `server/` (own package.json, plain Node 20 + `ws`,
   TypeScript, no framework):
   - One upstream websocket subscription to Solana mainnet. Use Helius
     enhanced websockets if `HELIUS_API_KEY` is set, otherwise standard
     `blockSubscribe`/`slotSubscribe` against `SOLANA_WS_URL` (default to a
     public RPC so it runs keyless in dev, even if rate-limited).
   - Parse each block once: classify txs by program ID (Jupiter, Raydium,
     Orca = swap; Metaplex/Tensor/Magic Eden = nft; system/token transfers =
     transfer; vote program = vote; else other), extract lamport amounts,
     compute per-slot aggregates (counts by kind, total volume, fees).
   - Fan out to N browser clients over its own websocket server: compact
     JSON messages, a few KB per slot max. Votes are NEVER sent individually
     — only their per-slot count (the client renders them as statistically
     driven ambient dust). Individual particles only for the interesting
     minority; sample if a slot has too many, but always include whales
     (transfers/swaps above a configurable lamport threshold, flagged so the
     client can dramatize them).
   - Heartbeat/reconnect logic both upstream and downstream. If upstream
     dies, keep serving and emit a `degraded` status the client shows.

2. **Client feed layer** in `lib/`:
   - `NEXT_PUBLIC_FEED_URL` set → connect to the ingest websocket, adapt
     messages into the existing `FeedTx`/`SlotSummary` interface.
   - Unset or connection fails → fall back to the existing synthetic feed
     automatically, with a small "synthetic" badge in the HUD. The deployed
     site must never be a black screen because infra is down.

3. **Scene polish** (evolve `components/Scene.tsx`):
   - Bloom via @react-three/postprocessing; the core flash and whale
     particles should be the only HDR-hot elements.
   - Whale drama: bigger particle, trail or glow, subtle camera shake and a
     deep WebAudio thump on impact. Synthesize all audio with WebAudio (no
     audio files), opt-in via a small mute-by-default toggle.
   - Slot close: accumulated energy visibly collapses into the core, then
     the core ejects a compact "block" that drifts back into a receding
     chain of recent blocks (keep last ~8, fade older ones out).
   - Adaptive quality: measure FPS after load; degrade in steps (particle
     count → bloom off → DPR floor). Pause rendering entirely when the tab
     is hidden; keep the websocket alive.
   - First-visit overlay (one sentence: "Every light is a real transaction
     happening on Solana right now"), dismissed on click, remembered in
     localStorage.
   - HUD: current slot, live TPS, priority-fee level, connection status.
     Monospace, dim, corners only.

## Constraints

- 60fps on an M1 Air is the bar. Zero allocations in useFrame loops, one
  draw call for particles, ring buffers between network and render, hard
  per-frame spawn caps with graceful decay under burst.
- No API keys in client code or NEXT_PUBLIC vars. Server reads env only.
- Everything must degrade: keyless dev, infra-less deploy, WebGL-less
  browser (show a static poster + live text stats instead).
- TypeScript strict throughout, including `server/`.

## Deliverables & workflow

- Work in milestones, in this order, and commit after each with a clear
  message: (1) server ingest + protocol, (2) client feed adapter + fallback,
  (3) scene polish + audio, (4) adaptive quality + degraded modes,
  (5) README + deploy configs.
- Verify as you go: `npm run build` must pass at every commit; run the dev
  server and the ingest server together at least once and confirm real slots
  flow through (or synthetic fallback engages cleanly if the RPC blocks you).
- README: what it is (one paragraph), architecture diagram (ASCII fine), how
  to run locally with and without a Helius key, and a measured-numbers
  section (fps, particle count, bandwidth per client) filled with real
  measurements, not aspirations.
- Deploy configs: Vercel for the Next app, a Dockerfile + fly.toml for
  `server/`. Don't deploy — just make both ready.

## Non-goals (do not build)

- No historical replay, no click-to-explorer, no wallet connection, no
  multi-chain support. Ship the single live view exceptionally well.
