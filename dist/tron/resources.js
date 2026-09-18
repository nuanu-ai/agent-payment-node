import { canonicalJson, hashObject } from "../canonical.js";
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
export async function readTronWindow(rpc, now) {
    const before = tronBlock(await rpc.call("wallet/getnowblock", {}));
    // The node's software version is not read or pinned: TRON ships mandatory patch releases (4.8.2.2 on 2026-09-08),
    // an exact match refused every transfer after each upgrade, and public endpoints answer getnodeinfo with {}.
    // Charging is bound by the reviewed chain parameters below.
    const fees = await parameters(rpc);
    const nextMaintenance = tronAtomic(tronRecord(await rpc.call("wallet/getnextmaintenancetime", {})).num);
    const after = tronBlock(await rpc.call("wallet/getnowblock", {}));
    const again = await parameters(rpc);
    const nextAgain = tronAtomic(tronRecord(await rpc.call("wallet/getnextmaintenancetime", {})).num);
    const wall = BigInt(now().getTime());
    if (after.number < before.number || after.timestamp < before.timestamp || after.timestamp > wall + 6000n || wall - after.timestamp > 60000n || after.timestamp >= nextMaintenance || nextAgain !== nextMaintenance || canonicalJson(fees) !== canonicalJson(again))
        tronReprepare();
    const expiry = after.timestamp + 120000n < nextMaintenance - 6001n ? after.timestamp + 120000n : nextMaintenance - 6001n;
    if (expiry <= wall + 10000n)
        tronReprepare();
    return { header: after, parameters: fees, nextMaintenance, expiration: expiry };
}
export async function revalidateTronWindow(rpc, snapshot, now) {
    const current = await readTronWindow(rpc, now);
    const expiry = tronAtomic(snapshot.expirationMsAtomic);
    if (hashObject(current.parameters) !== snapshot.parameterHash || current.nextMaintenance.toString() !== snapshot.nextMaintenanceMsAtomic || BigInt(now().getTime()) + 10000n >= expiry || current.header.timestamp + 10000n >= expiry || current.header.number < tronAtomic(snapshot.referenceBlockNumberAtomic))
        tronReprepare();
    const reference = tronBlock(await rpc.call("wallet/getblockbynum", { num: tronSafeNumber(tronAtomic(snapshot.referenceBlockNumberAtomic)) }));
    if (reference.id !== snapshot.referenceBlockId || reference.timestamp.toString() !== snapshot.referenceTimestampMsAtomic)
        tronReprepare();
    const solid = tronBlock(await rpc.call("walletsolidity/getblockbynum", { num: tronSafeNumber(tronAtomic(snapshot.recipientSolidHeadNumberAtomic)) }));
    if (solid.id !== snapshot.recipientSolidHeadId)
        tronReprepare();
}
function unsupported() { throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "The TRON node does not expose the reviewed protocol version and resource charging contract."); }
//# sourceMappingURL=resources.js.map