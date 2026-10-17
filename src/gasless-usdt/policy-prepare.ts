import { encodeFunctionData, getAddress, parseAbi } from "viem";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import type { Address, Hex } from "../model.js";
import type { UsdtAccountState } from "./engine.js";
import { USDT_GASLESS, usdtFailure, type UsdtPaymasterPayload, type UsdtTransferPlan, type UsdtTransferRequest } from "./model.js";
import type { UsdtUserOperation } from "./userop.js";

const TOKEN_ABI = parseAbi(["function approve(address spender,uint256 value) returns (bool)", "function transfer(address to,uint256 value) returns (bool)"]);
const ACCOUNT_ABI = parseAbi(["function executeBatch((address target,uint256 value,bytes data)[] calls)"]);
const STUB_WORD = `0x${"11".repeat(32)}` as Hex;
export const USDT_PREPARE_STUB_WORD = STUB_WORD;
const DIGEST = /^[0-9a-f]{64}$/u;
export function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (entry: unknown): void => {
    if (entry !== null && typeof entry === "object") {
      for (const nested of Object.values(entry)) freeze(nested);
      Object.freeze(entry);
    }
  };
  freeze(copy);
  return copy;
}

/** A read-only adapter must authenticate the active policy and read one canonical safe block. */
export interface UsdtPreparePort {
  now(): Date;
  sponsorPermit?(bound: import("./bound-operation.js").UsdtAnyBoundOperation, identity: import("./local-signing.js").UsdtSigningIdentity, snapshot: import("./sponsor-auth.js").UsdtSponsorSnapshot): Promise<import("./sponsor-permit.js").UsdtSponsorPermit>;
  sponsorAuth?(op: UsdtUserOperation, snapshot: import("./sponsor-auth.js").UsdtSponsorSnapshot): Promise<import("./sponsor-auth.js").UsdtSponsorAuthEvidence>;
  activePolicy(profile: string): Promise<ActiveAssetPolicy | null>;
  dailyUsage(sender: Address, at: Date): Promise<string>;
  safeSnapshot(sender: Address): Promise<{
    readonly chainId: bigint; readonly blockNumber: bigint; readonly blockHash: Hex; readonly account: UsdtAccountState;
    readonly pins?: import("./sponsor-auth.js").UsdtSponsorSnapshot["pins"];
  }>;
}

export interface UsdtPolicyPrepareRequest extends UsdtTransferRequest {
  readonly profile: string;
  readonly chain: "eip155:1";
  readonly token: Address;
  readonly sponsorUrl: string;
}

/** Frozen, unsigned material. Integration must persist it before offering foreground approval. */
export interface UsdtPolicyPrepared {
  readonly schemaVersion: "apn.gasless-usdt-policy-prepare.v1";
  readonly profile: string;
  readonly policyDigest: string;
  readonly policyRevision: number;
  readonly activationDigest: string;
  readonly chain: "eip155:1";
  readonly token: Address;
  readonly mechanism: typeof USDT_GASLESS.mechanism;
  readonly sponsorUrl: string;
  readonly safeBlockNumber: string;
  readonly safeBlockHash: Hex;
  readonly account: UsdtAccountState;
  readonly plan: UsdtTransferPlan;
  readonly callData: Hex;
  readonly paymaster: UsdtPaymasterPayload;
  readonly paymasterData: Hex;
  readonly unsignedOperation: UsdtUserOperation;
  readonly bindingHash: string;
}

export function canonicalAddress(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) usdtFailure("APN_INVALID_INPUT", "gasless_usdt_address");
  try { if (getAddress(value) === value) return value as Address; } catch { /* refused below */ }
  usdtFailure("APN_INVALID_INPUT", "gasless_usdt_address");
}

export function requirePolicy(active: ActiveAssetPolicy | null, request: UsdtPolicyPrepareRequest, usage: string, now: Date): ActiveAssetPolicy {
  if (active === null) usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_required");
  if (active.profile !== request.profile || active.accounts.evm !== request.sender || active.digest !== active.registry.policyDigest ||
    !DIGEST.test(active.digest) || !DIGEST.test(active.activationDigest) || !Number.isSafeInteger(active.revision) || active.revision < 1) {
    usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_identity");
  }
  const admission = evaluateAssetPolicy(active.registry, { chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token },
    rail: "gasless", amountAtomic: request.grossAtomic.toString(), dailyUsageAtomic: usage,
    asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
  if (admission.asset.mechanismPins?.gasless?.provider !== USDT_GASLESS.mechanism.provider ||
    admission.asset.mechanismPins.gasless.reference !== USDT_GASLESS.mechanism.reference ||
    BigInt(admission.caps.maximumPerTransferAtomic) <= 0n || BigInt(admission.caps.dailyLimitAtomic) <= 0n) {
    usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_mechanism");
  }
  return active;
}

export function usdtApprovalTransferBatch(plan: Pick<UsdtTransferPlan, "request" | "feeCapAtomic" | "netAtomic">): Hex {
  const approveZero = encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [USDT_GASLESS.paymaster, 0n] });
  const approveExact = encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [USDT_GASLESS.paymaster, plan.feeCapAtomic] });
  const transfer = encodeFunctionData({ abi: TOKEN_ABI, functionName: "transfer", args: [plan.request.recipient, plan.netAtomic] });
  return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeBatch", args: [[
    { target: USDT_GASLESS.token, value: 0n, data: approveZero },
    { target: USDT_GASLESS.token, value: 0n, data: approveExact },
    { target: USDT_GASLESS.token, value: 0n, data: transfer },
  ]] });
}
