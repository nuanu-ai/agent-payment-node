import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { getAddress } from "viem";
import { StateStore, sealWallet } from "../../src/state.js";
import { appendTransition, sealOperation } from "../../src/state-integrity.js";
import { hashObject } from "../../src/canonical.js";
import { STATE_VERSION } from "../../src/constants.js";
import type { EvmAsset } from "../../src/evm-asset.js";
import { evmDirectFingerprint, evmTransaction, type EvmDirectBinding } from "../../src/evm-direct.js";
import { formatAtomic } from "../../src/money.js";
import type { Address, Hex, OperationRecord, OperationState } from "../../src/model.js";
import { loadActiveAssetPolicyRegistry } from "../../src/allowlist-active-policy.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { Permit2ProductionPreparation } from "../../src/x402-permit2/production-prepare.js";
import { Permit2ProductionJournal } from "../../src/x402-permit2/production-journal.js";
import { createPermit2ProductionMaterial } from "../../src/x402-permit2/production-material.js";
import { productionRecordBody, sealPermit2ProductionRecord, productionUsageIdentity } from "../../src/x402-permit2/production-repository.js";
import { createPermit2ProductionSigned } from "../../src/x402-permit2/production-signed.js";
import { observePermit2Production } from "../../src/x402-permit2/production-observer.js";
import { X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import { observerFixture } from "./x402-permit2-production-observer-fixture.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";
import { activateDirectPolicy, revokeDirectPolicy } from "./direct-allowlist-helpers.js";

export async function journalFixture(t: TestContext, sponsor = false, maxTimeoutSeconds = 60, policyExpiresAt?: string) {
  const f = await observerFixture(t, sponsor, maxTimeoutSeconds), root = f.input.stateRoot, state = new StateStore(root);
  let clock = new Date((protocolSecond + 1) * 1000);
  const now = () => new Date(clock), original = f.record.material, date = f.record.createdAt;
  const m = { ...original, wallet: { ...original.wallet, bindingHash: hashObject({ profile: "owner", address: original.wallet.account, createdAt: date }) } };
  await state.writeWallet(sealWallet({ schemaVersion: STATE_VERSION, profile: "owner", profileHash: m.wallet.profileHash,
    address: m.wallet.account, createdAt: date, bindingHash: m.wallet.bindingHash }));
  await state.writeEncryptedWalletEnvelope("owner", { schemaVersion: "apn.wallet-envelope.v1",
    identity: { profile: "owner", address: m.wallet.account, chainId: 8453, createdAt: date, bindingHash: m.wallet.bindingHash },
    kdf: { name: "HKDF-SHA-256", salt: "fixture" }, cipher: { name: "AES-256-GCM", nonce: "fixture", ciphertext: "fixture", tag: "fixture" } });
  await activateDirectPolicy(root, "owner", { accounts: { evm: m.wallet.account }, now: new Date(protocolSecond * 1000),
    ...(policyExpiresAt === undefined ? {} : { expiresAt: policyExpiresAt }),
    admissions: [{ chain: f.prepared.chain, kind: "token", identifier: f.prepared.token, rail: "x402", maximumPerTransferAtomic: "20000",
      dailyLimitAtomic: "30000", mechanism: X402_PERMIT2_MECHANISM }] });
  const active = await loadActiveAssetPolicyRegistry(root, "owner", now()); assert.ok(active);
  const { materialHash: _h, preparedCanonicalJson: _p, typedDataDigest: _t, eip2612Digest: _e, ...source } = m;
  const material = createPermit2ProductionMaterial({ ...source, owner: { ...m.owner, policyDigest: active.digest },
    checkpoint: { ...m.checkpoint, registryVersion: active.registry.registryVersion, policyRevision: active.revision,
      activationDigest: active.activationDigest } });
  const record = sealPermit2ProductionRecord({ ...productionRecordBody(f.record), material });
  const preparation = new Permit2ProductionPreparation(root, { now, rpc: { batch: async () => { throw new Error("Unexpected preparation RPC"); } } });
  await preparation.records.ready();
  await state.withLocks([`profile:${record.profileHash}`, `operation:${record.operationId}`],
    () => preparation.records.persistPreparedLocked(record, { now }));
  const reserved = await preparation.reserve(record.operationId);
  const signed = await createPermit2ProductionSigned(reserved, f.permit2Signature, f.eip2612Signature, protocolSecond + 1);
  const journal = new Permit2ProductionJournal(root, preparation, now), usage = new AssetUsageLedger(root);
  async function observe(mode: "settlement" | "expired_unused") {
    const saved = await journal.findOperation(record.operationId); assert.ok(saved);
    (f.input as { mode: string }).mode = mode;
    return observePermit2Production({ ...f.input, record: saved, signed: saved.exposureJournal?.signed ?? null,
      mode, locator: mode === "settlement" ? f.input.locator : null });
  }
  async function lease() { return (await usage.usageWithReservation(productionUsageIdentity(record), record.usageReservationId, now())).reservation!; }
  return { ...f, root, state, preparation, journal, usage, record, reserved, signed, now, observe, lease,
    advance: (seconds: number) => { clock = new Date((protocolSecond + seconds) * 1000); },
    revoke: () => revokeDirectPolicy(root, "owner", now()) };
}

/** A real direct USDC transfer of the same profile on the Permit2 chain and account, written through `StateStore.writeOperation`
 * (the direct transfer's own write path and write guard) and walked to an unresolved broadcast; `settle` finalizes it. */
export async function foreignDirectTransfer(state: StateStore, profile: string, account: Address, at: Date) {
  const asset: EvmAsset = { schemaVersion: "apn.evm-asset.v1", chainId: 43114, kind: "erc20",
    address: getAddress("0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E") as Address, decimals: 6, decimalsSource: "onchain" };
  const recipient = getAddress(`0x${"12".repeat(20)}`) as Address, amountAtomic = "1000", wire = evmTransaction(asset, account, recipient, amountAtomic);
  const maximumGasCostAtomic = (65_000n * 30_000_000_000n).toString(), preparedAt = at.toISOString();
  const evm: EvmDirectBinding = { schemaVersion: "apn.evm-direct.v1", asset, transactionTo: wire.to, valueAtomic: wire.valueAtomic,
    maxFeeWei: maximumGasCostAtomic, feeQuote: { chainId: 43114, l1DataFeeUpperWei: "0", operatorFeeUpperWei: "0",
      maximumExecutionFeeWei: maximumGasCostAtomic, totalQuoteWei: maximumGasCostAtomic, totalFeeEnforcedOnchain: false,
      blockNumberAtomic: "1", blockHash: `0x${"ab".repeat(32)}`, rpcOrigin: "https://api.avax.network", observedAt: preparedAt } };
  type Body = Omit<OperationRecord, "integrityHash" | "fingerprint" | "state" | "terminal" | "reason" | "proofClass" | "transitions">;
  const body: Body = { schemaVersion: STATE_VERSION, operationId: state.operationId(profile, "foreign-avalanche-direct"),
    idempotencyHash: state.idempotencyHash("foreign-avalanche-direct"), profile, profileHash: state.profileHash(profile),
    requestHash: "3".repeat(64), walletAddress: account, recipient, amountAtomic, amountDecimal: formatAtomic(amountAtomic, 6),
    chainId: 43114, token: asset.address, transactionData: wire.data, economics: { nonceAtomic: "0", gasLimitAtomic: "65000",
      maxFeePerGasAtomic: "30000000000", maxPriorityFeePerGasAtomic: "1000000000", maximumGasCostAtomic },
    preparedBlockNumberAtomic: "1", preparedAt, expiresAt: new Date(at.getTime() + 60_000).toISOString(), evm };
  let operation = sealOperation({ ...body, fingerprint: evmDirectFingerprint(body), state: "awaiting_approval", terminal: false,
    reason: "prepared_and_frozen", proofClass: "durable_pre_effect", transitions: appendTransition([], { at: preparedAt,
      state: "awaiting_approval", terminal: false, reason: "prepared_and_frozen", proofClass: "durable_pre_effect" }) });
  await state.writeOperation(operation);
  const advance = async (steps: readonly (readonly [OperationState, boolean, string, string])[], extra: Partial<OperationRecord> = {}) => {
    let transitions = operation.transitions;
    for (const [next, terminal, reason, proofClass] of steps) transitions = appendTransition(transitions, { at: preparedAt, state: next, terminal, reason, proofClass });
    const { integrityHash: _previous, ...base } = operation, [last] = steps.slice(-1) as [readonly [OperationState, boolean, string, string]];
    operation = sealOperation({ ...base, ...extra, state: last[0], terminal: last[1], reason: last[2], proofClass: last[3], transitions });
    await state.writeOperation(operation); return operation;
  };
  const transactionHash = `0x${"cd".repeat(32)}` as Hex;
  await advance([["started", false, "foreground_signing_started", "durable_pre_effect"],
    ["signed_not_submitted", false, "native_effect_material_bound", "native_transaction_hash"],
    ["unknown_finality", false, "submission_outcome_ambiguous", "ambiguous_submission"]], { transactionHash, rawTransactionHash: transactionHash });
  return { operation, settle: () => advance([["completed", true, "confirmed_exact_erc20_transfer", "included_exact_transfer_event"]]) };
}
