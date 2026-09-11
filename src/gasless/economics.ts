import { exactKeys, isPlainRecord } from "../canonical.js";
import type { GaslessEstimate, GaslessFeeConfiguration, GaslessGas, GaslessIntent, GaslessSnapshot } from "./model.js";
import { GASLESS_MAX_UINT, GASLESS_MAX_UINT120, gaslessAddress, gaslessChain, gaslessExact, gaslessFailure,
  gaslessHash, gaslessHex, gaslessSame, gaslessUint } from "./validation.js";

const GAS_CEILINGS = {
  verificationGasLimit: 100_000n,
  callGasLimit: 250_000n,
  paymasterVerificationGasLimit: 500_000n,
  paymasterPostOpGasLimit: 200_000n,
  preVerificationGas: 150_000n,
} as const;
const REPEATED_PRE_VERIFICATION_GAS = 125_000n;
const AUTHORIZATION_GAS = 25_000n;
const MIN_POST_OP_GAS = 35_000n;
// Preserve the legacy 250k call ceiling when reading existing intents. New offers
// reserve more gas for Circle validation within the same 1m aggregate ceiling.
const OFFER_CALL_GAS = 200_000n;
const MAX_TOTAL_GAS = 1_000_000n;
const PRICE_SCALE = 1_000_000_000_000_000_000n;
const BPS_SCALE = 10_000n;
const GAS_FIELDS = [
  "verificationGasLimit", "callGasLimit", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit",
  "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas",
] as const;

export function gaslessGas(snapshot: GaslessSnapshot): GaslessGas {
  return validateGaslessGas(gaslessGasFields(snapshot));
}

/** Recognize the two admitted immutable offers without changing saved gas. */
export function validateGaslessStoredOffer(gas: GaslessGas, snapshot: GaslessSnapshot): void {
  validateGaslessGas(gas);
  const current = gaslessGasFields(snapshot);
  const legacy = { ...current, callGasLimit: "250000", paymasterVerificationGasLimit: "200000" };
  if (!gaslessSame(gas, current) && !gaslessSame(gas, legacy)) feeFailure();
}

function gaslessGasFields(snapshot: GaslessSnapshot): GaslessGas {
  const configuration = feeConfiguration(snapshot.feeConfiguration);
  const additional = BigInt(configuration.additionalGasCharge);
  if (additional > GAS_CEILINGS.paymasterPostOpGasLimit) feeFailure();
  const baseFee = gaslessUint(snapshot.baseFeePerGas, false, "APN_FEE_BUDGET_EXCEEDED");
  const priority = gaslessUint(snapshot.maxPriorityFeePerGas, false, "APN_FEE_BUDGET_EXCEEDED");
  const maximum = checkedAdd(checkedMultiply(baseFee, 2n), priority);
  if (maximum > GASLESS_MAX_UINT120 || snapshot.maxFeePerGas !== maximum.toString()) feeFailure();
  if (snapshot.delegation !== "empty" && snapshot.delegation !== "expected") identityFailure();
  return {
    verificationGasLimit: GAS_CEILINGS.verificationGasLimit.toString(),
    callGasLimit: OFFER_CALL_GAS.toString(),
    paymasterVerificationGasLimit: GAS_CEILINGS.paymasterVerificationGasLimit.toString(),
    paymasterPostOpGasLimit: (additional > MIN_POST_OP_GAS ? additional : MIN_POST_OP_GAS).toString(),
    preVerificationGas: (REPEATED_PRE_VERIFICATION_GAS +
      (snapshot.delegation === "empty" ? AUTHORIZATION_GAS : 0n)).toString(),
    maxFeePerGas: maximum.toString(),
    maxPriorityFeePerGas: priority.toString(),
  };
}

export function gaslessFee(gas: GaslessGas, config: GaslessFeeConfiguration): string {
  const validated = validateGaslessGas(gas), configuration = feeConfiguration(config);
  const maximum = BigInt(validated.maxFeePerGas);
  const requiredGas = gasQuantities(validated).reduce((sum, value) => checkedAdd(sum, value), 0n);
  const requiredPrefund = checkedMultiply(requiredGas, maximum);
  const withPostOp = checkedAdd(requiredPrefund,
    checkedMultiply(BigInt(configuration.additionalGasCharge), maximum));
  const base = checkedAdd(checkedMultiply(withPostOp, BigInt(configuration.nativeTokenPrice)) / PRICE_SCALE, 1n);
  return checkedAdd(base, checkedMultiply(base, BigInt(configuration.feeSpread)) / BPS_SCALE).toString();
}

