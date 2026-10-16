import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAddress } from "viem";
import { canonicalJson, domainHash, hashObject } from "../../src/canonical.js";
import { ASSET_USAGE_RESERVATION_SCHEMA, assetUsageReservationId, idempotency, seal, validateAssetUsageReservation } from "../../src/asset-usage-ledger-record.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2, ALLOWLIST_POLICY_RECORD_SCHEMA_V2 } from "../../src/allowlist-policy-v2.js";
import { COINBASE_ACCOUNT_CODE_HASH, COINBASE_ACCOUNT_IMPLEMENTATION, COINBASE_ACCOUNT_IMPLEMENTATION_CODE_HASH,
  COINBASE_ENTRY_POINT, COINBASE_ENTRY_POINT_CODE_HASH } from "../../src/coinbase-gasless-observer.js";
import { BASE_USDC } from "../../src/constants.js";
import type { Address, Hex, OperationRecord } from "../../src/model.js";
import { appendTransition, sealOperation, validateOperation } from "../../src/state-integrity.js";
import { temporaryState } from "./helpers.js";

const OWNER = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const policy = (overlayVersion: string) => ({ schemaVersion: "apn.allowlist-policy-file.v1" as const, overlayVersion, accounts: { evm: OWNER },
  effectiveAt: "2026-10-16T00:00:00.000Z", expiresAt: "2026-11-16T00:00:00.000Z",
  admissions: [{ chain: "eip155:8453", kind: "token" as const, identifier: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", rail: "direct" as const,
    maximumPerTransferAtomic: "1000", dailyLimitAtomic: "2000" }] });

test("a staged allowlist revision from another dataset release still loads, and the owner can stage over it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const store = new AllowlistPolicyStore(temporary.root);
  const staged = await store.stage({ profile: "agent", now: new Date("2026-10-16T01:00:00.000Z"), policy: policy("drift.1") });
  const path = join(temporary.root, "allowlist-policies", allowlistProfileHash("agent"), "v00000001.json");
  // Re-seal the record as an older APN release would have written it: another dataset and inventory identity.
  const { overlayDigest: _o, ...overlayBody } = { ...staged.overlay, datasetVersion: "2026-01-01.market-cap-top-10.1", datasetSha256: "a".repeat(64), inventorySha256: "b".repeat(64) };
  const overlay = { ...overlayBody, overlayDigest: domainHash(ALLOWLIST_POLICY_OVERLAY_SCHEMA_V2, canonicalJson(overlayBody)) };
  const { recordDigest: _r, ...recordBody } = { ...staged, overlay };
  await writeFile(path, `${canonicalJson({ ...recordBody, recordDigest: domainHash(ALLOWLIST_POLICY_RECORD_SCHEMA_V2, canonicalJson(recordBody)) })}\n`, { mode: 0o600 });

  assert.equal((await store.status("agent"))?.overlay.datasetSha256, "a".repeat(64));
  const next = await store.stage({ profile: "agent", expectedRevision: 1, now: new Date("2026-10-16T02:00:00.000Z"), policy: policy("drift.2") });
  assert.equal(next.revision, 2);

  // Integrity still detects corruption: an edited cap without its digests fails closed.
  const corrupted = JSON.parse(await readFile(path, "utf8"));
  corrupted.registry.chains[0].assets[0].railCaps.direct.dailyLimitAtomic = "999999";
  await writeFile(path, `${canonicalJson(corrupted)}\n`, { mode: 0o600 });
  await assert.rejects(store.read("agent"), { code: "APN_STATE_CORRUPT" });
});

test("a settled merchant fee row of another account and network is read by its own bindings", () => {
  const operationId = "5".repeat(64), key = `apn.merchant-native:${operationId}`;
  const identity = { account: "0x2222222222222222222222222222222222222222", chain: "eip155:10", asset: { kind: "native" as const, identifier: null } };
  const proof = { kind: "merchant_mega_native_actual_fee", operationId, fingerprint: "6".repeat(64), receiptHash: "7".repeat(64), actualFee: "90", reservedFee: "100" };
  const row = seal({ schemaVersion: ASSET_USAGE_RESERVATION_SCHEMA, reservationId: assetUsageReservationId(identity, key), idempotencyHash: idempotency(key),
    policyDigest: "8".repeat(64), registryVersion: "owner.1", ...identity, rail: "x402", amountAtomic: "100", consumedAtomic: "90",
    merchantNativeActualFee: proof as never, state: "finalized", reservedAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:01:00.000Z",
    effectAt: "2026-10-16T00:01:00.000Z", outcomeDigest: hashObject(proof) });
  assert.equal(validateAssetUsageReservation(row).account, identity.account);
  assert.throws(() => validateAssetUsageReservation({ ...row, amountAtomic: "101" }), { code: "APN_STATE_CORRUPT" });
});

