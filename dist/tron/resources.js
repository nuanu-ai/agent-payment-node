import { ApnError } from "../errors.js";
import { tronArray, tronAtomic, tronProtocolFailure, tronRecord, tronReprepare, tronSafeNumber } from "./codec.js";
import { validateTronParameters } from "./resource-model.js";
import { tronBlock } from "./rpc.js";
const FIELDS = {
    getTransactionFee: "bandwidthPriceAtomic", getEnergyFee: "energyPriceAtomic", getCreateNewAccountFeeInSystemContract: "systemCreateFeeAtomic",
    getCreateAccountFee: "fixedCreateBandwidthFeeAtomic", getCreateNewAccountBandwidthRate: "createBandwidthRateAtomic",
    getMaxFeeLimit: "maximumFeeLimitAtomic", getMaxCreateAccountTxSize: "maximumCreateAccountBytesAtomic",
};
async function parameters(rpc) {
    const response = tronRecord(await rpc.call("wallet/getchainparameters", {}));
    const entries = tronArray(response.chainParameter, 256);
    const values = new Map();
    const seen = new Set();
    const required = new Set([...Object.keys(FIELDS), "getAllowCreationOfContracts", "getConsensusLogicOptimization"]);
    for (const item of entries) {
        const row = tronRecord(item);
        if (typeof row.key !== "string" || seen.has(row.key))
            tronProtocolFailure();
        seen.add(row.key);
        // Other governance parameters legitimately use negative sentinel values.
        if (required.has(row.key))
            values.set(row.key, tronAtomic(row.value, true));
    }
    if (values.get("getAllowCreationOfContracts") !== 1n || values.get("getConsensusLogicOptimization") !== 1n)
        unsupported();
    const result = { vmEnabled: true, consensusExpiryEnabled: true };
    for (const [key, field] of Object.entries(FIELDS)) {
        const value = values.get(key);
        if (value === undefined)
            unsupported();
        result[field] = value.toString();
    }
    try {
        return validateTronParameters(result);
    }
    catch {
        return unsupported();
    }
}
/**
 * One read of the window: maintenance time, then chain parameters, then the head. A head still before that maintenance
 * proves no maintenance ran between the reads, so the parameters belong to the period the transaction expires in.
 */
export async function readTronWindow(rpc, now) {
    const nextMaintenance = tronAtomic(tronRecord(await rpc.call("wallet/getnextmaintenancetime", {})).num);
    // The node's software version is not read or pinned: TRON ships mandatory patch releases (4.8.2.2 on 2026-09-08),
    // an exact match refused every transfer after each upgrade, and public endpoints answer getnodeinfo with {}.
    // Charging is bound by the reviewed chain parameters below.
    const fees = await parameters(rpc);
    const header = tronBlock(await rpc.call("wallet/getnowblock", {}));
    const wall = BigInt(now().getTime());
    if (header.timestamp > wall + 6000n || wall - header.timestamp > 60000n || header.timestamp >= nextMaintenance)
        tronReprepare();
    const expiry = header.timestamp + 120000n < nextMaintenance - 6001n ? header.timestamp + 120000n : nextMaintenance - 6001n;
    if (expiry <= wall + 10000n)
        tronReprepare();
    return { header, parameters: fees, nextMaintenance, expiration: expiry };
}
/**
 * Chain parameters change only at a maintenance boundary, and the frozen window expires before the next one, so a head
 * still inside the window proves they are unchanged without reading them again. The reference block is re-read because
 * the signed transaction names it; the solidified recipient head the snapshot recorded is irreversible and is not.
 */
export async function revalidateTronWindow(rpc, snapshot, now) {
    const expiry = tronAtomic(snapshot.expirationMsAtomic);
    if (expiry >= tronAtomic(snapshot.nextMaintenanceMsAtomic))
        tronReprepare();
    const head = tronBlock(await rpc.call("wallet/getnowblock", {}));
    if (BigInt(now().getTime()) + 10000n >= expiry || head.timestamp + 10000n >= expiry || head.number < tronAtomic(snapshot.referenceBlockNumberAtomic))
        tronReprepare();
    const reference = tronBlock(await rpc.call("wallet/getblockbynum", { num: tronSafeNumber(tronAtomic(snapshot.referenceBlockNumberAtomic)) }));
    if (reference.id !== snapshot.referenceBlockId || reference.timestamp.toString() !== snapshot.referenceTimestampMsAtomic)
        tronReprepare();
}
function unsupported() { throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "The TRON node does not expose the reviewed protocol version and resource charging contract."); }
//# sourceMappingURL=resources.js.map