export function validateGaslessGas(value: unknown): GaslessGas {
  if (!isPlainRecord(value) || !exactKeys(value, GAS_FIELDS)) feeFailure();
  const gas = value as unknown as GaslessGas;
  const quantities = gasQuantities(gas);
  for (let index = 0; index < quantities.length; index += 1) {
    const amount = quantities[index]!;
    const ceiling = GAS_CEILINGS[GAS_FIELDS[index] as keyof typeof GAS_CEILINGS];
    if (amount === 0n || amount > GASLESS_MAX_UINT120 || (ceiling !== undefined && amount > ceiling)) feeFailure();
  }
  const maximum = gaslessUint(gas.maxFeePerGas, true, "APN_FEE_BUDGET_EXCEEDED");
  const priority = gaslessUint(gas.maxPriorityFeePerGas, false, "APN_FEE_BUDGET_EXCEEDED");
  if (maximum > GASLESS_MAX_UINT120 || priority > GASLESS_MAX_UINT120 || priority > maximum ||
    quantities.reduce((sum, amount) => sum + amount, 0n) > MAX_TOTAL_GAS ||
    quantities[3]! < MIN_POST_OP_GAS) feeFailure();
  return gas;
}

export function assertGaslessEstimate(intent: GaslessIntent, estimate: GaslessEstimate): void {
  const keys = ["verificationGasLimit", "callGasLimit", "paymasterVerificationGasLimit",
    "paymasterPostOpGasLimit", "preVerificationGas", "responseHash"] as const;
  if (!isPlainRecord(estimate) || !exactKeys(estimate, keys)) estimateFailure();
  gaslessHash(estimate.responseHash, "APN_PROVIDER_PROTOCOL");
  const offer = validateGaslessGas(intent.gas);
  for (const field of keys.slice(0, 5) as readonly (keyof Pick<GaslessGas, "verificationGasLimit" | "callGasLimit" |
    "paymasterVerificationGasLimit" | "paymasterPostOpGasLimit" | "preVerificationGas">)[]) {
    const observed = gaslessUint(estimate[field], true, "APN_PROVIDER_PROTOCOL");
    if (observed > BigInt(offer[field])) estimateFailure();
  }
  if (intent.initialSnapshot.delegation === "empty" &&
    BigInt(estimate.preVerificationGas) < AUTHORIZATION_GAS) estimateFailure();
}

export function assertGaslessSnapshot(intent: GaslessIntent, current: GaslessSnapshot): void {
  const initial = validateSnapshot(intent.initialSnapshot), observed = validateSnapshot(current);
  const gas = validateGaslessGas(intent.gas);
  const gross = gaslessUint(intent.request.grossAtomic, true, "APN_STATE_CORRUPT");
  const cap = gaslessUint(intent.feeCapAtomic, true, "APN_STATE_CORRUPT");
  const delivered = gaslessUint(intent.recipientAtomic, true, "APN_STATE_CORRUPT");
  const userMaximum = gaslessUint(intent.request.maxFeeAtomic, false, "APN_STATE_CORRUPT");
  const minimum = gaslessUint(intent.request.minReceivedAtomic, true, "APN_STATE_CORRUPT");
  if (cap > userMaximum || cap > gross - minimum || delivered !== gross - cap ||
    gaslessFee(gas, initial.feeConfiguration) !== intent.feeCapAtomic ||
    gas.maxFeePerGas !== initial.maxFeePerGas || gas.maxPriorityFeePerGas !== initial.maxPriorityFeePerGas) feeFailure();
  if (initial.chainId !== intent.request.chainId || initial.token !== intent.token ||
    intent.tokenDomain.chainId !== intent.request.chainId || intent.tokenDomain.verifyingContract !== intent.token) protocolFailure();
  if (initial.owner !== intent.owner.address || observed.owner !== initial.owner || observed.delegation !== initial.delegation) identityFailure();
  if (initial.allowanceAtomic !== "0") gaslessFailure("APN_PERMISSION_ALLOWANCE_INSUFFICIENT", "gasless_allowance_drift");
  if (initial.pendingEoaNonceAtomic !== initial.eoaNonceAtomic) nonceFailure();
  if (BigInt(initial.balanceAtomic) < gross) gaslessFailure("APN_INSUFFICIENT_USDC", "gasless_fee_budget");
  for (const field of ["rpcOrigin", "rpcEndpointHash", "bundlerOrigin", "bundlerEndpointHash"] as const) {
    if (observed[field] !== initial[field]) endpointFailure();
  }
  for (const field of ["chainId", "protocolHash", "token"] as const) if (observed[field] !== initial[field]) protocolFailure();
  for (const field of ["permitNonceAtomic", "entryPointNonceAtomic", "eoaNonceAtomic", "pendingEoaNonceAtomic"] as const) {
    if (observed[field] !== initial[field]) nonceFailure();
  }
  if (observed.allowanceAtomic !== "0") gaslessFailure("APN_PERMISSION_ALLOWANCE_INSUFFICIENT", "gasless_allowance_drift");
  if (BigInt(observed.balanceAtomic) < gross) gaslessFailure("APN_INSUFFICIENT_USDC", "gasless_fee_budget");
  if (BigInt(observed.feeConfiguration.additionalGasCharge) > BigInt(gas.paymasterPostOpGasLimit) ||
    BigInt(observed.baseFeePerGas) > BigInt(gas.maxFeePerGas) ||
    BigInt(gaslessFee(gas, observed.feeConfiguration)) > cap) feeFailure();
}

