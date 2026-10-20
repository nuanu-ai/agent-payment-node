/**
 * Caller limits and balances checked against a fresh, well-formed Circle quote or Base read. A miss is refused before any
 * signature exactly as before, but it is an economic refusal, not a provider protocol fault: the error names the quantity,
 * the amount it needs, the limit it hit and their units, so the caller can decide whether to change the request. Shape
 * faults of the quote or the read (zero gas, a tip above the fee cap) stay APN_PROVIDER_PROTOCOL at their call sites.
 */
import { ApnError } from "../errors.js";
import { BRIDGE_MAX_GAS, bridgeUint } from "./validation.js";

const USDC = "USDC atomic units (6 decimals)";
type Shortfall = "APN_FEE_BUDGET_EXCEEDED" | "APN_INSUFFICIENT_USDC" | "APN_INSUFFICIENT_GAS";
/** The command a caller reruns with other limits: source submission or the separate approval. */
export type CircleV2Command = "apn circle source submit" | "apn circle approval prepare";
export interface CircleV2GasLimits {
  readonly maxGasLimitAtomic: string;
  readonly maxFeePerGasWei: string;
  readonly maxPriorityFeePerGasWei: string;
  readonly maxNativeDebitWei: string;
}

function refuse(code: Shortfall, reason: string, message: string, values: Readonly<Record<string, bigint>>, nextAction: string): never {
  const details: Record<string, string | readonly string[]> = { reason };
  for (const [key, value] of Object.entries(values)) details[key] = value.toString();
  throw new ApnError(code, `${message} Nothing was signed.`, { ...details, nextActions: [nextAction] });
}

/** Circle's quoted fee must stay below the principal and within the caller's --max-source-fee-atomic. */
export function circleV2FeeWithinBudget(reason: string, quotedFeeAtomic: bigint, amountAtomic: bigint, maxSourceFeeAtomic: bigint): void {
  if (quotedFeeAtomic >= amountAtomic) refuse("APN_FEE_BUDGET_EXCEEDED", reason,
    `The Circle source fee is ${quotedFeeAtomic} ${USDC}, not below the principal --amount-atomic ${amountAtomic} ${USDC}.`,
    { quotedFeeAtomic, amountAtomic },
    `Circle charges ${quotedFeeAtomic} USDC atomic units for this transfer; only a principal above that delivers anything. ` +
    "If that fee is acceptable, rerun apn circle source submit with a larger --amount-atomic.");
  if (quotedFeeAtomic > maxSourceFeeAtomic) refuse("APN_FEE_BUDGET_EXCEEDED", reason,
    `The Circle source fee is ${quotedFeeAtomic} ${USDC}, above --max-source-fee-atomic ${maxSourceFeeAtomic} ${USDC}.`,
    { quotedFeeAtomic, maxSourceFeeAtomic },
    `If a Circle fee of ${quotedFeeAtomic} USDC atomic units is acceptable, rerun apn circle source submit with ` +
    `--max-source-fee-atomic of at least ${quotedFeeAtomic}; otherwise retry later for a lower quote.`);
}

/** The payer's Base USDC must cover the debit the transaction makes (the principal plus Circle's fee, or the approval cap). */
export function circleV2UsdcCovers(reason: string, command: CircleV2Command, what: string, requiredAtomic: bigint, balanceAtomic: bigint): void {
  if (balanceAtomic < requiredAtomic) refuse("APN_INSUFFICIENT_USDC", reason,
    `${what} is ${requiredAtomic} ${USDC}; the payer's Base USDC balance is ${balanceAtomic} ${USDC}.`,
    { requiredUsdcAtomic: requiredAtomic, usdcBalanceAtomic: balanceAtomic },
    `Fund the payer with at least ${requiredAtomic - balanceAtomic} more USDC atomic units on Base, or ask for less, then rerun ${command}.`);
}

