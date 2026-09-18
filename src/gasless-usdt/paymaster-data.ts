import { getAddress } from "viem";
import { exactKeys, isPlainRecord } from "../canonical.js";
import { gaslessAddress } from "../gasless/validation.js";
import type { Hex } from "../model.js";
import {
  USDT_GASLESS, USDT_PAYMASTER_MAX_VALIDITY_S, USDT_PAYMASTER_MIN_VALIDITY_S, usdtFailure,
  type UsdtPaymasterPayload, type UsdtTransferPlan,
} from "./model.js";
import { usdtFeeBound } from "./quote.js";

/**
 * Pimlico singleton v0.8 ERC-20 layout: mode byte, flags byte, validUntil(6), validAfter(6), token(20), postOpGas(16),
 * exchangeRate(32), paymasterValidationGasLimit(16), treasury(20), signature(65). Flags must be zero: no constant fee,
 * no fee recipient other than the treasury and no prefund pulled during validation.
 */
const PAYLOAD_BYTES = 1 + 1 + 6 + 6 + 20 + 16 + 32 + 16 + 20 + 65;
const ERC20_MODE = 1;

/** Exact decode of `paymasterData`; any other length, mode or flag refuses. */
export function decodeUsdtPaymasterData(value: unknown): UsdtPaymasterPayload {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/u.test(value) || value.length !== 2 + PAYLOAD_BYTES * 2) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_data_shape");
  }
  const hex = value.slice(2).toLowerCase();
  let cursor = 0;
  const take = (bytes: number): string => { const part = hex.slice(cursor, cursor + bytes * 2); cursor += bytes * 2; return part; };
  const mode = Number.parseInt(take(1), 16), flags = Number.parseInt(take(1), 16);
  if (mode >> 1 !== ERC20_MODE) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_mode");
  if (flags !== 0) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_flags");
  const validUntil = BigInt(`0x${take(6)}`), validAfter = BigInt(`0x${take(6)}`);
  const token = getAddress(`0x${take(20)}`), postOpGas = BigInt(`0x${take(16)}`), exchangeRate = BigInt(`0x${take(32)}`);
  const paymasterValidationGasLimit = BigInt(`0x${take(16)}`), treasury = getAddress(`0x${take(20)}`);
  const signature = `0x${take(65)}` as Hex;
  return { allowAllBundlers: (mode & 1) === 1, validUntil, validAfter, token, postOpGas, exchangeRate,
    paymasterValidationGasLimit, treasury, signature };
}

/**
 * `pm_getPaymasterData` result for the planned operation. The signed rate is re-priced against the plan: its worst case
 * must still fit F, the owner's fee budget, which is also the only allowance the batch grants.
 */
export function validateUsdtPaymasterData(result: unknown, plan: UsdtTransferPlan, nowSeconds: bigint): UsdtPaymasterPayload {
  if (!isPlainRecord(result) || !exactKeys(result, ["paymaster", "paymasterData"])) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_result_shape");
  }
  if (gaslessAddress(result.paymaster) !== USDT_GASLESS.paymaster) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_identity");
  const payload = decodeUsdtPaymasterData(result.paymasterData);
  if (payload.token !== USDT_GASLESS.token) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_token");
  if (payload.treasury !== USDT_GASLESS.treasury) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_treasury");
  if (payload.postOpGas !== plan.quote.postOpGas) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_post_op_gas");
  if (payload.paymasterValidationGasLimit === 0n || payload.paymasterValidationGasLimit > plan.gas.paymasterVerificationGasLimit) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_validation_gas");
  }
  if (payload.validAfter > nowSeconds || payload.validUntil < nowSeconds + USDT_PAYMASTER_MIN_VALIDITY_S ||
    payload.validUntil > nowSeconds + USDT_PAYMASTER_MAX_VALIDITY_S) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_validity");
  }
  if (payload.exchangeRate === 0n) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_paymaster_rate");
  const signedBound = usdtFeeBound(plan.gas, plan.price.maxFeePerGas, payload.postOpGas, payload.exchangeRate);
  if (signedBound > plan.feeCapAtomic) {
    usdtFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_usdt_signed_rate_above_max_fee",
      `The sponsor's signed USDT rate prices the worst case at ${signedBound} atomic, above the fee budget ${plan.feeCapAtomic}.`);
  }
  return payload;
}
