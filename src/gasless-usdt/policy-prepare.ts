import { encodeFunctionData, getAddress, parseAbi } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import type { Address, Hex } from "../model.js";
import { assertUsdtFunding, type UsdtAccountState, type UsdtSponsorPort } from "./engine.js";
import { USDT_GASLESS, usdtFailure, type UsdtPaymasterPayload, type UsdtTransferPlan, type UsdtTransferRequest } from "./model.js";
import { validateUsdtPaymasterData } from "./paymaster-data.js";
import { planUsdtTransfer, validateUsdtGasPrice, validateUsdtTokenQuote } from "./quote.js";
import { usdtUserOperation, type UsdtUserOperation } from "./userop.js";

const TOKEN_ABI = parseAbi(["function approve(address spender,uint256 value) returns (bool)", "function transfer(address to,uint256 value) returns (bool)"]);
const ACCOUNT_ABI = parseAbi(["function executeBatch((address target,uint256 value,bytes data)[] calls)"]);
const ESTIMATE_SIGNATURE = `0x${"fffffffffffffffffffffffffffffff0"}${"0".repeat(32)}7${"a".repeat(63)}1c` as Hex;
const STUB_WORD = `0x${"11".repeat(32)}` as Hex;
const HASH = /^0x[0-9a-f]{64}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const serializable = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, entry: unknown) =>
  typeof entry === "bigint" ? entry.toString() : entry));

/** A read-only adapter must authenticate the active policy and read one canonical safe block. */
export interface UsdtPreparePort {
  now(): Date;
  activePolicy(profile: string): Promise<ActiveAssetPolicy | null>;
  dailyUsage(sender: Address, at: Date): Promise<string>;
  safeSnapshot(sender: Address): Promise<{
    readonly chainId: bigint; readonly blockNumber: bigint; readonly blockHash: Hex; readonly account: UsdtAccountState;
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

function canonicalAddress(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) usdtFailure("APN_INVALID_INPUT", "gasless_usdt_address");
  try { if (getAddress(value) === value) return value as Address; } catch { /* refused below */ }
  usdtFailure("APN_INVALID_INPUT", "gasless_usdt_address");
}

function requirePolicy(active: ActiveAssetPolicy | null, request: UsdtPolicyPrepareRequest, usage: string, now: Date): ActiveAssetPolicy {
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

export function usdtApprovalTransferBatch(plan: UsdtTransferPlan): Hex {
  const approveZero = encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [USDT_GASLESS.paymaster, 0n] });
  const approveExact = encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [USDT_GASLESS.paymaster, plan.feeCapAtomic] });
  const transfer = encodeFunctionData({ abi: TOKEN_ABI, functionName: "transfer", args: [plan.request.recipient, plan.netAtomic] });
  return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeBatch", args: [[
    { target: USDT_GASLESS.token, value: 0n, data: approveZero },
    { target: USDT_GASLESS.token, value: 0n, data: approveExact },
    { target: USDT_GASLESS.token, value: 0n, data: transfer },
  ]] });
}

