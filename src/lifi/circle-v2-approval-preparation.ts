/** Read-only, unsigned Base USDC approval preparation for the Circle V2 WithFees wrapper. */
import { createHash } from "node:crypto";
import { encodeFunctionData, parseAbi } from "viem";
import { canonicalJson } from "../canonical.js";
import { BRIDGE_MAX_GAS, BRIDGE_MIN_REMAINING_MS, BRIDGE_TTL_MS, bridgeAddress, bridgeFailure, bridgeHex, bridgeUint } from "./validation.js";

const TOKEN = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SPENDER = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const UINT256_MAX = (1n << 256n) - 1n;
const abi = parseAbi(["function approve(address spender,uint256 value) returns (bool)"]);
function fail(reason: string): never { return bridgeFailure("APN_PROVIDER_PROTOCOL", `circle_v2_approval_${reason}`); }
function digest(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`; }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export interface CircleV2ApprovalState {
  readonly chainId: 8453;
  readonly payer: string;
  readonly token: string;
  readonly spender: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly latestNonceAtomic: string;
  readonly pendingNonceAtomic: string;
  readonly usdcBalanceAtomic: string;
  readonly usdcAllowanceAtomic: string;
  readonly nativeBalanceWei: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasWei: string;
  readonly maxPriorityFeePerGasWei: string;
}
/** Implementation must obtain allowance and balance at the same fresh Base block and estimate the supplied calldata. */
export type CircleV2ApprovalStateReader = (query: Readonly<{
  chainId: 8453; payer: string; token: string; spender: string; data: string;
}>) => Promise<CircleV2ApprovalState>;
export interface CircleV2ApprovalLimits {
  readonly maxGasLimitAtomic: string;
  readonly maxFeePerGasWei: string;
  readonly maxPriorityFeePerGasWei: string;
  readonly maxNativeDebitWei: string;
  readonly ttlMs: number;
}
export interface CircleV2ApprovalPreparation {
  readonly kind: "circle_v2_base_usdc_approval_preparation";
  readonly executionAdmitted: false;
  readonly baseStateSourceVerified: false;
  readonly quoteIndicativeOnly: true;
  readonly blockers: readonly string[];
  readonly token: string;
  readonly spender: string;
  readonly approvalCapAtomic: string;
  readonly observedAllowanceAtomic: string;
  readonly sourceBlock: { readonly number: string; readonly hash: string };
  readonly transaction: { readonly type: "eip1559"; readonly chainId: 8453; readonly from: string;
    readonly to: string; readonly data: string; readonly valueAtomic: "0"; readonly nonceAtomic: string;
    readonly gasLimitAtomic: string; readonly maxFeePerGasWei: string; readonly maxPriorityFeePerGasWei: string };
  readonly maximumNativeDebitWei: string;
  readonly preparedAt: string;
  readonly expiresAt: string;
  readonly intentDigest: string;
}

export async function prepareCircleV2BaseUsdcApprovalReadOnly(input: Readonly<{
  chainId: 8453; payer: string; token: string; spender: string; approvalCapAtomic: string;
}>, readBase: CircleV2ApprovalStateReader, limits: CircleV2ApprovalLimits,
now: () => number = Date.now): Promise<CircleV2ApprovalPreparation> {
  if (input.chainId !== 8453 || bridgeAddress(input.token) !== TOKEN || bridgeAddress(input.spender) !== SPENDER) fail("target");
  const payer = bridgeAddress(input.payer), cap = bridgeUint(input.approvalCapAtomic, true);
  if (cap === UINT256_MAX) fail("unbounded_cap");
  const data = encodeFunctionData({ abi, functionName: "approve", args: [SPENDER, cap] });
  let state: CircleV2ApprovalState;
  try { state = await readBase({ chainId: 8453, payer, token: TOKEN, spender: SPENDER, data }); }
  catch { return fail("base_unavailable"); }
  if (state.chainId !== 8453 || bridgeAddress(state.payer) !== payer ||
    bridgeAddress(state.token) !== TOKEN || bridgeAddress(state.spender) !== SPENDER) fail("base_identity");
  const blockNumber = bridgeUint(state.blockNumber), blockHash = bridgeHex(state.blockHash, 32, 32);
  if (bridgeUint(state.latestNonceAtomic) !== bridgeUint(state.pendingNonceAtomic)) fail("pending_nonce");
  if (bridgeUint(state.usdcBalanceAtomic) < cap || bridgeUint(state.usdcAllowanceAtomic) > cap) fail("balance_or_allowance");
  const gas = bridgeUint(state.gasLimitAtomic), maxFee = bridgeUint(state.maxFeePerGasWei);
  const priority = bridgeUint(state.maxPriorityFeePerGasWei);
  if (gas === 0n || gas > BRIDGE_MAX_GAS || gas > bridgeUint(limits.maxGasLimitAtomic) || maxFee === 0n ||
    priority > maxFee || maxFee > bridgeUint(limits.maxFeePerGasWei) || priority > bridgeUint(limits.maxPriorityFeePerGasWei)) fail("gas_or_fee_cap");
  const nativeDebit = gas * maxFee;
  if (nativeDebit > UINT256_MAX || nativeDebit > bridgeUint(limits.maxNativeDebitWei) ||
    bridgeUint(state.nativeBalanceWei) < nativeDebit) fail("native_balance_or_cap");
  const current = now();
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(limits.ttlMs) ||
    limits.ttlMs < BRIDGE_MIN_REMAINING_MS || limits.ttlMs > BRIDGE_TTL_MS || !Number.isSafeInteger(current + limits.ttlMs)) fail("ttl");
  const fields = {
    kind: "circle_v2_base_usdc_approval_preparation" as const, executionAdmitted: false as const,
    baseStateSourceVerified: false as const, quoteIndicativeOnly: true as const,
    blockers: ["Base state is supplied by the caller's reader and its origin is not authenticated by this artifact",
      "The Circle quote is indicative only; refresh quote and Base allowance before source submission",
      "No signing or transaction submission has occurred"] as const,
    token: TOKEN, spender: SPENDER, approvalCapAtomic: cap.toString(), observedAllowanceAtomic: bridgeUint(state.usdcAllowanceAtomic).toString(),
    sourceBlock: { number: blockNumber.toString(), hash: blockHash },
    transaction: { type: "eip1559" as const, chainId: 8453 as const, from: payer, to: TOKEN, data,
      valueAtomic: "0" as const, nonceAtomic: bridgeUint(state.latestNonceAtomic).toString(),
      gasLimitAtomic: gas.toString(), maxFeePerGasWei: maxFee.toString(), maxPriorityFeePerGasWei: priority.toString() },
    maximumNativeDebitWei: nativeDebit.toString(), preparedAt: new Date(current).toISOString(),
    expiresAt: new Date(current + limits.ttlMs).toISOString(),
  };
  return freeze({ ...fields, intentDigest: digest(fields) });
}
