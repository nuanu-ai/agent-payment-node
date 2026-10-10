import assert from "node:assert/strict";
import test from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1";
import { LocalWalletNative } from "../../src/local-wallet-native.js";
import { EncryptedWalletStore, walletCustodyLock } from "../../src/encrypted-wallet-store.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { Permit2ForegroundApprovalAuthority } from "../../src/x402-permit2/production-approval-provenance.js";
import { permit2ApprovalDisplay, TtyPermit2ForegroundApproval, type Permit2ApprovalDisplay, type Permit2ApprovalPurpose } from "../../src/x402-permit2/production-approval.js";
import { reconstructPermit2ProductionMaterial } from "../../src/x402-permit2/production-material.js";
import { productionApprovalFingerprint } from "../../src/x402-permit2/production-journal-codec.js";
import { Permit2ProductionJournal } from "../../src/x402-permit2/production-journal.js";
import { Permit2ProductionRepository, productionUsageIdentity } from "../../src/x402-permit2/production-repository.js";
import { Permit2ProductionSigningFence } from "../../src/x402-permit2/production-signing-fence.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";
import { protocolSecond } from "./x402-permit2-production-protocol-fixture.js";
export async function paidHttpFixture(t: test.TestContext, purpose: Permit2ApprovalPurpose = "sign-and-submit-once", sponsor = false, maxTimeoutSeconds = 120, policyExpiresAt?: string) {
  const f = await journalFixture(t, sponsor, maxTimeoutSeconds, policyExpiresAt); (f.input as { mode: string }).mode = "expired_unused";
  f.wire.finalized.timestamp = `0x${protocolSecond.toString(16)}`;
  let keys = 0, signatures = 0, displayed: Permit2ApprovalDisplay | undefined;
  const wrapping = { load: async () => { keys++; return Buffer.alloc(32, 7); }, create: async () => { throw new Error("No key creation"); } };
  await new EncryptedWalletStore(f.state, wrapping).save({ profile: "owner", address: f.record.material.wallet.account,
    chainId: 8453, createdAt: f.record.createdAt, bindingHash: f.record.material.wallet.bindingHash },
  { version: "apn.wallet-secret.v1", privateKey: `0x${"1".repeat(64)}`, directEffects: {}, x402Effects: {} }, Buffer.alloc(32, 7));
  const native = new LocalWalletNative(f.state, wrapping), fence = new Permit2ProductionSigningFence(f.root, f.input.rpcUrl, f.now);
  const capability = LocalWalletNative.resolvePermit2LocalCapability(native, f.root);
  const proof = await new Permit2ForegroundApprovalAuthority(f.journal, {}, native, capability,
    { approve: async d => { displayed = d; } }, f.now).approveOwned(f.record.operationId, purpose);
  const approved = await f.journal.markApprovedSignatureRisk(f.record.operationId, proof); assert.ok(approved.continuation);
  const originalSign = secp256k1.sign;
  t.mock.method(secp256k1, "sign", (...args: Parameters<typeof originalSign>) => { signatures++; return originalSign(...args); });
  const signed = await native.signPermit2Production(f.journal, fence, f.record.operationId, approved.continuation);
  const records = new Permit2ProductionRepository(f.root), id = f.record.operationId;
  return { ...f, native, fence, signed, id, records, wrapping, keys: () => keys, signatures: () => signatures,
    display: () => displayed!, begin: () => native.beginPermit2ProductionRequest(f.journal, fence, id, signed.signingOrigin) };
}
