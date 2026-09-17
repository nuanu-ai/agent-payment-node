import { canonicalJson, domainHash, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronBlock } from "../../tron/rpc.js";
import { validateSunSwapUnsignedTransaction } from "./transaction.js";
export async function simulateSunSwapTransaction(rpc, transaction, intent) {
    validateSunSwapUnsignedTransaction(transaction, intent);
    const value = transaction.raw_data.contract[0].parameter.value;
    const body = { owner_address: value.owner_address, contract_address: value.contract_address, function_selector: "execute(bytes,bytes[],uint256)",
        parameter: value.data.slice(8), call_value: value.call_value, fee_limit: transaction.raw_data.fee_limit, visible: false };
    let constant, estimate, block, head;
    try {
        block = tronBlock(await rpc.call("wallet/getnowblock", {}));
        constant = await rpc.call("wallet/triggerconstantcontract", body);
        estimate = await rpc.call("wallet/estimateenergy", body);
        head = tronBlock(await rpc.call("wallet/getnowblock", {}));
    }
    catch {
        return unavailable();
    }
    if (head.id !== block.id || head.number !== block.number)
        revert();
    const constantEnergy = response(constant, "energy_used"), estimatedEnergy = response(estimate, "energy_required");
    const energy = constantEnergy > estimatedEnergy ? constantEnergy : estimatedEnergy;
    if (energy > BigInt(intent.maximumEnergy) || energy * BigInt(intent.energyPriceSun) > BigInt(intent.feeLimitSun)) {
        throw new ApnError("APN_FEE_BUDGET_EXCEEDED", "SunSwap simulation exceeds the frozen energy or fee_limit bound.");
    }
    const blockHash = `0x${block.id}`, blockNumber = block.number.toString();
    const requestHash = domainHash("apn.sunswap-tron-simulation-request.v1", canonicalJson({ originHash: rpc.originHash, body,
        txID: transaction.txID, blockNumber, blockHash }));
    const resultHash = domainHash("apn.sunswap-tron-simulation-result.v1", canonicalJson({ constant, estimate,
        energyRequired: energy.toString(), blockNumber, blockHash }));
    return { requestHash, resultHash, success: true, energyRequired: energy.toString(), feeLimitSun: intent.feeLimitSun,
        blockNumber, blockHash, headBlockNumber: blockNumber, maxHeadDrift: 0, gasEstimate: energy.toString() };
}
function response(value, field) {
    if (!isPlainRecord(value) || !isPlainRecord(value.result) || value.result.result !== true || value.result.message !== undefined)
        revert();
    const energy = integer(value[field]);
    if (energy <= 0n)
        revert();
    return energy;
}
function integer(value) {
    if (typeof value === "number" && !Number.isSafeInteger(value))
        revert();
    if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") || !/^[0-9]+$/u.test(String(value)))
        revert();
    return BigInt(value);
}
function unavailable() { throw new ApnError("APN_RPC_PROTOCOL", "Both TRON triggerconstantcontract and estimateenergy are required for SunSwap simulation."); }
function revert() { throw new ApnError("APN_OPERATION_BLOCKED", "SunSwap simulation reverted or returned transaction drift."); }
//# sourceMappingURL=simulation.js.map