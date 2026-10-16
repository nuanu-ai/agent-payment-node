import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { EvmRpcCall } from "../evm-ports.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity } from "../evm-rpc-codec.js";
import { rpcArray, rpcAtomic, rpcRecord, solanaSignature, type SolanaRpcPort } from "../solana/rpc.js";
import type { SwapOperationRecord } from "./model.js";

export const SWAP_UNLANDED_PROOF_SCHEMA = "apn.swap-expired-unlanded-proof.v1" as const;

/**
 * Chain evidence that a marked swap effect can never land. The bound fields (network, transaction identity and the
 * lifetime bound) are stable for one operation, so a retried terminal transition reproduces the same outcome digest.
 * The observed fields record what proved the bound passed; they are reported but not part of the digest.
 */
export type SwapUnlandedProof =
  | { readonly network: "solana"; readonly transactionId: string | null; readonly lastValidBlockHeight: string;
      readonly observedFinalizedBlockHeight: string }
  | { readonly network: "evm"; readonly transactionId: string | null; readonly deadlineSeconds: string;
      readonly observedFinalizedBlockNumber: string; readonly observedFinalizedTimestamp: string }
  | { readonly network: "tron"; readonly transactionId: string; readonly expirationMs: string;
      readonly observedSolidifiedBlockNumber: string; readonly observedSolidifiedTimestampMs: string };

const UINT = /^(?:0|[1-9][0-9]{0,77})$/u;

export function validateSwapUnlandedProof(value: unknown, chain: string): SwapUnlandedProof {
  if (!isPlainRecord(value)) invalid();
  const network = value.network;
  const expected = /^solana:/u.test(chain) ? "solana" : /^eip155:/u.test(chain) ? "evm" : /^tron:/u.test(chain) ? "tron" : null;
  if (network !== expected) invalid();
  if (network === "solana") {
    if (!exactKeys(value, ["network", "transactionId", "lastValidBlockHeight", "observedFinalizedBlockHeight"]) ||
        (value.transactionId !== null && solanaSignature(value.transactionId) !== value.transactionId) ||
        !uint(value.lastValidBlockHeight) || !uint(value.observedFinalizedBlockHeight) ||
        BigInt(value.observedFinalizedBlockHeight as string) <= BigInt(value.lastValidBlockHeight as string)) invalid();
  } else if (network === "evm") {
    if (!exactKeys(value, ["network", "transactionId", "deadlineSeconds", "observedFinalizedBlockNumber", "observedFinalizedTimestamp"]) ||
        (value.transactionId !== null && (typeof value.transactionId !== "string" || !/^0x[a-f0-9]{64}$/u.test(value.transactionId))) ||
        !uint(value.deadlineSeconds) || !uint(value.observedFinalizedBlockNumber) || !uint(value.observedFinalizedTimestamp) ||
        BigInt(value.observedFinalizedTimestamp as string) <= BigInt(value.deadlineSeconds as string)) invalid();
  } else if (!exactKeys(value, ["network", "transactionId", "expirationMs", "observedSolidifiedBlockNumber", "observedSolidifiedTimestampMs"]) ||
      typeof value.transactionId !== "string" || !/^[a-f0-9]{64}$/u.test(value.transactionId) || !uint(value.expirationMs) ||
      !uint(value.observedSolidifiedBlockNumber) || !uint(value.observedSolidifiedTimestampMs) ||
      BigInt(value.observedSolidifiedTimestampMs as string) <= BigInt(value.expirationMs as string)) invalid();
  return value as unknown as SwapUnlandedProof;
}

/** The terminal outcome digest: one value per operation and transaction identity, independent of when it was observed. */
export function swapUnlandedProofHash(operation: SwapOperationRecord, proof: SwapUnlandedProof): string {
  const bound = proof.network === "solana" ? proof.lastValidBlockHeight : proof.network === "evm" ? proof.deadlineSeconds : proof.expirationMs;
  return domainHash(SWAP_UNLANDED_PROOF_SCHEMA, canonicalJson({ operationId: operation.operationId,
    markerHash: operation.submissionMarker?.markerHash ?? null, network: proof.network, transactionId: proof.transactionId, bound }));
}

/**
 * Solana: the finalized block height passed the message's lastValidBlockHeight, so no later block can include it, and
 * the signature (when one was ever persisted) has no status with full history. The height is read first: a signature
 * persisted afterwards can only be sent into an expired lifetime. Two reads at most.
 */
