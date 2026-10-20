import { encodeFunctionData, parseAbi } from "viem";
import { ApnError } from "../errors.js";
import { evmRpcHex, evmRpcWord } from "../evm-rpc-codec.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { PERMIT2_ADDRESS } from "./registry.js";
import { observerNonceCalls } from "./production-observer-facts.js";
const TOKEN = parseAbi(["function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner,address spender) view returns (uint256)"]);
/**
 * One batch pinned to the latest block the fence read: payer code, the Permit2 nonce word, balance, allowance and (sponsored) the
 * EIP-2612 nonce. The proxy and Permit2 runtime codes and the token domain were proven at prepare and are not re-read:
 * both contracts are immutable at fixed addresses, and the signature binds the frozen domain.
 */
export function signingCalls(record, block) {
    const p = reconstructPermit2ProductionMaterial(record.material), pinned = { blockHash: block.hash, requireCanonical: true };
    const [bitmap, ...permitNonce] = observerNonceCalls(record.material, block);
    return [{ method: "eth_getCode", params: [p.payer, pinned] }, bitmap,
        { method: "eth_call", params: [{ to: p.token, data: encodeFunctionData({ abi: TOKEN,
                        functionName: "balanceOf", args: [p.payer] }) }, pinned] },
        { method: "eth_call", params: [{ to: p.token, data: encodeFunctionData({ abi: TOKEN,
                        functionName: "allowance", args: [p.payer, PERMIT2_ADDRESS] }) }, pinned] },
        ...permitNonce];
}
export function assertSigningReads(record, values) {
    const p = reconstructPermit2ProductionMaterial(record.material), permit = p.plan.eip2612;
    if (values.length !== (permit === null ? 4 : 5) || evmRpcHex(values[0]) !== "0x" ||
        ((evmRpcWord(values[1]) >> (BigInt(record.material.nonce) & 255n)) & 1n) !== 0n ||
        evmRpcWord(values[2]) < BigInt(p.amountAtomic) ||
        permit === null && evmRpcWord(values[3]) < BigInt(p.amountAtomic) ||
        permit !== null && evmRpcWord(values[4]) !== BigInt(permit.info.nonce))
        blocked();
    // Sponsoring branch allowance is parsed, but neither allowance nor proxy's catch proves permit success.
    evmRpcWord(values[3]);
}
export function assertSigningTime(record, now, block) {
    const p = reconstructPermit2ProductionMaterial(record.material), second = Math.floor(now.getTime() / 1000);
    if (!Number.isSafeInteger(now.getTime()) || now.getTime() < 0 || second < record.material.signingSecond ||
        BigInt(second) >= BigInt(p.plan.authorization.deadline) ||
        p.plan.eip2612 !== null && BigInt(second) >= BigInt(p.plan.eip2612.info.deadline) ||
        block !== undefined && (block.timestamp > BigInt(second) || BigInt(second) - block.timestamp > 30n))
        blocked();
}
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 signing observation is unavailable or outside its frozen window."); }
//# sourceMappingURL=production-signing-facts.js.map