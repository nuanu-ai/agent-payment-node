import { getTokenDecoder } from "@solana-program/token";
import { canonicalJson, domainHash, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { rpcArray, rpcAtomic, rpcRecord, solanaAddress } from "../../solana/rpc.js";
import { rawAccount } from "./accounts.js";
import { SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT } from "./pins.js";
/**
 * Runs the exact unsigned bytes with `sigVerify: false` and reads back the owner's lamports, the wSOL account and the
 * USDC account. The Whirlpool program itself enforces `other_amount_threshold`; APN additionally requires the USDC
 * delta to reach the minimum, the wSOL account to be closed, and the SOL spend to stay inside input + fee + rent.
 */
export async function simulateOrcaSwap(rpc, unsignedPayload, bounds, replaceRecentBlockhash, minContextSlot) {
    if (!/^[1-9][0-9]{0,15}$/u.test(minContextSlot))
        throw new ApnError("APN_INVALID_INPUT", "Orca simulation context slot is invalid.");
    // The simulation may not run on a node behind the slot the balances and pool state were read at.
    const params = [unsignedPayload, { sigVerify: false, replaceRecentBlockhash, commitment: "confirmed", encoding: "base64",
            minContextSlot: Number(minContextSlot), accounts: { encoding: "base64", addresses: [bounds.owner, bounds.wsolAccount, bounds.usdcAccount] } }];
    let response;
    try {
        response = await rpc.call("simulateTransaction", params);
    }
    catch (error) {
        if (error instanceof ApnError && error.code === "APN_RPC_CONFIG")
            throw error;
        return refuse("orca_simulation_unavailable");
    }
    let slot, value;
    try {
        const record = rpcRecord(response);
        slot = rpcAtomic(rpcRecord(record.context).slot);
        value = rpcRecord(record.value);
    }
    catch {
        return refuse("orca_simulation_protocol");
    }
    if (value.err === undefined)
        refuse("orca_simulation_protocol");
    if (value.err !== null)
        refuse(classify(value.err, value.logs));
    let units, ownerAfter, usdcAfter;
    try {
        units = rpcAtomic(value.unitsConsumed);
        const accounts = rpcArray(value.accounts, 3);
        if (accounts.length !== 3)
            throw new Error();
        const owner = accounts[0] === null ? null : rawAccount(accounts[0], 0);
        const wsol = accounts[1] === null ? null : rawAccount(accounts[1], 165);
        const usdc = accounts[2] === null ? null : rawAccount(accounts[2], 165);
        if (owner === null || owner.owner !== SYSTEM_PROGRAM || owner.data.length !== 0 || owner.executable)
            throw new Error();
        // A closed account simulates as absent or as an empty, zero-lamport system account.
        if (wsol !== null && (wsol.lamports !== 0n || wsol.data.length !== 0 || wsol.owner !== SYSTEM_PROGRAM))
            throw new Error();
        if (usdc === null || usdc.owner !== TOKEN_PROGRAM || usdc.data.length !== 165)
            throw new Error();
        const token = getTokenDecoder().decode(usdc.data);
        if (token.owner !== bounds.owner || token.mint !== USDC_MINT || token.state !== 1)
            throw new Error();
        ownerAfter = owner.lamports;
        usdcAfter = token.amount;
    }
    catch {
        return refuse("orca_simulation_protocol");
    }
    if (units === 0n || units > BigInt(bounds.computeUnitLimit) || slot < BigInt(minContextSlot))
        refuse("orca_simulation_protocol");
    const received = usdcAfter - BigInt(bounds.before.usdcAtomic), spent = BigInt(bounds.before.ownerLamports) - ownerAfter;
    if (received < BigInt(bounds.minimumOutputAtomic))
        refuse("orca_simulation_output_shortfall");
    if (spent > BigInt(bounds.maximumSolSpendLamports))
        refuse("orca_simulation_spend_exceeded");
    const result = { slot: slot.toString(), unitsConsumed: units.toString(), ownerLamportsAfter: ownerAfter.toString(),
        usdcAtomicAfter: usdcAfter.toString(), usdcReceivedAtomic: received.toString(), solSpentLamports: spent.toString() };
    return { requestHash: domainHash("apn.orca-simulation-request.v1", canonicalJson(params)),
        resultHash: domainHash("apn.orca-simulation-result.v1", canonicalJson(result)), replaceRecentBlockhash, ...result };
}
export function orcaOwnerBalances(ownerValue, usdcValue, owner) {
    solanaAddress(owner);
    const ownerAccount = ownerValue, usdc = usdcValue;
    if (ownerAccount === null || ownerAccount.owner !== SYSTEM_PROGRAM || ownerAccount.data.length !== 0 || ownerAccount.executable) {
        return blocked("The owner account is absent or is not a plain system account.", "orca_owner_account");
    }
    if (usdc === null)
        return { ownerLamports: ownerAccount.lamports.toString(), usdcAtomic: "0", usdcAccountExists: false };
    if (usdc.owner !== TOKEN_PROGRAM || usdc.data.length !== 165)
        blocked("The owner's USDC account is not a classic token account.", "orca_usdc_account");
    const token = getTokenDecoder().decode(usdc.data);
    if (token.owner !== owner || token.mint !== USDC_MINT || token.state !== 1 || token.isNative.__option !== "None" ||
        token.delegate.__option !== "None" || token.closeAuthority.__option !== "None") {
        blocked("The owner's USDC account is frozen, delegated, closable by another key, or not the owner's.", "orca_usdc_account");
    }
    return { ownerLamports: ownerAccount.lamports.toString(), usdcAtomic: token.amount.toString(), usdcAccountExists: true };
}
/** Solana names a transaction error either as a bare variant or as a single-key variant object. */
function classify(error, logs) {
    const named = typeof error === "string" ? error : isPlainRecord(error) ? Object.keys(error)[0] : undefined;
    if (named === "BlockhashNotFound")
        return "orca_simulation_blockhash_not_found";
    if (named === "InsufficientFundsForFee" || named === "InsufficientFundsForRent")
        return "orca_simulation_insufficient_funds";
    if (named === "InstructionError") {
        const lines = Array.isArray(logs) ? logs.filter((line) => typeof line === "string").slice(-32) : [];
        // System transfer or token wrap without lamports is an economic refusal, not a protocol fault.
        if (lines.some((line) => /insufficient lamports|insufficient funds/iu.test(line)))
            return "orca_simulation_insufficient_funds";
        if (lines.some((line) => /AmountOutBelowMinimum/u.test(line)))
            return "orca_simulation_output_shortfall";
        return "orca_simulation_instruction_error";
    }
    return "orca_simulation_rejected";
}
const CODES = {
    orca_simulation_unavailable: "APN_RPC_PROTOCOL", orca_simulation_protocol: "APN_RPC_PROTOCOL",
    orca_simulation_blockhash_not_found: "APN_REPREPARE_REQUIRED", orca_simulation_insufficient_funds: "APN_INSUFFICIENT_ASSET",
    orca_simulation_instruction_error: "APN_OPERATION_BLOCKED", orca_simulation_rejected: "APN_OPERATION_BLOCKED",
    orca_simulation_output_shortfall: "APN_OPERATION_BLOCKED", orca_simulation_spend_exceeded: "APN_OPERATION_BLOCKED",
};
function refuse(reason) {
    throw new ApnError(CODES[reason], "The Orca swap simulation refused these exact bytes before any signature.", { reason });
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=simulation.js.map