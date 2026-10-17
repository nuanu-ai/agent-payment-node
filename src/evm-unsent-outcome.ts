/**
 * Proof that a signed EVM transaction which never crossed its send fence can never land.
 *
 * Its account nonce at the safe head is already past the signed nonce, so another transaction consumed that nonce
 * at safe depth, and the node does not know the signed hash, so it is not that transaction. The signed bytes can
 * then never be included; the effect may end as "never landed" and its hold be released. Any other read keeps the
 * effect resumable (nonce not consumed) or under normal observation (own transaction known).
 */
import { ApnError } from "./errors.js";

export type EvmUnsentOutcomeRead = (method: "eth_getTransactionCount" | "eth_getTransactionByHash",
  params: readonly unknown[]) => Promise<unknown>;
export type EvmUnsentOutcome = "never_lands" | "nonce_not_consumed" | "own_transaction_known";

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value))
    throw new ApnError("APN_RPC_PROTOCOL", "EVM nonce read is malformed.");
  return BigInt(value);
}

export async function evmUnsentOutcome(read: EvmUnsentOutcomeRead, input: Readonly<{
  account: string; nonce: bigint; transactionHash: string }>): Promise<EvmUnsentOutcome> {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(input.account) || !/^0x[0-9a-fA-F]{64}$/u.test(input.transactionHash) || input.nonce < 0n)
    throw new ApnError("APN_INVALID_INPUT", "Unsent EVM effect identity is invalid.");
  if (quantity(await read("eth_getTransactionCount", [input.account, "safe"])) <= input.nonce) return "nonce_not_consumed";
  return await read("eth_getTransactionByHash", [input.transactionHash]) === null ? "never_lands" : "own_transaction_known";
}

/**
 * The same proof for bytes that MAY have been broadcast (an ambiguous send): the nonce at the safe head is past the
 * signed nonce, and the node knows neither the transaction nor a receipt for its hash. Another transaction then took
 * that nonce, so these bytes can never land. A known transaction or receipt means observe only.
 */
export async function evmSentOutcome(read: (method: "eth_getTransactionCount" | "eth_getTransactionByHash" | "eth_getTransactionReceipt",
  params: readonly unknown[]) => Promise<unknown>, input: Readonly<{ account: string; nonce: bigint; transactionHash: string }>): Promise<EvmUnsentOutcome> {
  const outcome = await evmUnsentOutcome(read, input);
  if (outcome !== "never_lands") return outcome;
  return await read("eth_getTransactionReceipt", [input.transactionHash]) === null ? "never_lands" : "own_transaction_known";
}
