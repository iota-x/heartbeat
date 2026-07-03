import { readFileSync } from "node:fs";

const LAMPORTS_PER_SOL = 1_000_000_000;

// minimal .env loader — real environments (Docker/Fly) set env directly and
// always win over the file
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  // no .env file — fine
}

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  }
  return v;
};

const upstreamUrl = (): string => {
  const key = process.env.HELIUS_API_KEY;
  if (key) return `wss://mainnet.helius-rpc.com/?api-key=${key}`;
  // keyless default: PublicNode serves blockSubscribe for free (full live
  // mode, ~1min behind head); a Helius key trades that lag for ~3s
  return process.env.SOLANA_WS_URL ?? "wss://solana-rpc.publicnode.com";
};

export const config = {
  port: num("PORT", 8787),
  upstreamUrl: upstreamUrl(),
  /** same endpoint over HTTP, for getBlock polling when blockSubscribe is refused */
  upstreamHttpUrl: upstreamUrl().replace(/^ws/, "http"),
  usingHelius: Boolean(process.env.HELIUS_API_KEY),
  whaleLamports: num("WHALE_SOL", 1_000) * LAMPORTS_PER_SOL,
  /** max individual (non-vote) txs serialized per slot */
  maxTxsPerSlot: num("MAX_TXS_PER_SLOT", 150),
};

export { LAMPORTS_PER_SOL };
