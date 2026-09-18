import { decodeFunctionResult, parseAbi, type Hex } from "viem";
import { ApnError } from "../../errors.js";
import type { ClockPort } from "../../ports.js";
import { assertTronNetwork, type TronRpcPort } from "../../tron/rpc.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import { SUNSWAP_PINNED_CONTRACTS, SUNSWAP_V2_CODE_HASHES, SUNSWAP_V2_ROUTER } from "./catalog.js";
import type { SunSwapExecutionFreshness } from "./execution-binding.js";
import { assertSunSwapOwnerFunding, sunSwapChainParameters } from "./keyless-builder.js";
import { verifySunSwapPinnedCode } from "./market.js";
import { validateSunSwapPreparedMaterial, type SunSwapPreparedMaterial } from "./prepared.js";
import { sunSwapHead, triggerSunSwapConstant } from "./tron-call.js";

const ABI = parseAbi(["function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)"]);
/** TRON accepts a transaction only while its reference block is among the last 65536 blocks (TAPOS). */
const TAPOS_WINDOW_BLOCKS = 65_536n;

/**
 * Pre-signing guard at the current head: mainnet genesis, unchanged energy and bandwidth prices, every pinned code
 * hash, a live reference block and expiration, the exact unsigned call still returning at least the minimum within
 * the fee_limit, and a balance that covers the maximum TRX debit. Any refusal happens before the submission marker.
 */
export class SunSwapExecutionGuard {
  constructor(private readonly rpc: TronRpcPort, private readonly clock: ClockPort) {}

  async inspect(operationValue: SwapOperationRecord, materialValue: SunSwapPreparedMaterial): Promise<SunSwapExecutionFreshness> {
    const operation = validateSwapOperation(operationValue), material = validateSunSwapPreparedMaterial(materialValue, "stored");
    const { intent, transaction, market } = material.execution;
    if (material.quote.quoteHash !== operation.quote.quoteHash) blocked("Prepared SunSwap material changed after preparation.", "swap_material_drift");
    await assertTronNetwork(this.rpc);
    const parameters = await sunSwapChainParameters(this.rpc);
    if (parameters.energyPriceSun.toString() !== intent.energyPriceSun || parameters.bandwidthPriceSun.toString() !== material.execution.bandwidthPriceSun ||
        BigInt(intent.feeLimitSun) > parameters.maximumFeeLimitSun) {
      blocked("TRON energy or bandwidth prices changed after the quote; request a fresh quote.", "sunswap_resource_price_drift");
    }
    for (const { role, address } of SUNSWAP_PINNED_CONTRACTS) await verifySunSwapPinnedCode(this.rpc, address, SUNSWAP_V2_CODE_HASHES[role]);
    const head = await sunSwapHead(this.rpc), reference = BigInt(market.referenceBlock.number);
    if (head.number < reference) throw new ApnError("APN_RPC_PROTOCOL", "TRON head is behind the recorded SunSwap reference block.");
    if (head.number - reference >= TAPOS_WINDOW_BLOCKS) blocked("The SunSwap reference block left the TAPOS window.", "sunswap_reference_block_expired");
    if (head.timestamp >= BigInt(intent.expirationMs)) blocked("The SunSwap transaction expiration has passed on chain.", "sunswap_deadline_expired");
    const result = await triggerSunSwapConstant(this.rpc, { owner: intent.owner, contract: SUNSWAP_V2_ROUTER,
      data: transaction.raw_data.contract[0].parameter.value.data, callValueAtomic: intent.callValueAtomic });
    let amounts: readonly bigint[];
    try { amounts = decodeFunctionResult({ abi: ABI, functionName: "swapExactETHForTokens", data: `0x${result.resultHex}` as Hex }); }
    catch { return protocol(); }
    if (result.resultHex.length !== 256 || amounts.length !== 2 || amounts[0] !== BigInt(intent.inputAmountAtomic)) protocol();
    if (amounts[1]! < BigInt(intent.minimumOutputAtomic)) {
      blocked("The exact SunSwap call now returns less than the frozen minimum.", "sunswap_output_below_minimum");
    }
    const energy = BigInt(result.energyUsed);
    if (energy <= 0n) protocol();
    if (energy > BigInt(intent.maximumEnergy) || energy * BigInt(intent.energyPriceSun) > BigInt(intent.feeLimitSun)) {
      throw new ApnError("APN_FEE_BUDGET_EXCEEDED", "SunSwap pre-send energy exceeds the owner fee_limit.", { reason: "sunswap_fee_limit_exceeded" });
    }
    const maximumDebit = material.gasOrEnergy.maximumTrxDebitSun;
    if (maximumDebit === undefined) throw new ApnError("APN_STATE_CORRUPT", "SunSwap maximum TRX debit is missing.");
    const balance = await assertSunSwapOwnerFunding(this.rpc, intent.owner, BigInt(maximumDebit));
    return { headBlockNumber: head.number.toString(), headBlockId: head.id, headTimestampMs: head.timestamp.toString(),
      simulatedOutputAtomic: amounts[1]!.toString(), simulatedEnergy: energy.toString(), balanceSun: balance.toString(),
      checkedAt: this.clock.now().toISOString() };
  }
}

function protocol(): never { throw new ApnError("APN_RPC_PROTOCOL", "TRON returned a SunSwap pre-send simulation with an invalid shape or binding."); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
