/** Read-only, unsigned Base USDC approval preparation for the Circle V2 WithFees wrapper. */
import { createHash } from "node:crypto";
import { encodeFunctionData, parseAbi } from "viem";
import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { BRIDGE_MIN_REMAINING_MS, BRIDGE_TTL_MS, bridgeAddress, bridgeFailure, bridgeHex, bridgeUint } from "./validation.js";
import { circleV2GasWithinBudget, circleV2NativeWithinBudget, circleV2UsdcCovers } from "./circle-v2-budget.js";
const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SPENDER = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const UINT256_MAX = (1n << 256n) - 1n;
const APPROVE = "apn circle approval prepare";
const abi = parseAbi(["function approve(address spender,uint256 value) returns (bool)"]);
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", `circle_v2_approval_${reason}`); }
function digest(value) { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }
function freeze(value) {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            freeze(child);
        Object.freeze(value);
    }
    return value;
}
export async function prepareCircleV2BaseUsdcApprovalReadOnly(input, readBase, limits, now = Date.now) {
    if (input.chainId !== 8453 || bridgeAddress(input.token) !== TOKEN || bridgeAddress(input.spender) !== SPENDER)
        fail("target");
    // A zero cap is the revoke: approve(wrapper, 0) clears what earlier approvals left (`apn circle approval revoke`).
    const payer = bridgeAddress(input.payer), cap = bridgeUint(input.approvalCapAtomic);
    if (cap === UINT256_MAX)
        fail("unbounded_cap");
    const data = encodeFunctionData({ abi, functionName: "approve", args: [SPENDER, cap] });
    let state;
    try {
        state = await readBase({ chainId: 8453, payer, token: TOKEN, spender: SPENDER, data });
    }
    catch {
        return fail("base_unavailable");
    }
    if (state.chainId !== 8453 || bridgeAddress(state.payer) !== payer ||
        bridgeAddress(state.token) !== TOKEN || bridgeAddress(state.spender) !== SPENDER)
        fail("base_identity");
    const blockNumber = bridgeUint(state.blockNumber), blockHash = bridgeHex(state.blockHash, 32, 32);
    if (bridgeUint(state.latestNonceAtomic) !== bridgeUint(state.pendingNonceAtomic))
        fail("pending_nonce");
    if (cap === 0n && bridgeUint(state.usdcAllowanceAtomic) === 0n)
        throw new ApnError("APN_OPERATION_BLOCKED", "The Circle V2 wrapper allowance of this payer is already 0 on Base; there is nothing to revoke.", { reason: "circle_v2_approval_nothing_to_revoke" });
    if (cap > 0n && bridgeUint(state.usdcAllowanceAtomic) > cap)
        fail("balance_or_allowance");
    circleV2UsdcCovers("circle_v2_approval_balance_or_allowance", APPROVE, "The approval cap", cap, bridgeUint(state.usdcBalanceAtomic));
    const gas = bridgeUint(state.gasLimitAtomic), maxFee = bridgeUint(state.maxFeePerGasWei);
    const priority = bridgeUint(state.maxPriorityFeePerGasWei);
    if (gas === 0n || maxFee === 0n || priority > maxFee)
        fail("gas_or_fee_cap");
    circleV2GasWithinBudget("circle_v2_approval", APPROVE, gas, maxFee, priority, limits);
    const nativeDebit = bridgeUint(state.totalNativeDebitWei);
    if (nativeDebit < gas * maxFee)
        fail("total_fee_under_execution");
    if (nativeDebit > UINT256_MAX)
        fail("native_balance_or_cap");
    circleV2NativeWithinBudget("circle_v2_approval", APPROVE, nativeDebit, bridgeUint(state.nativeBalanceWei), limits.maxNativeDebitWei);
    const current = now();
    if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(limits.ttlMs) ||
        limits.ttlMs < BRIDGE_MIN_REMAINING_MS || limits.ttlMs > BRIDGE_TTL_MS || !Number.isSafeInteger(current + limits.ttlMs))
        fail("ttl");
    const fields = {
        kind: "circle_v2_base_usdc_approval_preparation", executionAdmitted: false,
        baseStateSourceVerified: false, quoteIndicativeOnly: true,
        blockers: ["Base state is supplied by the caller's reader and its origin is not authenticated by this artifact",
            "The Circle quote is indicative only; refresh quote and Base allowance before source submission",
            "No signing or transaction submission has occurred"],
        token: TOKEN, spender: SPENDER, approvalCapAtomic: cap.toString(), observedAllowanceAtomic: bridgeUint(state.usdcAllowanceAtomic).toString(),
        sourceBlock: { number: blockNumber.toString(), hash: blockHash },
        transaction: { type: "eip1559", chainId: 8453, from: payer, to: TOKEN, data,
            valueAtomic: "0", nonceAtomic: bridgeUint(state.latestNonceAtomic).toString(),
            gasLimitAtomic: gas.toString(), maxFeePerGasWei: maxFee.toString(), maxPriorityFeePerGasWei: priority.toString() },
        maximumNativeDebitWei: nativeDebit.toString(), preparedAt: new Date(current).toISOString(),
        expiresAt: new Date(current + limits.ttlMs).toISOString(),
    };
    return freeze({ ...fields, intentDigest: digest(fields) });
}
//# sourceMappingURL=circle-v2-approval-preparation.js.map