import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { atomic } from "../chain-policy.js";
import { ApnError } from "../errors.js";
const PARAMETER_KEYS = ["bandwidthPriceAtomic", "energyPriceAtomic", "systemCreateFeeAtomic", "fixedCreateBandwidthFeeAtomic", "createBandwidthRateAtomic", "maximumFeeLimitAtomic", "maximumCreateAccountBytesAtomic", "vmEnabled", "consensusExpiryEnabled"];
const HASH = /^[a-f0-9]{64}$/u;
export function tronBandwidthBytes(rawBytes) {
    if (rawBytes < 1n || rawBytes > 2048n)
        corrupt();
    let size = 1n;
    for (let n = rawBytes; n > 127n; n >>= 7n)
        size++;
    return rawBytes + size + 132n;
}
export function validateTronParameters(value) {
    if (!isPlainRecord(value) || !exactKeys(value, PARAMETER_KEYS) || value.vmEnabled !== true || value.consensusExpiryEnabled !== true)
        corrupt();
    for (const key of PARAMETER_KEYS.slice(0, 7))
        atomic(value[key]);
    for (const key of ["bandwidthPriceAtomic", "energyPriceAtomic", "createBandwidthRateAtomic", "maximumFeeLimitAtomic", "maximumCreateAccountBytesAtomic"])
        if (atomic(value[key]) === 0n)
            corrupt();
    if (atomic(value.maximumFeeLimitAtomic) > BigInt(Number.MAX_SAFE_INTEGER))
        corrupt();
    return value;
}
export function validateTronResources(value, prepared) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "protocolVersion", "parameters", "parameterHash", "referenceBlockId", "referenceBlockNumberAtomic", "referenceTimestampMsAtomic", "nextMaintenanceMsAtomic", "expirationMsAtomic", "rawDataBytesAtomic", "bandwidthBytesAtomic", "bandwidthMaximumAtomic", "energyFeeLimitAtomic", "energyEstimateAtomic", "accountActivationMaximumAtomic", "recipientActivatedAtSolidHead", "recipientSolidHeadNumberAtomic", "recipientSolidHeadId", "totalFeeMaximumAtomic", "costRule"]))
        corrupt();
    if (value.schemaVersion !== "apn.tron-resources.v1" || value.protocolVersion !== "4.8.2.1" || typeof value.recipientActivatedAtSolidHead !== "boolean")
        corrupt();
    const p = validateTronParameters(value.parameters);
    if (value.parameterHash !== hashObject(p) || value.referenceBlockId !== prepared.blockReference || typeof value.referenceBlockId !== "string" || !HASH.test(value.referenceBlockId))
        corrupt();
    const referenceNumber = atomic(value.referenceBlockNumberAtomic);
    const solidNumber = atomic(value.recipientSolidHeadNumberAtomic);
    if (solidNumber > referenceNumber || value.referenceBlockId.slice(0, 16) !== referenceNumber.toString(16).padStart(16, "0") || typeof value.recipientSolidHeadId !== "string" || !HASH.test(value.recipientSolidHeadId) || value.recipientSolidHeadId.slice(0, 16) !== solidNumber.toString(16).padStart(16, "0"))
        corrupt();
    const timestamp = atomic(value.referenceTimestampMsAtomic, true);
    const expiry = atomic(value.expirationMsAtomic, true);
    if (expiry <= timestamp || expiry - timestamp > 120000n || expiry + 6000n >= atomic(value.nextMaintenanceMsAtomic, true) || expiry !== BigInt(Date.parse(prepared.expiresAt)))
        corrupt();
    const rawSize = atomic(value.rawDataBytesAtomic, true);
    const bytes = tronBandwidthBytes(rawSize);
    if (atomic(value.bandwidthBytesAtomic) !== bytes || atomic(value.bandwidthMaximumAtomic) !== bytes * atomic(p.bandwidthPriceAtomic))
        corrupt();
    const bandwidth = atomic(value.bandwidthMaximumAtomic);
    const energy = atomic(value.energyFeeLimitAtomic);
    atomic(value.energyEstimateAtomic);
    if (energy > atomic(p.maximumFeeLimitAtomic))
        corrupt();
    const activation = atomic(value.accountActivationMaximumAtomic);
    let total;
    if (prepared.asset.kind === "native") {
        if (energy !== 0n || value.energyEstimateAtomic !== "0")
            corrupt();
        if (value.recipientActivatedAtSolidHead) {
            if (value.costRule !== "ordinary_bandwidth" || activation !== 0n || prepared.createsRecipientAccount)
                corrupt();
            total = bandwidth;
        }
        else {
            if (value.costRule !== "native_activation_or_bandwidth" || activation !== atomic(p.systemCreateFeeAtomic) || !prepared.createsRecipientAccount)
                corrupt();
            const activationPath = activation + atomic(p.fixedCreateBandwidthFeeAtomic);
            total = bandwidth > activationPath ? bandwidth : activationPath;
            // Serialized one-signature transaction minus its 65 signature bytes.
            if (bytes - 129n > atomic(p.maximumCreateAccountBytesAtomic))
                corrupt();
        }
    }
    else {
        if (value.costRule !== "energy_limit_plus_bandwidth" || energy === 0n || activation !== 0n || prepared.createsRecipientAccount)
            corrupt();
        total = bandwidth + energy;
    }
    if (atomic(value.totalFeeMaximumAtomic) !== total || prepared.economics.networkFeeMaximumAtomic !== total.toString() || prepared.economics.maximumNativeDebitAtomic !== total.toString() || total > atomic(prepared.maximumFeeAtomic))
        corrupt();
    return value;
}
export function validateTronFinalResources(value, prepared, blockNumber, success) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "parentBlockId", "parentBlockNumberAtomic", "parentTimestampMsAtomic", "blockTimestampMsAtomic", "totalFeeAtomic", "bandwidthFeeAtomic", "bandwidthUsageAtomic", "energyFeeAtomic", "energyUsageAtomic", "originEnergyUsageAtomic", "totalEnergyUsageAtomic", "accountActivationFeeAtomic", "contractResult", "balanceObservation"]))
        corrupt();
    if (value.schemaVersion !== "apn.tron-resource-evidence.v1" || value.contractResult !== (success ? "SUCCESS" : "REVERT"))
        corrupt();
    const snapshot = validateTronResources(prepared.resources, prepared);
    const p = snapshot.parameters;
    const parentNumber = atomic(value.parentBlockNumberAtomic);
    const parentTime = atomic(value.parentTimestampMsAtomic, true);
    const blockTime = atomic(value.blockTimestampMsAtomic, true);
    if (parentNumber + 1n !== blockNumber || blockNumber <= atomic(snapshot.referenceBlockNumberAtomic) || typeof value.parentBlockId !== "string" || !HASH.test(value.parentBlockId) ||
        value.parentBlockId.slice(0, 16) !== parentNumber.toString(16).padStart(16, "0") || parentTime < atomic(snapshot.referenceTimestampMsAtomic) ||
        parentTime + 3000n > blockTime || parentTime + 3000n > atomic(snapshot.expirationMsAtomic) ||
        parentNumber === atomic(snapshot.referenceBlockNumberAtomic) && value.parentBlockId !== snapshot.referenceBlockId)
        corrupt();
    const total = atomic(value.totalFeeAtomic);
    const netFee = atomic(value.bandwidthFeeAtomic);
    const netUsage = atomic(value.bandwidthUsageAtomic);
    const energyFee = atomic(value.energyFeeAtomic);
    const energyUsage = atomic(value.energyUsageAtomic);
    const origin = atomic(value.originEnergyUsageAtomic);
    const energyTotal = atomic(value.totalEnergyUsageAtomic);
    const activation = atomic(value.accountActivationFeeAtomic);
    const bytes = atomic(snapshot.bandwidthBytesAtomic);
    if (total !== netFee + energyFee + activation || total > atomic(snapshot.totalFeeMaximumAtomic) || energyFee > atomic(snapshot.energyFeeLimitAtomic) || activation > atomic(snapshot.accountActivationMaximumAtomic))
        corrupt();
    if (prepared.asset.kind === "native") {
        if (!success || energyFee !== 0n || energyUsage !== 0n || origin !== 0n || energyTotal !== 0n)
            corrupt();
        if (activation !== 0n && activation !== atomic(p.systemCreateFeeAtomic))
            corrupt();
    }
    else if (activation !== 0n || energyTotal === 0n || energyTotal < energyUsage + origin || energyFee !== (energyTotal - energyUsage - origin) * atomic(p.energyPriceAtomic) ||
        (energyTotal - origin) * atomic(p.energyPriceAtomic) > atomic(snapshot.energyFeeLimitAtomic))
        corrupt();
    const ordinary = netFee === 0n && netUsage === bytes || netUsage === 0n && netFee === bytes * atomic(p.bandwidthPriceAtomic);
    const creation = netFee === 0n && netUsage === bytes * atomic(p.createBandwidthRateAtomic) || netUsage === 0n && netFee === atomic(p.fixedCreateBandwidthFeeAtomic);
    if (activation > 0n ? !creation : !ordinary && !(snapshot.costRule === "native_activation_or_bandwidth" && atomic(p.systemCreateFeeAtomic) === 0n && creation))
        corrupt();
    const observation = value.balanceObservation;
    if (!isPlainRecord(observation) || !exactKeys(observation, ["scope", "atOrAfterBlockNumberAtomic", "senderBalanceAtomic", "recipientBalanceAtomic"]) || observation.scope !== "current_solidified_state" || atomic(observation.atOrAfterBlockNumberAtomic) < blockNumber)
        corrupt();
    atomic(observation.senderBalanceAtomic);
    atomic(observation.recipientBalanceAtomic);
    return value;
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The TRON resource snapshot or final fee evidence is invalid."); }
//# sourceMappingURL=resource-model.js.map