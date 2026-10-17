import { getTokenDecoder } from "@solana-program/token";
import { canonicalJson, domainHash, isPlainRecord } from "../../canonical.js";
import { ApnError, type ErrorCode } from "../../errors.js";
import { rpcArray, rpcAtomic, rpcRecord, solanaAddress, type SolanaRpcPort } from "../../solana/rpc.js";
import { rawAccount, type RawSolanaAccount } from "./accounts.js";
import { SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WSOL_MINT } from "./pins.js";
import type { OrcaPoolConfig } from "./pools.js";

/** The owner's balances that a sol-usdc swap may move, read at quote time or re-read before signing. */
export interface OrcaOwnerBalances { readonly ownerLamports: string; readonly usdcAtomic: string; readonly usdcAccountExists: boolean }
/** The owner's balances that a token-input swap may move: SOL for the fee and rent, the source and destination tokens. */
export interface OrcaTokenOwnerBalances {
  readonly ownerLamports: string; readonly sourceAtomic: string; readonly destinationAtomic: string; readonly destinationAccountExists: boolean;
}
export interface OrcaSimulationEvidence {
  readonly requestHash: string; readonly resultHash: string; readonly slot: string; readonly unitsConsumed: string;
  readonly replaceRecentBlockhash: boolean; readonly ownerLamportsAfter: string; readonly usdcAtomicAfter: string;
  readonly usdcReceivedAtomic: string; readonly solSpentLamports: string;
}
export interface OrcaTokenSimulationEvidence {
  readonly requestHash: string; readonly resultHash: string; readonly slot: string; readonly unitsConsumed: string;
  readonly replaceRecentBlockhash: boolean; readonly ownerLamportsAfter: string; readonly sourceAtomicAfter: string;
  readonly destinationAtomicAfter: string; readonly outputReceivedAtomic: string; readonly solSpentLamports: string;
}
export interface OrcaSimulationBounds {
  readonly owner: string; readonly wsolAccount: string; readonly usdcAccount: string; readonly before: OrcaOwnerBalances;
  readonly minimumOutputAtomic: string; readonly maximumSolSpendLamports: string; readonly computeUnitLimit: number;
  /** An existing wSOL account the swap keeps: it must end with exactly its balance before the swap. */
  readonly wsolKept: { readonly amountAtomic: string; readonly lamports: string } | null;
}
export interface OrcaTokenSimulationBounds {
  readonly pool: OrcaPoolConfig; readonly owner: string; readonly sourceAccount: string; readonly destinationAccount: string;
  readonly before: OrcaTokenOwnerBalances; readonly amountInAtomic: string; readonly minimumOutputAtomic: string;
  readonly maximumSolSpendLamports: string; readonly computeUnitLimit: number;
}
export type OrcaSimulationReason = "orca_simulation_unavailable" | "orca_simulation_protocol" | "orca_simulation_blockhash_not_found" |
  "orca_simulation_insufficient_funds" | "orca_simulation_instruction_error" | "orca_simulation_rejected" |
  "orca_simulation_output_shortfall" | "orca_simulation_spend_exceeded";
interface SimulationRun { readonly params: unknown; readonly slot: bigint; readonly units: bigint;
  readonly owner: RawSolanaAccount | null; readonly source: RawSolanaAccount | null; readonly destination: RawSolanaAccount | null }

/**
 * Runs the exact unsigned bytes with `sigVerify: false` and reads back the owner's lamports, the wSOL account and the
 * USDC account. The Whirlpool program itself enforces `other_amount_threshold`; APN additionally requires the USDC
 * delta to reach the minimum, the wSOL account to be closed, and the SOL spend to stay inside input + fee + rent.
 */