test("a stored Coinbase gasless operation keeps loading after an AWAL or Coinbase deployment upgrade", () => {
  const block = { numberAtomic: "90", hash: `0x${"9".repeat(64)}` as Hex, timestampAtomic: "900" };
  const make = (overrides: Record<string, unknown>): OperationRecord => {
    const binding = { schemaVersion: "apn.provider-direct.v1" as const, providerId: "coinbase-agentic-wallet", profileRevision: 1,
      capabilityHash: "1".repeat(64), accountBindingHash: "2".repeat(64), rpcBindingHash: "3".repeat(64), rpcOriginHash: "4".repeat(64),
      policy: { identity: "apn.direct.foreground-approval.v1" as const, verdict: "foreground_approval_required" as const, foregroundApprovalRequired: true as const },
      executionMode: "provider_atomic_send" as const, executionOwner: "provider" as const, retryOwner: "apn_outer_no_replay_journal" as const,
      coinbaseGasless: { schemaVersion: "apn.coinbase-gasless.v1" as const, chainId: 8453 as const, token: BASE_USDC,
        grossAtomic: "1000", netAtomic: "1000", feeAtomic: "0" as const, maxFeeAtomic: "0", minReceivedAtomic: "1000",
        senderNativeDebitWei: "0" as const, sponsorship: "coinbase_cdp_paymaster" as const, exclusiveAccountUseRequired: true as const,
        awalPackage: "awal" as const, awalVersion: "2.12.1", awalCommand: "send_base_usdc" as const,
        rpcOrigin: "https://base-rpc.publicnode.com", safeBlock: block, entryPoint: COINBASE_ENTRY_POINT, entryPointCodeHash: COINBASE_ENTRY_POINT_CODE_HASH,
        accountCodeHash: COINBASE_ACCOUNT_CODE_HASH, accountImplementation: COINBASE_ACCOUNT_IMPLEMENTATION,
        accountImplementationCodeHash: COINBASE_ACCOUNT_IMPLEMENTATION_CODE_HASH, ...overrides } };
    let transitions = appendTransition([], { at: "2026-09-12T00:00:00.000Z", state: "awaiting_approval", terminal: false,
      reason: "prepared_coinbase_gasless_provider_atomic_send", proofClass: "durable_coinbase_gasless_intent" });
    transitions = appendTransition(transitions, { at: "2026-09-12T00:00:00.100Z", state: "started", terminal: false,
      reason: "provider_effect_started", proofClass: "durable_provider_no_replay" });
    return sealOperation({ schemaVersion: "apn.state.v1", operationId: "a".repeat(64), idempotencyHash: "b".repeat(64), profile: "coinbase",
      profileHash: "c".repeat(64), requestHash: "d".repeat(64), fingerprint: "e".repeat(64),
      walletAddress: getAddress("0xfa4ec96026e3ddbb90e7adc4ccd5ba08353eccd8") as Address,
      recipient: getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd") as Address, amountAtomic: "1000", amountDecimal: "0.001",
      chainId: 8453, token: BASE_USDC, providerDirect: binding, coinbaseGaslessCursor: { nextBlockAtomic: "91", previousEndBlock: null },
      preparedAt: "2026-09-12T00:00:00.000Z", expiresAt: "2026-09-12T00:01:00.000Z", state: "started", terminal: false,
      reason: "provider_effect_started", proofClass: "durable_provider_no_replay", transitions });
  };
  validateOperation(make({}));
  validateOperation(make({ awalVersion: "2.13.0", accountCodeHash: `0x${"ab".repeat(32)}`,
    accountImplementation: "0x0000000000000000000000000000000000001234" }));
  assert.throws(() => validateOperation(make({ awalVersion: "latest" })), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateOperation(make({ accountCodeHash: "0x1234" })), { code: "APN_STATE_CORRUPT" });
});
