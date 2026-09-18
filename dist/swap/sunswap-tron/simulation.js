import { decodeFunctionResult, parseAbi } from "viem";
import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SUNSWAP_MAX_HEAD_DRIFT_BLOCKS, SUNSWAP_V2_ROUTER } from "./catalog.js";
import { assertSunSwapHeadDrift, sunSwapConstantBody, sunSwapHead, triggerSunSwapConstant } from "./tron-call.js";
import { validateSunSwapUnsignedTransaction } from "./transaction.js";
const ABI = parseAbi(["function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)"]);
/**
 * Simulates the exact unsigned call from the owner with call_value = input. The proof is bound to the recorded
 * reference block of the unsigned transaction; the head read after the call must stay within the frozen drift bound.
 */
export async function simulateSunSwapTransaction(rpc, transaction, intent) {
    const exact = validateSunSwapUnsignedTransaction(transaction, intent);
    const call = { owner: intent.owner, contract: SUNSWAP_V2_ROUTER, data: exact.raw_data.contract[0].parameter.value.data,
        callValueAtomic: intent.callValueAtomic };
    const reference = { number: BigInt(`0x${intent.referenceBlockId.slice(0, 16)}`).toString(), id: intent.referenceBlockId };
    const result = await triggerSunSwapConstant(rpc, call);
    const headBlockNumber = assertSunSwapHeadDrift(reference, await sunSwapHead(rpc));
    let amounts;
    try {
        amounts = decodeFunctionResult({ abi: ABI, functionName: "swapExactETHForTokens", data: `0x${result.resultHex}` });
    }
    catch {
        return protocol();
    }
    if (result.resultHex.length !== 256 || amounts.length !== 2 || amounts[0] !== BigInt(intent.inputAmountAtomic))
        protocol();
    if (amounts[1] < BigInt(intent.minimumOutputAtomic)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Simulated SunSwap output is below the frozen minimum.", { reason: "sunswap_simulated_output_below_minimum" });
    }
    const energy = BigInt(result.energyUsed);
    if (energy <= 0n)
        protocol();
    if (energy > BigInt(intent.maximumEnergy) || energy * BigInt(intent.energyPriceSun) > BigInt(intent.feeLimitSun)) {
        throw new ApnError("APN_FEE_BUDGET_EXCEEDED", "SunSwap simulation energy exceeds the owner fee_limit.", { reason: "sunswap_fee_limit_exceeded" });
    }
    const blockHash = `0x${intent.referenceBlockId}`, blockNumber = reference.number;
    const requestHash = domainHash("apn.sunswap-tron-simulation-request.v1", canonicalJson({ originHash: rpc.originHash,
        body: sunSwapConstantBody(call), txID: exact.txID, blockNumber, blockHash }));
    const resultHash = domainHash("apn.sunswap-tron-simulation-result.v1", canonicalJson({ resultHex: result.resultHex,
        energyUsed: result.energyUsed, energyPenalty: result.energyPenalty, outputAtomic: amounts[1].toString(), blockNumber, blockHash,
        headBlockNumber }));
    return { requestHash, resultHash, success: true, energyRequired: result.energyUsed, feeLimitSun: intent.feeLimitSun,
        blockNumber, blockHash, headBlockNumber, maxHeadDrift: SUNSWAP_MAX_HEAD_DRIFT_BLOCKS, gasEstimate: result.energyUsed };
}
function protocol() { throw new ApnError("APN_RPC_PROTOCOL", "TRON returned a SunSwap simulation with an invalid shape or binding."); }
//# sourceMappingURL=simulation.js.map