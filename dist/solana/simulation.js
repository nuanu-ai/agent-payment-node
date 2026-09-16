import { isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { rpcAtomic, rpcRecord } from "./rpc.js";
const CODES = {
    solana_simulation_unavailable: "APN_RPC_PROTOCOL",
    solana_simulation_protocol: "APN_RPC_PROTOCOL",
    solana_simulation_blockhash_not_found: "APN_REPREPARE_REQUIRED",
    solana_simulation_already_processed: "APN_REPREPARE_REQUIRED",
    solana_simulation_insufficient_funds: "APN_REPREPARE_REQUIRED",
    solana_simulation_instruction_error: "APN_PROVIDER_EFFECT_UNAVAILABLE",
    solana_simulation_rejected: "APN_PROVIDER_EFFECT_UNAVAILABLE",
};
/**
 * Runs the exact unsigned bytes through the validator before anything is signed. `sigVerify: false`
 * makes the zero-filled signature slots irrelevant and simulation produces no on-chain effect, so
 * this is a read: a transaction that would fail on chain is refused while no signature exists.
 */
export async function simulateSolanaSend(rpc, unsignedPayload) {
    let response;
    try {
        response = await rpc.call("simulateTransaction", [unsignedPayload, {
                sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed", encoding: "base64", innerInstructions: false,
            }]);
    }
    catch {
        return simulationFailure("solana_simulation_unavailable");
    }
    let slot;
    let value;
    try {
        const record = rpcRecord(response);
        slot = rpcAtomic(rpcRecord(record.context).slot);
        value = rpcRecord(record.value);
        if (value.err === undefined)
            return simulationFailure("solana_simulation_protocol");
    }
    catch {
        return simulationFailure("solana_simulation_protocol");
    }
    // A named refusal is answered before any shape check on the rest, which a refusal need not carry.
    if (value.err !== null)
        return simulationFailure(classify(value.err));
    let units;
    try {
        units = rpcAtomic(value.unitsConsumed);
    }
    catch {
        return simulationFailure("solana_simulation_protocol");
    }
    // A successful simulation that consumed nothing executed nothing, so it proves nothing about these bytes.
    if (units === 0n)
        return simulationFailure("solana_simulation_protocol");
    return { outcome: "would_succeed", slotAtomic: slot.toString(), unitsConsumedAtomic: units.toString(),
        signatureVerified: false, payloadHash: sha256(unsignedPayload) };
}
/** Solana names a transaction error either as a bare variant or as a single-key variant object. */
function classify(error) {
    const named = typeof error === "string" ? error : isPlainRecord(error) ? Object.keys(error)[0] : undefined;
    if (named === "BlockhashNotFound")
        return "solana_simulation_blockhash_not_found";
    if (named === "AlreadyProcessed" || named === "DuplicateInstruction")
        return "solana_simulation_already_processed";
    if (named === "InsufficientFundsForFee" || named === "InsufficientFundsForRent")
        return "solana_simulation_insufficient_funds";
    if (named === "InstructionError")
        return "solana_simulation_instruction_error";
    return "solana_simulation_rejected";
}
function simulationFailure(reason) {
    throw new ApnError(CODES[reason], "The Solana pre-send simulation refused these bytes before any signature.", { reason });
}
//# sourceMappingURL=simulation.js.map