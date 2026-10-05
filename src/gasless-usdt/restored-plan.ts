import type { UsdtAnyBoundOperation } from "./bound-operation.js";
import type { UsdtTransferPlan } from "./model.js";
import type { UsdtV2Plan } from "./economics-v2.js";
export function restoreUsdtPlan(bound: UsdtAnyBoundOperation): UsdtTransferPlan | UsdtV2Plan {
  const p = bound.binding.plan;
  return { ...p, request: { ...p.request, grossAtomic: BigInt(p.request.grossAtomic), maxFeeAtomic: BigInt(p.request.maxFeeAtomic), minReceivedAtomic: BigInt(p.request.minReceivedAtomic) },
    feeCapAtomic: BigInt(p.feeCapAtomic), netAtomic: BigInt(p.netAtomic), quotedFeeAtomic: BigInt(p.quotedFeeAtomic),
    quote: { ...p.quote, postOpGas: BigInt(p.quote.postOpGas), exchangeRate: BigInt(p.quote.exchangeRate),
      ...("exchangeRateNativeToUsd" in p.quote ? { exchangeRateNativeToUsd: BigInt(p.quote.exchangeRateNativeToUsd) } : {}) },
    price: { maxFeePerGas: BigInt(p.price.maxFeePerGas), maxPriorityFeePerGas: BigInt(p.price.maxPriorityFeePerGas) },
    gas: Object.fromEntries(Object.entries(p.gas).map(([key, value]) => [key, BigInt(value)])) } as UsdtTransferPlan | UsdtV2Plan;
}
