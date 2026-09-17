import { canonicalJson, domainHash, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { TronRpcPort } from "../../tron/rpc.js";
import type { SwapSimulationProof } from "../quote.js";
import type { SunSwapUnsignedIntent, SunSwapUnsignedTransaction } from "./transaction.js";

export interface SunSwapSimulationProof extends SwapSimulationProof { readonly energyRequired: string; readonly feeLimitSun: string }

export async function simulateSunSwapTransaction(rpc: TronRpcPort, transaction: SunSwapUnsignedTransaction,
  intent: SunSwapUnsignedIntent): Promise<SunSwapSimulationProof> {
  const value = transaction.raw_data.contract[0].parameter.value;
  const body = { owner_address: value.owner_address, contract_address: value.contract_address, function_selector: "execute(bytes,bytes[],uint256)",
    parameter: value.data.slice(8), call_value: value.call_value, fee_limit: transaction.raw_data.fee_limit, visible: false };
  let constant: unknown, estimate: unknown;
  try {
    constant = await rpc.call("wallet/triggerconstantcontract", body);
    estimate = await rpc.call("wallet/estimateenergy", body);
  } catch { return unavailable(); }
  const first = response(constant, transaction), second = response(estimate, transaction);
  const energy = second.energy_required ?? first.energy_used;
  if (energy === undefined || energy <= 0n || energy > BigInt(intent.maximumEnergy) || energy * BigInt(intent.energyPriceSun) > BigInt(intent.feeLimitSun)) {
    throw new ApnError("APN_FEE_BUDGET_EXCEEDED", "SunSwap simulation exceeds the frozen energy or fee_limit bound.");
  }
  const requestHash = domainHash("apn.sunswap-tron-simulation-request.v1", canonicalJson({ originHash: rpc.originHash, body, txID: transaction.txID }));
  const resultHash = domainHash("apn.sunswap-tron-simulation-result.v1", canonicalJson({ constant, estimate, energyRequired: energy.toString() }));
  return { requestHash, resultHash, success: true, energyRequired: energy.toString(), feeLimitSun: intent.feeLimitSun };
}

function response(value: unknown, transaction: SunSwapUnsignedTransaction): { energy_required?: bigint; energy_used?: bigint } {
  if (!isPlainRecord(value) || !isPlainRecord(value.result) || value.result.result !== true || value.result.message !== undefined ||
      !isPlainRecord(value.transaction) || value.transaction.txID !== transaction.txID || value.transaction.raw_data_hex !== transaction.raw_data_hex) revert();
  return { ...(value.energy_required === undefined ? {} : { energy_required: integer(value.energy_required) }),
    ...(value.energy_used === undefined ? {} : { energy_used: integer(value.energy_used) }) };
}
function integer(value: unknown): bigint { if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") || !/^[0-9]+$/u.test(String(value))) revert(); return BigInt(value); }
function unavailable(): never { throw new ApnError("APN_RPC_PROTOCOL", "Both TRON triggerconstantcontract and estimateenergy are required for SunSwap simulation."); }
function revert(): never { throw new ApnError("APN_OPERATION_BLOCKED", "SunSwap simulation reverted or returned transaction drift."); }
