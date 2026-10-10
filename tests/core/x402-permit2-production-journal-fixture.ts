import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { StateStore, sealWallet } from "../../src/state.js";
import { hashObject } from "../../src/canonical.js";
import { STATE_VERSION } from "../../src/constants.js";
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
  const preparation = new Permit2ProductionPreparation(root, { now, rpc: { call: async () => { throw new Error("Unexpected preparation RPC"); } } });
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
