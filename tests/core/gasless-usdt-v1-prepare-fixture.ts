/**
 * The v1 bound-preparation writer, kept as a test fixture. Releases before bound-operation v2 (2026-10-05) wrote v1
 * records with it, and the v1 readers, signing guards and stored-record checks are still tested against such records.
 * Production prepares only v2 (`preparePolicyBoundUsdtV2`).
 */
import { canonicalJson, hashObject } from "../../src/canonical.js";
import type { Hex } from "../../src/model.js";
import { assertUsdtFunding, type UsdtAccountState, type UsdtSponsorPort } from "../../src/gasless-usdt/engine.js";
import { USDT_GASLESS, usdtFailure } from "../../src/gasless-usdt/model.js";
import { validateUsdtPaymasterData } from "../../src/gasless-usdt/paymaster-data.js";
import { canonicalAddress, frozenCopy, requirePolicy, usdtApprovalTransferBatch, USDT_PREPARE_STUB_WORD as STUB_WORD,
  type UsdtPolicyPrepared, type UsdtPolicyPrepareRequest, type UsdtPreparePort } from "../../src/gasless-usdt/policy-prepare.js";
import { planUsdtTransfer, validateUsdtGasPrice, validateUsdtTokenQuote } from "../../src/gasless-usdt/quote.js";
import { usdtUserOperation } from "../../src/gasless-usdt/userop.js";

const ESTIMATE_SIGNATURE = `0x${"fffffffffffffffffffffffffffffff0"}${"0".repeat(32)}7${"a".repeat(63)}1c` as Hex;
const HASH = /^0x[0-9a-f]{64}$/u;
const serializable = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, entry: unknown) =>
  typeof entry === "bigint" ? entry.toString() : entry));

