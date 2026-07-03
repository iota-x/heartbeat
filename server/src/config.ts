const LAMPORTS_PER_SOL = 1_000_000_000;

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
  // keyless dev default — public RPC; usually refuses blockSubscribe, in
  // which case we degrade to slots-only and the client shows it
  return process.env.SOLANA_WS_URL ?? "wss://api.mainnet-beta.solana.com";
};

export const config = {
  port: num("PORT", 8787),
  upstreamUrl: upstreamUrl(),
  usingHelius: Boolean(process.env.HELIUS_API_KEY),
  whaleLamports: num("WHALE_SOL", 1_000) * LAMPORTS_PER_SOL,
  /** max individual (non-vote) txs serialized per slot */
  maxTxsPerSlot: num("MAX_TXS_PER_SLOT", 150),
};

export { LAMPORTS_PER_SOL };