/** Base gas, fee per gas and tip within APN's bridge ceiling and the caller's limits. Call after the shape checks. */
export function circleV2GasWithinBudget(reasonPrefix: string, command: CircleV2Command, gasAtomic: bigint, maxFeePerGasWei: bigint,
  maxPriorityFeePerGasWei: bigint, limits: CircleV2GasLimits): void {
  const reason = `${reasonPrefix}_gas_or_fee_cap`;
  if (gasAtomic > BRIDGE_MAX_GAS) refuse("APN_FEE_BUDGET_EXCEEDED", reason,
    `Base needs ${gasAtomic} gas units for this transaction, above APN's bridge gas ceiling ${BRIDGE_MAX_GAS} gas units.`,
    { gasLimitAtomic: gasAtomic, bridgeMaxGasAtomic: BRIDGE_MAX_GAS },
    "No option raises APN's bridge gas ceiling; this transaction cannot be sent as Base estimates it now.");
  const capGas = bridgeUint(limits.maxGasLimitAtomic), capFee = bridgeUint(limits.maxFeePerGasWei), capTip = bridgeUint(limits.maxPriorityFeePerGasWei);
  if (gasAtomic > capGas) refuse("APN_FEE_BUDGET_EXCEEDED", reason,
    `Base needs ${gasAtomic} gas units for this transaction, above --max-gas-limit-atomic ${capGas} gas units.`,
    { gasLimitAtomic: gasAtomic, maxGasLimitAtomic: capGas },
    `If ${gasAtomic} gas units are acceptable, rerun ${command} with --max-gas-limit-atomic of at least ${gasAtomic}.`);
  if (maxFeePerGasWei > capFee) refuse("APN_FEE_BUDGET_EXCEEDED", reason,
    `Base's current max fee per gas is ${maxFeePerGasWei} wei, above --max-fee-per-gas-wei ${capFee} wei.`,
    { maxFeePerGasWei, maxFeePerGasCapWei: capFee },
    `If ${maxFeePerGasWei} wei per gas is acceptable, rerun ${command} with --max-fee-per-gas-wei of at least ${maxFeePerGasWei}; otherwise retry when Base fees fall.`);
  if (maxPriorityFeePerGasWei > capTip) refuse("APN_FEE_BUDGET_EXCEEDED", reason,
    `Base's current priority fee per gas is ${maxPriorityFeePerGasWei} wei, above --max-priority-fee-per-gas-wei ${capTip} wei.`,
    { maxPriorityFeePerGasWei, maxPriorityFeePerGasCapWei: capTip },
    `If ${maxPriorityFeePerGasWei} wei per gas is acceptable, rerun ${command} with --max-priority-fee-per-gas-wei of at least ${maxPriorityFeePerGasWei}.`);
}

/** The most Base ETH the transaction may debit, within the caller's --max-native-debit-wei and the payer's balance. */
export function circleV2NativeWithinBudget(reasonPrefix: string, command: CircleV2Command, nativeDebitWei: bigint,
  nativeBalanceWei: bigint, maxNativeDebitWei: string): void {
  const reason = `${reasonPrefix}_native_balance_or_cap`, cap = bridgeUint(maxNativeDebitWei);
  if (nativeDebitWei > cap) refuse("APN_FEE_BUDGET_EXCEEDED", reason,
    `The transaction may debit up to ${nativeDebitWei} wei of Base ETH (gas, L1 data and operator fees), above --max-native-debit-wei ${cap} wei.`,
    { nativeDebitWei, maxNativeDebitWei: cap },
    `If ${nativeDebitWei} wei is acceptable, rerun ${command} with --max-native-debit-wei of at least ${nativeDebitWei}.`);
  if (nativeBalanceWei < nativeDebitWei) refuse("APN_INSUFFICIENT_GAS", reason,
    `The transaction may debit up to ${nativeDebitWei} wei of Base ETH; the payer holds ${nativeBalanceWei} wei.`,
    { nativeDebitWei, nativeBalanceWei },
    `Add at least ${nativeDebitWei - nativeBalanceWei} wei of Base ETH to the payer, then rerun ${command}.`);
}