/** Domain-only prepare: quote and sponsor reads are checked twice; no journal, reservation, signature or send is reachable. */
export async function preparePolicyBoundUsdt(
  ports: { readonly prepare: UsdtPreparePort; readonly sponsor: Pick<UsdtSponsorPort, "tokenQuote" | "gasPrice" | "paymasterData"> },
  request: UsdtPolicyPrepareRequest,
): Promise<UsdtPolicyPrepared> {
  if (request.chain !== USDT_GASLESS.chain || request.token !== USDT_GASLESS.token ||
    request.sponsorUrl !== USDT_GASLESS.bundlerUrl || !request.profile) usdtFailure("APN_INVALID_INPUT", "gasless_usdt_route_binding");
  const now = ports.prepare.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) usdtFailure("APN_INVALID_INPUT", "gasless_usdt_clock");
  const startMilliseconds = now.getTime();
  const sender = canonicalAddress(request.sender), recipient = canonicalAddress(request.recipient);
  if ([sender, USDT_GASLESS.token, USDT_GASLESS.paymaster, USDT_GASLESS.entryPoint, USDT_GASLESS.delegate,
    USDT_GASLESS.treasury].includes(recipient)) usdtFailure("APN_INVALID_INPUT", "gasless_usdt_recipient");
  if (typeof request.grossAtomic !== "bigint" || typeof request.maxFeeAtomic !== "bigint" ||
    typeof request.minReceivedAtomic !== "bigint") usdtFailure("APN_INVALID_INPUT", "gasless_usdt_amount_type");
  const profile = request.profile;
  const transferRequest = { sender, recipient, grossAtomic: request.grossAtomic,
    maxFeeAtomic: request.maxFeeAtomic, minReceivedAtomic: request.minReceivedAtomic };
  const policyRequest = { ...transferRequest, profile, chain: USDT_GASLESS.chain,
    token: USDT_GASLESS.token, sponsorUrl: USDT_GASLESS.bundlerUrl };
  const usage = await ports.prepare.dailyUsage(sender, new Date(startMilliseconds));
  const active = requirePolicy(await ports.prepare.activePolicy(profile), policyRequest, usage, new Date(startMilliseconds));
  const policyDigest = active.digest, policyRevision = active.revision, activationDigest = active.activationDigest;
  const snapshot = await ports.prepare.safeSnapshot(sender);
  const { chainId, blockNumber, blockHash } = snapshot;
  const { usdtBalanceAtomic, entryPointNonce, eoaNonce, delegation } = snapshot.account;
  if (chainId !== 1n || typeof blockNumber !== "bigint" || blockNumber < 1n ||
    typeof blockHash !== "string" || !HASH.test(blockHash) || typeof usdtBalanceAtomic !== "bigint" ||
    usdtBalanceAtomic < 0n || typeof entryPointNonce !== "bigint" || entryPointNonce < 0n ||
    typeof eoaNonce !== "bigint" || eoaNonce < 0n || !["empty", "expected"].includes(delegation)) {
    usdtFailure("APN_CHAIN_MISMATCH", "gasless_usdt_safe_block");
  }
  const account: UsdtAccountState = Object.freeze({ usdtBalanceAtomic, entryPointNonce, eoaNonce, delegation });
  const quote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
  const price = validateUsdtGasPrice(await ports.sponsor.gasPrice()).fast;
  const plan = planUsdtTransfer(transferRequest, quote, price);
  assertUsdtFunding(plan, account);
  const callData = usdtApprovalTransferBatch(plan);
  const authorization = account.delegation === "empty" ? Object.freeze({
    chainId: "0x1" as Hex, address: USDT_GASLESS.delegate, nonce: `0x${account.eoaNonce.toString(16)}` as Hex,
    yParity: "0x0" as Hex, r: STUB_WORD, s: STUB_WORD,
  }) : null;
  const draft = frozenCopy(usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, callData,
    paymasterData: "0x", signature: ESTIMATE_SIGNATURE, authorization }));
  const result = await ports.sponsor.paymasterData(draft);
  const paymaster = validateUsdtPaymasterData(result, plan, BigInt(Math.floor(startMilliseconds / 1000)));
  if (paymaster.exchangeRate !== plan.quote.exchangeRate) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_signed_quote_rate_mismatch");
  }
  const paymasterData = (result as { paymasterData: Hex }).paymasterData.toLowerCase() as Hex;
  const freshQuote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
  const freshPrice = validateUsdtGasPrice(await ports.sponsor.gasPrice()).fast;
  if (canonicalJson(serializable(freshQuote)) !== canonicalJson(serializable(quote)) ||
    canonicalJson(serializable(freshPrice)) !== canonicalJson(serializable(price))) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_quote_drift");
  }
  const finalNow = ports.prepare.now();
  if (!(finalNow instanceof Date) || !Number.isFinite(finalNow.getTime()) || finalNow.getTime() < startMilliseconds) {
    usdtFailure("APN_INVALID_INPUT", "gasless_usdt_clock");
  }
  validateUsdtPaymasterData(result, plan, BigInt(Math.floor(finalNow.getTime() / 1000)));
  const freshUsage = await ports.prepare.dailyUsage(sender, finalNow);
  const current = requirePolicy(await ports.prepare.activePolicy(profile), policyRequest, freshUsage, finalNow);
  if (current.digest !== policyDigest || current.revision !== policyRevision || current.activationDigest !== activationDigest ||
    freshUsage !== usage) usdtFailure("APN_ALLOWLIST_REFUSED", "gasless_usdt_policy_changed");
  const unsignedOperation = usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, callData,
    paymasterData, signature: ESTIMATE_SIGNATURE, authorization });
  const body = frozenCopy({ schemaVersion: "apn.gasless-usdt-policy-prepare.v1" as const, profile, policyDigest,
    policyRevision, activationDigest, chain: USDT_GASLESS.chain, token: USDT_GASLESS.token,
    mechanism: USDT_GASLESS.mechanism, sponsorUrl: USDT_GASLESS.bundlerUrl, safeBlockNumber: blockNumber.toString(),
    safeBlockHash: blockHash, account, plan, callData, paymaster, paymasterData, unsignedOperation });
  return Object.freeze({ ...body, bindingHash: hashObject(serializable(body)) });
}
