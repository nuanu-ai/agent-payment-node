import { encodeFunctionData, getAddress, parseAbi } from "viem";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { USDT_GASLESS, usdtFailure } from "./model.js";
const TOKEN_ABI = parseAbi(["function approve(address spender,uint256 value) returns (bool)", "function transfer(address to,uint256 value) returns (bool)"]);
const ACCOUNT_ABI = parseAbi(["function executeBatch((address target,uint256 value,bytes data)[] calls)"]);
const STUB_WORD = `0x${"11".repeat(32)}`;
export const USDT_PREPARE_STUB_WORD = STUB_WORD;
const DIGEST = /^[0-9a-f]{64}$/u;
export function frozenCopy(value) {
    const copy = structuredClone(value);
    const freeze = (entry) => {
        if (entry !== null && typeof entry === "object") {
            for (const nested of Object.values(entry))
                freeze(nested);
            Object.freeze(entry);
        }
    };
    freeze(copy);
    return copy;
}
export function canonicalAddress(value) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value))
        usdtFailure("APN_INVALID_INPUT", "gasless_usdt_address");
    try {
        if (getAddress(value) === value)
            return value;
    }
    catch { /* refused below */ }
    usdtFailure("APN_INVALID_INPUT", "gasless_usdt_address");
}
export function requirePolicy(active, request, usage, now) {
    if (active === null)
        usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_required");
    if (active.profile !== request.profile || active.accounts.evm !== request.sender || active.digest !== active.registry.policyDigest ||
        !DIGEST.test(active.digest) || !DIGEST.test(active.activationDigest) || !Number.isSafeInteger(active.revision) || active.revision < 1) {
        usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_identity");
    }
    const admission = evaluateAssetPolicy(active.registry, { chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token },
        rail: "gasless", amountAtomic: request.grossAtomic.toString(), dailyUsageAtomic: usage,
        asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    if (admission.asset.mechanismPins?.gasless?.provider !== USDT_GASLESS.mechanism.provider ||
        admission.asset.mechanismPins.gasless.reference !== USDT_GASLESS.mechanism.reference ||
        BigInt(admission.caps.maximumPerTransferAtomic) <= 0n || BigInt(admission.caps.dailyLimitAtomic) <= 0n) {
        usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_mechanism");
    }
    return active;
}
export function usdtApprovalTransferBatch(plan) {
    const approveZero = encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [USDT_GASLESS.paymaster, 0n] });
    const approveExact = encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [USDT_GASLESS.paymaster, plan.feeCapAtomic] });
    const transfer = encodeFunctionData({ abi: TOKEN_ABI, functionName: "transfer", args: [plan.request.recipient, plan.netAtomic] });
    return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeBatch", args: [[
                { target: USDT_GASLESS.token, value: 0n, data: approveZero },
                { target: USDT_GASLESS.token, value: 0n, data: approveExact },
                { target: USDT_GASLESS.token, value: 0n, data: transfer },
            ]] });
}
//# sourceMappingURL=policy-prepare.js.map