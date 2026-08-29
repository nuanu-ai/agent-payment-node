import { ApnError } from "./errors.js";
export function x402ReadPort(rpc) {
    const value = rpc;
    return typeof value.getX402Head === "function" && typeof value.getX402Block === "function" &&
        typeof value.getX402Receipt === "function" && typeof value.getX402AuthorizationState === "function" &&
        typeof value.getX402AuthorizationUsedLogs === "function" ? value : null;
}
export function boundedX402ReadPort(rpc, timeoutMs) {
    const port = x402ReadPort(rpc);
    if (port === null || typeof port.withTotalTimeout !== "function")
        return null;
    return port.withTotalTimeout(timeoutMs);
}
export async function assertWaitRpcProvenance(rpc, operation) {
    const chain = await rpc.assertBaseChain();
    if (chain.chainId !== 8453 || typeof chain.rpcOrigin !== "string" || chain.rpcOrigin.length === 0) {
        throw new ApnError("APN_CHAIN_MISMATCH", "Settlement wait RPC is not Base chain ID 8453.");
    }
    const safe = await rpc.getX402Head("safe");
    const observedAt = Date.parse(safe.observedAt);
    if (safe.queriedTag !== "safe" || safe.rpcOrigin !== chain.rpcOrigin ||
        !/^(?:0|[1-9][0-9]*)$/u.test(safe.number) ||
        !/^(?:0|[1-9][0-9]*)$/u.test(safe.timestamp) ||
        !/^0x[0-9a-f]{64}$/u.test(safe.hash) || /^0x0{64}$/u.test(safe.hash) ||
        !Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== safe.observedAt ||
        BigInt(safe.timestamp) > BigInt(Math.floor(observedAt / 1_000)) ||
        BigInt(safe.number) < BigInt(operation.preparedBlock.number)) {
        throw new ApnError("APN_RPC_PROTOCOL", "Settlement wait RPC provenance is unsafe.");
    }
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
//# sourceMappingURL=x402-service-rpc.js.map