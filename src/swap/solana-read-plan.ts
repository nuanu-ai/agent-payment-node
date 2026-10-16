import { SOLANA_ACCOUNT_KEYS_PER_READ } from "./solana-account-pages.js";

/**
 * Worst-case physical Solana POSTs of one swap command, derived from the reads each step sends (P4), not hand-counted.
 * Every swap account read goes out in requests of at most 8 keys (readSolanaAccountPages: PublicNode's limit), and a
 * keyless public endpoint never shares a POST between account reads, while fee, height and rent share one POST.
 * Nothing retries inside a command: a refused or rate-limited read ends it, the next command starts a fresh budget, and
 * no budget is stored, so no number of retries can exhaust an operation. Persistent per-provider pacing protects the
 * public endpoint across commands.
 */
const accountReads = (keys: number) => Math.ceil(keys / SOLANA_ACCOUNT_KEYS_PER_READ);
/** Explicit headroom: one unplanned split of a batched read and one extra account page. */
export const SOLANA_SWAP_PLAN_HEADROOM_REQUESTS = 2;

const GENESIS = 1, BLOCKHASH = 1, FEE = 1, SIMULATION = 1, HEIGHT = 1, SEND = 1;
/** Signature status, then the finalized transaction. */
const OBSERVE = 2;
/** Finalized height, then the signature status with full history (proveSolanaUnlanded). */
const UNLANDED = 2;
const STATUS = OBSERVE + UNLANDED;

/** Orca keyless: the 45-byte headers of seven program keys, the pool, the ten-key market read, token rent. */
const ORCA_MARKET = accountReads(7) + accountReads(1) + accountReads(10) + 1;
const ORCA_QUOTE = GENESIS + ORCA_MARKET + BLOCKHASH + FEE + SIMULATION;
/** The pre-signing guard repeats the quote reads and the lifetime height, then the one send and its observation. */
const ORCA_APPROVE = GENESIS + ORCA_MARKET + BLOCKHASH + FEE + SIMULATION + HEIGHT + SEND + OBSERVE;

/**
 * Jupiter: at most 64 compiled accounts (the simulation proof's bound) plus 8 lookup tables (the build decoder's bound)
 * read in full, at most 10 program and ProgramData keys read as 45-byte headers, and one fee/height/rent POST.
 */
const JUPITER_RESOLVE = GENESIS + accountReads(64 + 8) + accountReads(10) + FEE;
const JUPITER_QUOTE = JUPITER_RESOLVE + BLOCKHASH + SIMULATION;
/** Pre-consent re-resolve and simulation, the lifetime height before signing and before the send, the send, its observation. */
const JUPITER_APPROVE = JUPITER_RESOLVE + SIMULATION + HEIGHT + HEIGHT + SEND + OBSERVE;

const PLANS: Readonly<Record<string, number>> = Object.freeze({
  "swap.orca.quote": ORCA_QUOTE, "swap.orca.prepare": 0, "swap.orca.approve": ORCA_APPROVE,
  "swap.orca.execute": Math.max(ORCA_APPROVE, STATUS), "swap.orca.status": STATUS,
  "swap.jupiter.quote": JUPITER_QUOTE, "swap.jupiter.prepare": 0, "swap.jupiter.approve": JUPITER_APPROVE,
  "swap.jupiter.execute": Math.max(JUPITER_APPROVE, STATUS), "swap.jupiter.status": STATUS,
});

/** The physical request budget of one Orca keyless or Jupiter command; null for every other command. */
export function solanaSwapCommandRequests(command: string): number | null {
  const plan = PLANS[command];
  return plan === undefined ? null : plan + SOLANA_SWAP_PLAN_HEADROOM_REQUESTS;
}