export async function simulateOrcaSwap(rpc: SolanaRpcPort, unsignedPayload: string, bounds: OrcaSimulationBounds,
  replaceRecentBlockhash: boolean, minContextSlot: string): Promise<OrcaSimulationEvidence> {
  const run = await runSimulation(rpc, unsignedPayload, [bounds.owner, bounds.wsolAccount, bounds.usdcAccount], bounds.computeUnitLimit,
    replaceRecentBlockhash, minContextSlot);
  let ownerAfter: bigint, usdcAfter: bigint;
  try {
    const { owner, source: wsol, destination: usdc } = run;
    ownerAfter = plainOwner(owner);
    if (bounds.wsolKept === null) {
      // A closed account simulates as absent or as an empty, zero-lamport system account.
      if (wsol !== null && (wsol.lamports !== 0n || wsol.data.length !== 0 || wsol.owner !== SYSTEM_PROGRAM)) throw new Error();
    } else {
      // A kept account wraps exactly the input and swaps exactly the input: its own balance and lamports are unchanged.
      if (wsol === null || wsol.lamports !== BigInt(bounds.wsolKept.lamports)) throw new Error();
      if (tokenAmount(wsol, bounds.owner, WSOL_MINT) !== BigInt(bounds.wsolKept.amountAtomic)) throw new Error();
    }
    usdcAfter = tokenAmount(usdc, bounds.owner, USDC_MINT);
  } catch { return refuse("orca_simulation_protocol"); }
  const received = usdcAfter - BigInt(bounds.before.usdcAtomic), spent = BigInt(bounds.before.ownerLamports) - ownerAfter;
  if (received < BigInt(bounds.minimumOutputAtomic)) refuse("orca_simulation_output_shortfall");
  if (spent > BigInt(bounds.maximumSolSpendLamports)) refuse("orca_simulation_spend_exceeded");
  const result = { slot: run.slot.toString(), unitsConsumed: run.units.toString(), ownerLamportsAfter: ownerAfter.toString(),
    usdcAtomicAfter: usdcAfter.toString(), usdcReceivedAtomic: received.toString(), solSpentLamports: spent.toString() };
  return { requestHash: domainHash("apn.orca-simulation-request.v1", canonicalJson(run.params)),
    resultHash: domainHash("apn.orca-simulation-result.v1", canonicalJson(result)), replaceRecentBlockhash, ...result };
}

/**
 * Token-input pools: the same exact-bytes simulation. The source account must lose exactly the input, the destination
 * account must gain at least the minimum, and the SOL spend must stay inside the network fee plus any new account rent.
 */
export async function simulateOrcaTokenSwap(rpc: SolanaRpcPort, unsignedPayload: string, bounds: OrcaTokenSimulationBounds,
  replaceRecentBlockhash: boolean, minContextSlot: string): Promise<OrcaTokenSimulationEvidence> {
  const run = await runSimulation(rpc, unsignedPayload, [bounds.owner, bounds.sourceAccount, bounds.destinationAccount], bounds.computeUnitLimit,
    replaceRecentBlockhash, minContextSlot);
  let ownerAfter: bigint, sourceAfter: bigint, destinationAfter: bigint;
  try {
    ownerAfter = plainOwner(run.owner);
    sourceAfter = tokenAmount(run.source, bounds.owner, bounds.pool.mintA);
    destinationAfter = tokenAmount(run.destination, bounds.owner, bounds.pool.mintB);
  } catch { return refuse("orca_simulation_protocol"); }
  if (BigInt(bounds.before.sourceAtomic) - sourceAfter !== BigInt(bounds.amountInAtomic)) refuse("orca_simulation_protocol");
  const received = destinationAfter - BigInt(bounds.before.destinationAtomic), spent = BigInt(bounds.before.ownerLamports) - ownerAfter;
  if (received < BigInt(bounds.minimumOutputAtomic)) refuse("orca_simulation_output_shortfall");
  if (spent > BigInt(bounds.maximumSolSpendLamports)) refuse("orca_simulation_spend_exceeded");
  const result = { slot: run.slot.toString(), unitsConsumed: run.units.toString(), ownerLamportsAfter: ownerAfter.toString(),
    sourceAtomicAfter: sourceAfter.toString(), destinationAtomicAfter: destinationAfter.toString(), outputReceivedAtomic: received.toString(),
    solSpentLamports: spent.toString() };
  return { requestHash: domainHash("apn.orca-simulation-request.v1", canonicalJson(run.params)),
    resultHash: domainHash("apn.orca-simulation-result.v1", canonicalJson(result)), replaceRecentBlockhash, ...result };
}