function validateSnapshot(value: GaslessSnapshot): GaslessSnapshot {
  const keys = ["chainId", "rpcOrigin", "rpcEndpointHash", "bundlerOrigin", "bundlerEndpointHash", "block",
    "protocolHash", "owner", "token", "balanceAtomic", "nativeBalanceWei", "allowanceAtomic", "permitNonceAtomic",
    "entryPointNonceAtomic", "eoaNonceAtomic", "pendingEoaNonceAtomic", "delegation", "feeConfiguration",
    "baseFeePerGas", "maxFeePerGas", "maxPriorityFeePerGas"] as const;
  if (!isPlainRecord(value) || !exactKeys(value, keys)) identityFailure();
  gaslessChain(value.chainId, "APN_PROVIDER_PROTOCOL");
  if (gaslessAddress(value.owner, "APN_PROVIDER_PROTOCOL") !== value.owner ||
    gaslessAddress(value.token, "APN_PROVIDER_PROTOCOL") !== value.token) identityFailure();
  if (value.delegation !== "empty" && value.delegation !== "expected") identityFailure();
  for (const origin of [value.rpcOrigin, value.bundlerOrigin]) {
    if (typeof origin !== "string") endpointFailure();
    try { const parsed = new URL(origin); if (parsed.protocol !== "https:" || parsed.origin !== origin ||
      parsed.username || parsed.password) endpointFailure(); } catch { endpointFailure(); }
  }
  const block = gaslessExact(value.block, ["numberAtomic", "hash", "timestampAtomic"], "APN_PROVIDER_PROTOCOL");
  gaslessUint(block.numberAtomic, false, "APN_PROVIDER_PROTOCOL");
  gaslessUint(block.timestampAtomic, false, "APN_PROVIDER_PROTOCOL");
  if (gaslessHex(block.hash, 32, 32, "APN_PROVIDER_PROTOCOL") !== block.hash) protocolFailure();
  for (const field of ["balanceAtomic", "nativeBalanceWei", "allowanceAtomic", "permitNonceAtomic", "entryPointNonceAtomic",
    "eoaNonceAtomic", "pendingEoaNonceAtomic", "baseFeePerGas", "maxFeePerGas", "maxPriorityFeePerGas"] as const) {
    gaslessUint(value[field], false, "APN_PROVIDER_PROTOCOL");
  }
  gaslessHash(value.rpcEndpointHash, "APN_PROVIDER_PROTOCOL");
  gaslessHash(value.bundlerEndpointHash, "APN_PROVIDER_PROTOCOL");
  gaslessHash(value.protocolHash, "APN_PROVIDER_PROTOCOL");
  feeConfiguration(value.feeConfiguration);
  return value;
}

function feeConfiguration(value: GaslessFeeConfiguration): GaslessFeeConfiguration {
  const keys = ["additionalGasCharge", "feeSpread", "nativeTokenPrice"] as const;
  if (!isPlainRecord(value) || !exactKeys(value, keys)) feeFailure();
  for (const field of keys) gaslessUint(value[field], field === "nativeTokenPrice", "APN_FEE_BUDGET_EXCEEDED");
  return value;
}

function gasQuantities(gas: GaslessGas): bigint[] {
  return GAS_FIELDS.slice(0, 5).map((field) => gaslessUint(gas[field], true, "APN_FEE_BUDGET_EXCEEDED"));
}
function checkedMultiply(left: bigint, right: bigint): bigint {
  const result = left * right; if (result > GASLESS_MAX_UINT) feeFailure(); return result;
}
function checkedAdd(left: bigint, right: bigint): bigint {
  const result = left + right; if (result > GASLESS_MAX_UINT) feeFailure(); return result;
}
function feeFailure(): never { return gaslessFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_fee_budget"); }
function identityFailure(): never { return gaslessFailure("APN_OPERATION_BLOCKED", "gasless_identity_drift"); }
function nonceFailure(): never { return gaslessFailure("APN_OPERATION_BLOCKED", "gasless_nonce_drift"); }
function endpointFailure(): never { return gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity"); }
function protocolFailure(): never { return gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity"); }
function estimateFailure(): never { return gaslessFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_estimate_bounds"); }
