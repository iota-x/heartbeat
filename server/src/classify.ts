// single-pass block parsing: classify every transaction by the programs it
// invokes, extract SOL movement from balance deltas, aggregate per slot.

import { KIND_INDEX, type TxKind, type WireTx } from "./protocol.js";

const VOTE_PROGRAM = "Vote111111111111111111111111111111111111111";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// DEX / aggregator programs → swap
const SWAP_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter v6
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB", // Jupiter v4
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // Raydium CPMM
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpool
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP", // Orca v2
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", // Pump.fun
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", // PumpSwap AMM
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // Meteora DLMM
  "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY", // Phoenix
]);

// NFT marketplaces / metadata programs → nft
const NFT_PROGRAMS = new Set([
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", // Metaplex Token Metadata
  "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY", // Metaplex Bubblegum (cNFT)
  "TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN", // Tensor Swap
  "TCMPhJdwDryooaGtiocG1u3xcYbRpiJzb283XfCZsDp", // Tensor cNFT
  "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K", // Magic Eden v2
  "mmm3XBJg5gk8XJxEKBvdgptZz6SgK4tXvn36sodowMc", // Magic Eden MMM
]);

// minimal shapes of a `blockSubscribe` notification with encoding "json",
// transactionDetails "full" — everything else is ignored
interface RawInstruction {
  programIdIndex: number;
}
interface RawTx {
  transaction: {
    message: {
      accountKeys: string[];
      instructions: RawInstruction[];
    };
  };
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    loadedAddresses?: { writable: string[]; readonly: string[] };
  } | null;
}
export interface RawBlock {
  transactions?: RawTx[];
}

export interface SlotAggregate {
  counts: [number, number, number, number, number];
  volumeLamports: number;
  feeLamports: number;
  txs: WireTx[];
}

const classifyTx = (tx: RawTx): TxKind => {
  const { accountKeys, instructions } = tx.transaction.message;
  const loaded = tx.meta?.loadedAddresses;

  const keyAt = (i: number): string | undefined => {
    if (i < accountKeys.length) return accountKeys[i];
    if (!loaded) return undefined;
    const w = i - accountKeys.length;
    if (w < loaded.writable.length) return loaded.writable[w];
    return loaded.readonly[w - loaded.writable.length];
  };

  let sawVote = false;
  let sawTransfer = false;
  let sawNft = false;
  for (const ins of instructions) {
    const program = keyAt(ins.programIdIndex);
    if (!program) continue;
    if (SWAP_PROGRAMS.has(program)) return "swap"; // swaps win outright
    if (NFT_PROGRAMS.has(program)) sawNft = true;
    else if (program === VOTE_PROGRAM) sawVote = true;
    else if (
      program === SYSTEM_PROGRAM ||
      program === TOKEN_PROGRAM ||
      program === TOKEN_2022_PROGRAM
    )
      sawTransfer = true;
  }
  if (sawNft) return "nft";
  if (sawVote) return "vote";
  if (sawTransfer) return "transfer";
  return "other";
};

/** SOL moved: the largest positive balance delta across accounts */
const lamportsMoved = (tx: RawTx): number => {
  const meta = tx.meta;
  if (!meta) return 0;
  const { preBalances, postBalances } = meta;
  let max = 0;
  const n = Math.min(preBalances.length, postBalances.length);
  for (let i = 0; i < n; i++) {
    const d = (postBalances[i] ?? 0) - (preBalances[i] ?? 0);
    if (d > max) max = d;
  }
  return max;
};

export const aggregateBlock = (
  block: RawBlock,
  whaleLamports: number,
  maxTxs: number,
): SlotAggregate => {
  const counts: SlotAggregate["counts"] = [0, 0, 0, 0, 0];
  let volume = 0;
  let fees = 0;
  const whales: WireTx[] = [];
  const rest: WireTx[] = [];

  for (const tx of block.transactions ?? []) {
    if (!tx?.transaction?.message) continue;
    const kind = classifyTx(tx);
    counts[KIND_INDEX[kind]]++;
    fees += tx.meta?.fee ?? 0;
    if (kind === "vote") continue; // counted, never serialized

    const amount = lamportsMoved(tx);
    volume += amount;
    if (tx.meta?.err) continue; // failed txs count but don't render
    const wire: WireTx = [KIND_INDEX[kind], amount, amount >= whaleLamports ? 1 : 0];
    if (wire[2]) whales.push(wire);
    else rest.push(wire);
  }

  // whales always ship; the rest is stride-sampled down to the budget
  const budget = Math.max(0, maxTxs - whales.length);
  let sampled = rest;
  if (rest.length > budget) {
    sampled = [];
    const stride = rest.length / budget;
    for (let i = 0; i < budget; i++) {
      const pick = rest[Math.floor(i * stride)];
      if (pick) sampled.push(pick);
    }
  }

  return {
    counts,
    volumeLamports: volume,
    feeLamports: fees,
    txs: whales.concat(sampled),
  };
};