async function runSimulation(rpc: SolanaRpcPort, unsignedPayload: string, addresses: readonly [string, string, string], computeUnitLimit: number,
  replaceRecentBlockhash: boolean, minContextSlot: string): Promise<SimulationRun> {
  if (!/^[1-9][0-9]{0,15}$/u.test(minContextSlot)) throw new ApnError("APN_INVALID_INPUT", "Orca simulation context slot is invalid.");
  // The simulation may not run on a node behind the slot the balances and pool state were read at.
  const params = [unsignedPayload, { sigVerify: false, replaceRecentBlockhash, commitment: "confirmed", encoding: "base64",
    minContextSlot: Number(minContextSlot), accounts: { encoding: "base64", addresses: [...addresses] } }] as const;
  let response: unknown;
  try { response = await rpc.call("simulateTransaction", params); }
  catch (error) { if (error instanceof ApnError && error.code === "APN_RPC_CONFIG") throw error; return refuse("orca_simulation_unavailable"); }
  let slot: bigint, value: Record<string, unknown>;
  try { const record = rpcRecord(response); slot = rpcAtomic(rpcRecord(record.context).slot); value = rpcRecord(record.value); }
  catch { return refuse("orca_simulation_protocol"); }
  if (value.err === undefined) refuse("orca_simulation_protocol");
  if (value.err !== null) refuse(classify(value.err, value.logs));
  let units: bigint, accounts: readonly unknown[];
  try {
    units = rpcAtomic(value.unitsConsumed);
    accounts = rpcArray(value.accounts, 3);
    if (accounts.length !== 3) throw new Error();
  } catch { return refuse("orca_simulation_protocol"); }
  if (units === 0n || units > BigInt(computeUnitLimit) || slot < BigInt(minContextSlot)) refuse("orca_simulation_protocol");
  let parsed: (RawSolanaAccount | null)[];
  try { parsed = accounts.map((account, index) => account === null ? null : rawAccount(account, index === 0 ? 0 : 165)); }
  catch { return refuse("orca_simulation_protocol"); }
  return { params, slot, units, owner: parsed[0] ?? null, source: parsed[1] ?? null, destination: parsed[2] ?? null };
}

export function orcaOwnerBalances(ownerValue: unknown, usdcValue: unknown, owner: string): OrcaOwnerBalances {
  solanaAddress(owner);
  const ownerLamports = ownerAccountLamports(ownerValue as RawSolanaAccount | null), usdc = usdcValue as RawSolanaAccount | null;
  if (usdc === null) return { ownerLamports, usdcAtomic: "0", usdcAccountExists: false };
  return { ownerLamports, usdcAtomic: ownedClassicTokenAmount(usdc, owner, USDC_MINT, "USDC", "orca_usdc_account").toString(), usdcAccountExists: true };
}
/** The source account must exist; the destination may be absent (the swap creates it idempotently). */
export function orcaTokenOwnerBalances(pool: OrcaPoolConfig, ownerValue: RawSolanaAccount | null, sourceValue: RawSolanaAccount | null,
  destinationValue: RawSolanaAccount | null, owner: string): OrcaTokenOwnerBalances {
  solanaAddress(owner);
  const ownerLamports = ownerAccountLamports(ownerValue);
  if (sourceValue === null) {
    throw new ApnError("APN_INSUFFICIENT_ASSET", `The owner has no ${pool.symbolA} token account.`, { reason: "orca_source_account_absent" });
  }
  const sourceAtomic = ownedClassicTokenAmount(sourceValue, owner, pool.mintA, pool.symbolA, "orca_source_account").toString();
  if (destinationValue === null) return { ownerLamports, sourceAtomic, destinationAtomic: "0", destinationAccountExists: false };
  return { ownerLamports, sourceAtomic, destinationAccountExists: true,
    destinationAtomic: ownedClassicTokenAmount(destinationValue, owner, pool.mintB, pool.symbolB, "orca_destination_account").toString() };
}