/** Domain-only prepare: quote and sponsor reads are checked twice; no journal, reservation, signature or send is reachable. */
export async function preparePolicyBoundUsdt(
  ports: { readonly prepare: UsdtPreparePort; readonly sponsor: Pick<UsdtSponsorPort, "tokenQuote" | "gasPrice" | "paymasterData"> },
  request: UsdtPolicyPrepareRequest,
): Promise<UsdtPolicyPrepared> {
  if (request.chain !== USDT_GASLESS.chain || request.token !== USDT_GASLESS.token ||
    request.sponsorUrl !== USDT_GASLESS.bundlerUrl || !request.profile) usdtFailure("APN_INVALID_INPUT", "gasless_usdt_route_binding");
  const now = ports.prepare.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) usdtFailure("APN_INVALID_INPUT", "gasless_usdt_clock");
  const sender = canonicalAddress(request.sender), recipient = canonicalAddress(request.recipient);
  if ([sender, USDT_GASLESS.token, USDT_GASLESS.paymaster, USDT_GASLESS.entryPoint, USDT_GASLESS.delegate,
    USDT_GASLESS.treasury].includes(recipient)) usdtFailure("APN_INVALID_INPUT", "gasless_usdt_recipient");
  if (typeof request.grossAtomic !== "bigint" || typeof request.maxFeeAtomic !== "bigint" ||
    typeof request.minReceivedAtomic !== "bigint") usdtFailure("APN_INVALID_INPUT", "gasless_usdt_amount_type");
  const usage = await ports.prepare.dailyUsage(sender, now);
  const active = requirePolicy(await ports.prepare.activePolicy(request.profile), request, usage, now);
  const snapshot = await ports.prepare.safeSnapshot(sender);
  if (snapshot.chainId !== 1n || snapshot.blockNumber < 1n || !HASH.test(snapshot.blockHash) ||
    snapshot.account.entryPointNonce < 0n || snapshot.account.eoaNonce < 0n ||
    !["empty", "expected"].includes(snapshot.account.delegation)) {
    usdtFailure("APN_CHAIN_MISMATCH", "gasless_usdt_safe_block");
  }
  const quote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
  const price = validateUsdtGasPrice(await ports.sponsor.gasPrice()).fast;
  const plan = planUsdtTransfer({ sender, recipient, grossAtomic: request.grossAtomic,
    maxFeeAtomic: request.maxFeeAtomic, minReceivedAtomic: request.minReceivedAtomic }, quote, price);
  assertUsdtFunding(plan, snapshot.account);
  const callData = usdtApprovalTransferBatch(plan);
  const authorization = snapshot.account.delegation === "empty" ? {
    chainId: "0x1" as Hex, address: USDT_GASLESS.delegate, nonce: `0x${snapshot.account.eoaNonce.toString(16)}` as Hex,
    yParity: "0x0" as Hex, r: STUB_WORD, s: STUB_WORD,
  } : null;
  const draft = usdtUserOperation(plan, { entryPointNonce: snapshot.account.entryPointNonce, callData,
    paymasterData: "0x", signature: ESTIMATE_SIGNATURE, authorization });
  const result = await ports.sponsor.paymasterData(draft);
  const paymaster = validateUsdtPaymasterData(result, plan, BigInt(Math.floor(now.getTime() / 1000)));
  const paymasterData = (result as { paymasterData: Hex }).paymasterData.toLowerCase() as Hex;
  const freshQuote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
  const freshPrice = validateUsdtGasPrice(await ports.sponsor.gasPrice()).fast;
  if (canonicalJson(serializable(freshQuote)) !== canonicalJson(serializable(quote)) ||
    canonicalJson(serializable(freshPrice)) !== canonicalJson(serializable(price))) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quote_drift");
  }
  const finalNow = ports.prepare.now();
  if (!(finalNow instanceof Date) || !Number.isFinite(finalNow.getTime()) || finalNow.getTime() < now.getTime()) {
    usdtFailure("APN_INVALID_INPUT", "gasless_usdt_clock");
  }
  validateUsdtPaymasterData(result, plan, BigInt(Math.floor(finalNow.getTime() / 1000)));
  const freshUsage = await ports.prepare.dailyUsage(sender, finalNow);
  const current = requirePolicy(await ports.prepare.activePolicy(request.profile), request, freshUsage, finalNow);
  if (current.digest !== active.digest || current.revision !== active.revision || current.activationDigest !== active.activationDigest ||
    freshUsage !== usage) usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_changed");
  const unsignedOperation = usdtUserOperation(plan, { entryPointNonce: snapshot.account.entryPointNonce, callData,
    paymasterData, signature: ESTIMATE_SIGNATURE, authorization });
  const body = { schemaVersion: "apn.gasless-usdt-policy-prepare.v1" as const, profile: request.profile, policyDigest: active.digest,
    policyRevision: active.revision, activationDigest: active.activationDigest, chain: USDT_GASLESS.chain, token: USDT_GASLESS.token,
    mechanism: USDT_GASLESS.mechanism, sponsorUrl: USDT_GASLESS.bundlerUrl, safeBlockNumber: snapshot.blockNumber.toString(),
    safeBlockHash: snapshot.blockHash, account: snapshot.account, plan, callData, paymaster, paymasterData, unsignedOperation };
  return { ...body, bindingHash: hashObject(serializable(body)) };
}
