import { ApnError } from "./errors.js";
export const COINBASE_OBSERVATION_ORIGIN = "https://base-rpc.publicnode.com";
export function coinbaseObservationPreset(value) {
    if (value !== "publicnode-base")
        throw new ApnError("APN_INVALID_INPUT", "Coinbase observation RPC requires the publicnode-base preset.");
    return value;
}
export function assertCoinbaseObservationRequest(operation, preset, conflict) {
    coinbaseObservationPreset(preset);
    if (conflict || operation.providerDirect?.providerId !== "coinbase-agentic-wallet" ||
        operation.providerDirect.coinbaseGasless === undefined || operation.terminal ||
        (operation.state !== "started" && operation.state !== "ambiguous_effect")) {
        throw new ApnError("APN_INVALID_INPUT", "Coinbase observation RPC requires a started or ambiguous saved AWAL gasless operation and no other observation or wait options.");
    }
}
export function validCoinbaseObservationSource(value, origin) {
    if (value === undefined)
        return true;
    return value !== null && typeof value === "object" && !Array.isArray(value) &&
        Object.keys(value).sort().join(",") === "callRpcOrigin,logsRpcOrigin,policy,preset" &&
        value.policy === "apn.coinbase-gasless.observation-source.v1" && typeof value.callRpcOrigin === "string" &&
        /^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/u.test(value.callRpcOrigin) && value.callRpcOrigin === origin &&
        value.logsRpcOrigin === COINBASE_OBSERVATION_ORIGIN && value.preset === "publicnode-base";
}
export function validCoinbaseSettlementKeys(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    const row = value;
    const keys = ["schemaVersion", "userOperationHash", "transactionHash", "nonceAtomic", "paymaster",
        "paymasterCodeHash", "block", "safeBlock", "evidenceHash", "grossAtomic", "netAtomic", "feeAtomic", "senderNativeDebitWei",
        ...(row.observationSource === undefined ? [] : ["observationSource"])];
    return Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
}
//# sourceMappingURL=coinbase-gasless-observation-source.js.map