function ownerAccountLamports(account: RawSolanaAccount | null): string {
  if (account === null || account.owner !== SYSTEM_PROGRAM || account.data.length !== 0 || account.executable) {
    return blocked("The owner account is absent or is not a plain system account.", "orca_owner_account");
  }
  return account.lamports.toString();
}
function ownedClassicTokenAmount(account: RawSolanaAccount, owner: string, mint: string, symbol: string, reason: string): bigint {
  if (account.owner !== TOKEN_PROGRAM || account.data.length !== 165) blocked(`The owner's ${symbol} account is not a classic token account.`, reason);
  const token = getTokenDecoder().decode(account.data);
  if (token.owner !== owner || token.mint !== mint || token.state !== 1 || token.isNative.__option !== "None" ||
      token.delegate.__option !== "None" || token.closeAuthority.__option !== "None") {
    blocked(`The owner's ${symbol} account is frozen, delegated, closable by another key, or not the owner's.`, reason);
  }
  return token.amount;
}
/** Simulated post state: the owner stays a plain system account. Throws on any other shape. */
function plainOwner(account: RawSolanaAccount | null): bigint {
  if (account === null || account.owner !== SYSTEM_PROGRAM || account.data.length !== 0 || account.executable) throw new Error();
  return account.lamports;
}
/** Simulated post state: an initialized classic token account of the owner for the mint. Throws on any other shape. */
function tokenAmount(account: RawSolanaAccount | null, owner: string, mint: string): bigint {
  if (account === null || account.owner !== TOKEN_PROGRAM || account.data.length !== 165) throw new Error();
  const token = getTokenDecoder().decode(account.data);
  if (token.owner !== owner || token.mint !== mint || token.state !== 1) throw new Error();
  return token.amount;
}

/** Solana names a transaction error either as a bare variant or as a single-key variant object. */
function classify(error: unknown, logs: unknown): OrcaSimulationReason {
  const named = typeof error === "string" ? error : isPlainRecord(error) ? Object.keys(error)[0] : undefined;
  if (named === "BlockhashNotFound") return "orca_simulation_blockhash_not_found";
  if (named === "InsufficientFundsForFee" || named === "InsufficientFundsForRent") return "orca_simulation_insufficient_funds";
  if (named === "InstructionError") {
    const lines = Array.isArray(logs) ? logs.filter((line): line is string => typeof line === "string").slice(-32) : [];
    // System transfer or token wrap without lamports is an economic refusal, not a protocol fault.
    if (lines.some((line) => /insufficient lamports|insufficient funds/iu.test(line))) return "orca_simulation_insufficient_funds";
    if (lines.some((line) => /AmountOutBelowMinimum/u.test(line))) return "orca_simulation_output_shortfall";
    return "orca_simulation_instruction_error";
  }
  return "orca_simulation_rejected";
}
const CODES: Readonly<Record<OrcaSimulationReason, ErrorCode>> = {
  orca_simulation_unavailable: "APN_RPC_PROTOCOL", orca_simulation_protocol: "APN_RPC_PROTOCOL",
  orca_simulation_blockhash_not_found: "APN_REPREPARE_REQUIRED", orca_simulation_insufficient_funds: "APN_INSUFFICIENT_ASSET",
  orca_simulation_instruction_error: "APN_OPERATION_BLOCKED", orca_simulation_rejected: "APN_OPERATION_BLOCKED",
  orca_simulation_output_shortfall: "APN_OPERATION_BLOCKED", orca_simulation_spend_exceeded: "APN_OPERATION_BLOCKED",
};
function refuse(reason: OrcaSimulationReason): never {
  throw new ApnError(CODES[reason], "The Orca swap simulation refused these exact bytes before any signature.", { reason });
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
