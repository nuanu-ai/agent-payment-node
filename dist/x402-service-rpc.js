import { x402Network } from "./x402-network.js";
import { ApnError } from "./errors.js";
export function selectX402Rpc(rpc, chainId = 8453) {
    x402Network(chainId);
    if (chainId === 8453)
        return rpc;
    if (rpc.forX402Network === undefined)
        throw new ApnError("APN_RPC_CONFIG", "RPC adapter lacks explicit x402 network support.");
    return rpc.forX402Network(chainId);
}
export async function assertX402RpcChain(rpc, chainId = 8453) {
    const chain = await rpc.assertX402Chain?.(chainId);
    if (chain === undefined || chain.chainId !== chainId || !chain.rpcOrigin) {
        throw new ApnError("APN_CHAIN_MISMATCH", "RPC does not prove the frozen x402 network.");
    }
    return chain;
}
/** The production RPC adapter always carries the x402 read surface; an adapter without it cannot observe x402. */
export function x402ReadPort(rpc, chainId = 8453) {
    const value = selectX402Rpc(rpc, chainId);
    if (typeof value.getX402Head !== "function" || typeof value.getX402Block !== "function" ||
        typeof value.getX402Receipt !== "function" || typeof value.getX402AuthorizationState !== "function" ||
        typeof value.getX402AuthorizationUsedLogs !== "function")
        missingX402ReadSurface();
    return value;
}
export function boundedX402ReadPort(rpc, timeoutMs, chainId = 8453) {
    const port = x402ReadPort(rpc, chainId);
    if (typeof port.withTotalTimeout !== "function")
        missingX402ReadSurface();
    return port.withTotalTimeout(timeoutMs);
}
function missingX402ReadSurface() {
    throw new ApnError("APN_OPERATION_BLOCKED", "Settlement wait requires the read-only x402 RPC surface.");
}
/**
 * A settlement wait first proves the endpoint's chain (read once per invocation and endpoint). The safe head is not
 * read here: every poll reads it inside authorizationState, and the reconciler ignores a safe head behind the prepared block.
 */
export async function assertWaitRpcProvenance(rpc, operation) {
    await assertX402RpcChain(rpc, x402Network(operation.network).chainId);
}
export function isRecoverableX402RpcObservationFailure(error) {
    return error instanceof ApnError && [
        "APN_RPC_AMBIGUOUS",
        "APN_RPC_PROTOCOL",
        "APN_RPC_CONFIG",
        "APN_CHAIN_MISMATCH",
    ].includes(error.code);
}
export function isPostExposureWaitState(operation) {
    return operation.attempts.some((attempt) => attempt.purpose === "payment") && [
        "paid_request_pending",
        "settlement_pending",
        "effect_unknown",
        "seller_result_recovery_pending",
    ].includes(operation.state);
}
export function terminalClassification(state) {
    return state === "completed"
        ? { reason: "x402_completed", proofClass: "x402_safe_settlement" }
        : state === "failed_before_effect"
            ? { reason: "x402_failed_before_effect", proofClass: "x402_proven_no_effect" }
            : state === "failed_expired_unused"
                ? { reason: "x402_failed_expired_unused", proofClass: "x402_expired_unused_finalized" }
                : state === "abandoned_unknown"
                    ? { reason: "x402_owner_abandoned_unknown", proofClass: "x402_owner_acknowledgement_only" }
                    : { reason: "x402_failed_settled_without_result", proofClass: "x402_settled_result_unavailable" };
}
export function settlementResponseTransaction(response) {
    try {
        const value = JSON.parse(response.normalizedCanonicalJson);
        return typeof value.transaction === "string" ? value.transaction : undefined;
    }
    catch {
        return undefined;
    }
}
export function remainingWaitMs(deadline, nowMs) {
    return Math.floor(deadline - nowMs);
}
export function waitTimeout(seconds, observations) {
    return waitOutcome("timeout", seconds, observations);
}
export function waitOutcome(outcome, seconds, observations) {
    return { outcome, requestedSeconds: seconds.toString(), observationCount: observations.toString() };
}
//# sourceMappingURL=x402-service-rpc.js.map