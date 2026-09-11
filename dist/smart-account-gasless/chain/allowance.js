import { encodeFunctionData, parseAbi } from "viem";
import { SA_MAX_UINT } from "../model.js";
import { saFail } from "../reasons.js";
import { saRegistry } from "../registry.js";
import { SA_CURRENT_NONCE_SELECTOR, SA_GET_AVAILABLE_SELECTOR, SA_SPENT_MAP_SELECTOR, quantity, rpcHex } from "./abi.js";
const ALLOWANCE_ABI = parseAbi([
    "function getAvailableAmount(bytes32 delegationHash,address delegationManager,bytes terms) view returns (uint256 availableAmount,bool isNewPeriod,uint256 currentPeriod)",
]);
const NONCE_ABI = parseAbi([
    "function currentNonce(address delegationManager,address delegator) view returns (uint256 nonce)",
]);
const SPENT_ABI = parseAbi([
    "function spentMap(address delegationManager,bytes32 delegationHash) view returns (uint256 amount)",
]);
export function validatePeriodTerms(binding) {
    const registry = saRegistry(8453), terms = rpcHex(binding.periodTerms, 116, 116);
    const amount = BigInt(`0x${terms.slice(42, 106)}`), duration = BigInt(`0x${terms.slice(106, 170)}`);
    const start = BigInt(`0x${terms.slice(170, 234)}`);
    if (terms.slice(0, 42) !== registry.token.address || amount.toString() !== binding.rootCapAtomic ||
        duration !== SA_MAX_UINT || start !== BigInt(binding.rootStartsAtUnix))
        saFail("sa_gasless_permission");
}
/** Exact 96-byte return validation intentionally does not use a permissive ABI decoder. */
export async function readCurrentAllowance(call, binding, block) {
    validatePeriodTerms(binding);
    const registry = saRegistry(8453);
    const data = encodeFunctionData({ abi: ALLOWANCE_ABI, functionName: "getAvailableAmount",
        args: [binding.rootDelegationHash, binding.delegationManager, binding.periodTerms] });
    if (!data.startsWith(SA_GET_AVAILABLE_SELECTOR))
        saFail("sa_gasless_internal");
    const result = rpcHex(await call("eth_call", [{ to: registry.protocol.period.address, data },
        quantity(BigInt(block.numberAtomic))]), 96, 96);
    const available = BigInt(`0x${result.slice(2, 66)}`), boolWord = result.slice(66, 130);
    const period = BigInt(`0x${result.slice(130, 194)}`);
    if (boolWord !== "0".repeat(64) && boolWord !== `${"0".repeat(63)}1`)
        saFail("sa_gasless_evidence");
    if (available > BigInt(binding.rootCapAtomic))
        saFail("sa_gasless_evidence");
    return { availableAtomic: available.toString(), isNewPeriod: boolWord.endsWith("1"),
        currentPeriodAtomic: period.toString() };
}
export async function readCurrentNonce(call, binding, block) {
    const registry = saRegistry(8453);
    const data = encodeFunctionData({ abi: NONCE_ABI, functionName: "currentNonce",
        args: [binding.delegationManager, binding.ownerAddress] });
    if (!data.startsWith(SA_CURRENT_NONCE_SELECTOR))
        saFail("sa_gasless_internal");
    const result = rpcHex(await call("eth_call", [{ to: registry.protocol.nonce.address, data },
        quantity(BigInt(block.numberAtomic))]), 32, 32);
    const current = BigInt(result).toString();
    if (current !== binding.rootNonceAtomic)
        saFail("sa_gasless_permission");
    return current;
}
export async function readChildSpent(call, manager, childHash, block) {
    const registry = saRegistry(8453);
    const data = encodeFunctionData({ abi: SPENT_ABI, functionName: "spentMap", args: [manager, childHash] });
    if (!data.startsWith(SA_SPENT_MAP_SELECTOR))
        saFail("sa_gasless_internal");
    const result = rpcHex(await call("eth_call", [{ to: registry.protocol.amount.address, data },
        quantity(BigInt(block.numberAtomic))]), 32, 32);
    return BigInt(result).toString();
}
//# sourceMappingURL=allowance.js.map