export async function proveSolanaUnlanded(rpc: Pick<SolanaRpcPort, "call">, input: { readonly lastValidBlockHeight: string;
  readonly loadSignature: () => Promise<string | null> }): Promise<SwapUnlandedProof | null> {
  const lastValid = BigInt(input.lastValidBlockHeight);
  const finalized = rpcAtomic(await rpc.call("getBlockHeight", [{ commitment: "finalized" }]));
  if (finalized <= lastValid) return null;
  const signature = await input.loadSignature();
  if (signature !== null) {
    const statuses = rpcArray(rpcRecord(await rpc.call("getSignatureStatuses", [[solanaSignature(signature)], { searchTransactionHistory: true }])).value, 1);
    if (statuses.length !== 1) throw new ApnError("APN_RPC_PROTOCOL", "Solana signature status response is incomplete.");
    if (statuses[0] !== null) return null;
  }
  return { network: "solana", transactionId: signature, lastValidBlockHeight: lastValid.toString(),
    observedFinalizedBlockHeight: finalized.toString() };
}

/**
 * EVM: the finalized block's timestamp passed the router deadline, so any later inclusion reverts and the input cannot
 * move, and the signed transaction (when one was ever persisted) has no receipt up to that finalized block.
 */
export async function proveEvmUnlanded(call: EvmRpcCall, input: { readonly chainId: bigint; readonly deadlineSeconds: number;
  readonly loadTransactionHash: () => Promise<string | null> }): Promise<SwapUnlandedProof | null> {
  if (!Number.isSafeInteger(input.deadlineSeconds) || input.deadlineSeconds <= 0) invalid();
  if (evmRpcQuantity(await call("eth_chainId", [])) !== input.chainId) throw new ApnError("APN_CHAIN_MISMATCH", "Swap expiry proof requires the exact EVM chain.");
  const block = await evmRpcBlock(call, "finalized"), timestamp = evmRpcQuantity(block.raw.timestamp);
  if (timestamp <= BigInt(input.deadlineSeconds)) return null;
  const hash = await input.loadTransactionHash();
  if (hash !== null) {
    const exact = evmRpcHex(hash, 32).toLowerCase();
    if (await call("eth_getTransactionReceipt", [exact]) !== null) return null;
  }
  return { network: "evm", transactionId: hash === null ? null : hash.toLowerCase(), deadlineSeconds: String(input.deadlineSeconds),
    observedFinalizedBlockNumber: block.number, observedFinalizedTimestamp: timestamp.toString() };
}

export type TronUnlandedMethod = "walletsolidity/getnowblock" | "walletsolidity/gettransactionbyid" | "walletsolidity/gettransactioninfobyid";
/**
 * TRON: the solidified head's timestamp passed the transaction expiration, so no later block may include it, and the
 * solidified node has neither the transaction nor its info. Every earlier block is already solidified.
 */
export async function proveTronUnlanded(rpc: { call(method: TronUnlandedMethod, body: Readonly<Record<string, unknown>>): Promise<unknown> },
  input: { readonly transactionId: string; readonly expirationMs: string }): Promise<SwapUnlandedProof | null> {
  if (!/^[a-f0-9]{64}$/u.test(input.transactionId) || !uint(input.expirationMs)) invalid();
  const header = record(record(record(await rpc.call("walletsolidity/getnowblock", {})).block_header).raw_data);
  const number = integer(header.number), timestamp = integer(header.timestamp);
  if (timestamp <= BigInt(input.expirationMs)) return null;
  const [transaction, info] = [await rpc.call("walletsolidity/gettransactionbyid", { value: input.transactionId }),
    await rpc.call("walletsolidity/gettransactioninfobyid", { value: input.transactionId })];
  if (!empty(transaction) || !empty(info)) return null;
  return { network: "tron", transactionId: input.transactionId, expirationMs: input.expirationMs,
    observedSolidifiedBlockNumber: number.toString(), observedSolidifiedTimestampMs: timestamp.toString() };
}

function empty(value: unknown): boolean { return isPlainRecord(value) && Object.keys(value).length === 0; }
function record(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new ApnError("APN_RPC_PROTOCOL", "TRON solidified block response is malformed.");
  return value;
}
function integer(value: unknown): bigint {
  if ((typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) && (typeof value !== "string" || !UINT.test(value)) &&
      typeof value !== "bigint") throw new ApnError("APN_RPC_PROTOCOL", "TRON solidified block number or time is malformed.");
  return BigInt(value as string | number | bigint);
}
function uint(value: unknown): value is string { return typeof value === "string" && UINT.test(value); }
function invalid(): never { throw new ApnError("APN_INVALID_INPUT", "Swap expiry proof is invalid."); }
