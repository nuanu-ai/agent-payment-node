import { encodeFunctionData, parseAbi } from "viem";
import { ApnError } from "../errors.js";
import { evmRpcHex, evmRpcWord } from "../evm-rpc-codec.js";
import type { ReadOnlyRpcBatchCall } from "../rpc.js";
import type { Permit2ProductionRecord } from "./production-repository.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { PERMIT2_ADDRESS } from "./registry.js";
import { observerIdentityCalls, observerNonceCalls, assertObserverIdentity, type Permit2ObservedBlock } from "./production-observer-facts.js";

const TOKEN = parseAbi(["function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)"]);
export function signingIdentityCalls(record: Permit2ProductionRecord, block: Permit2ObservedBlock): readonly ReadOnlyRpcBatchCall[] {
  const p = reconstructPermit2ProductionMaterial(record.material), pinned = { blockHash: block.hash, requireCanonical: true };
  return [...observerIdentityCalls(record.material, block), { method: "eth_getCode", params: [p.payer, pinned] },
    observerNonceCalls(record.material, block)[0]!];
}
export function signingTokenCalls(record: Permit2ProductionRecord, block: Permit2ObservedBlock): readonly ReadOnlyRpcBatchCall[] {
  const p = reconstructPermit2ProductionMaterial(record.material), pinned = { blockHash: block.hash, requireCanonical: true };
  return [{ method: "eth_call", params: [{ to: p.token, data: encodeFunctionData({ abi: TOKEN,
    functionName: "balanceOf", args: [p.payer] }) }, pinned] },
    { method: "eth_call", params: [{ to: p.token, data: encodeFunctionData({ abi: TOKEN,
      functionName: "allowance", args: [p.payer, PERMIT2_ADDRESS] }) }, pinned] },
    ...observerNonceCalls(record.material, block).slice(1)];
}
export function assertSigningIdentity(record: Permit2ProductionRecord, values: readonly unknown[]): void {
  if (values.length !== 5) blocked();
  assertObserverIdentity(record.material, values.slice(0, 3));
  if (evmRpcHex(values[3]) !== "0x" || ((evmRpcWord(values[4]) >> (BigInt(record.material.nonce) & 255n)) & 1n) !== 0n) blocked();
}
export function assertSigningTokens(record: Permit2ProductionRecord, values: readonly unknown[]): void {
  const p = reconstructPermit2ProductionMaterial(record.material), permit = p.plan.eip2612;
  if (values.length !== (permit === null ? 2 : 3) || evmRpcWord(values[0]) < BigInt(p.amountAtomic) ||
      permit === null && evmRpcWord(values[1]) < BigInt(p.amountAtomic) ||
      permit !== null && evmRpcWord(values[2]) !== BigInt(permit.info.nonce)) blocked();
  // Sponsoring branch allowance is parsed, but neither allowance nor proxy's catch proves permit success.
  evmRpcWord(values[1]);
}
export function assertSigningTime(record: Permit2ProductionRecord, now: Date, block?: Permit2ObservedBlock): void {
  const p = reconstructPermit2ProductionMaterial(record.material), second = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(now.getTime()) || now.getTime() < 0 || second < record.material.signingSecond ||
      BigInt(second) >= BigInt(p.plan.authorization.deadline) ||
      p.plan.eip2612 !== null && BigInt(second) >= BigInt(p.plan.eip2612.info.deadline) ||
      block !== undefined && (block.timestamp > BigInt(second) || BigInt(second) - block.timestamp > 30n)) blocked();
}
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 signing observation is unavailable or outside its frozen window."); }
