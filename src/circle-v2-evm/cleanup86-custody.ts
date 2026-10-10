import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject, exactKeys, isPlainRecord } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
import { Cleanup86Store, type Cleanup86Intent } from "./cleanup86-store.js";
import { assertCleanup86CurrentPermission, verifiedCleanup86CurrentPurpose, type VerifiedCleanup86CurrentPurpose } from "./cleanup86-current-purpose.js";
import type { Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { assertCleanup86Grant, claimCleanup86Custody, type Cleanup86Grant } from "./cleanup86-controller.js";
export interface Cleanup86Material { readonly version: "apn.circle-cleanup86-material.v1"; readonly intentHash: string; readonly recoveryBinding: string; readonly envelopeHash: string; readonly rawTransaction: Hex; readonly transactionHash: Hex; readonly materialHash: string; }
import { assertCleanup86FirstDispatchGrant, type Cleanup86FirstDispatchGrant } from "./cleanup86-first-dispatch-authority.js";
import { Cleanup86SnapshotStore } from "./cleanup86-snapshot.js";
import { assertAuthenticatedCleanup86FirstDispatchJournal, type Cleanup86FirstDispatchJournal } from "./cleanup86-first-dispatch-journal.js";
import { assertCleanup86RestoredWire } from "./cleanup86-wire-validation.js";
/** Internal custody boundary: restoration requires a live controller-issued capability. */
export class Cleanup86Custody extends SecureStateStore {
  private readonly wallets: EncryptedWalletStore;
  constructor(private readonly state: StateStore, private readonly wrapping: WrappingSecretPort) { super(state.root); this.wallets = new EncryptedWalletStore(state, wrapping); }
  private path(op: CircleOperationV1) { return `circle-cleanup85-recovery/${op.operationId}-cleanup86-material.json`; }
  async assertAbsent(op: CircleOperationV1): Promise<void> { if (await this.readJson(this.path(op)) !== null) circleBlocked("cleanup86_material_already_present_observe_only"); }
  async publicMetadata(op: CircleOperationV1, i: Cleanup86Intent): Promise<{ transactionHash: Hex; materialHash: string } | null> {
    const h = await this.readJson(this.path(op)); if (h === null) return null;
    if (!isPlainRecord(h) || !exactKeys(h, ["version", "operationId", "intentHash", "recoveryBinding", "envelopeHash", "materialHash", "transactionHash", "salt", "nonce", "ciphertext", "tag"]) || h.version !== "apn.circle-cleanup86-envelope.v1" || h.operationId !== op.operationId || h.intentHash !== i.intentHash || h.recoveryBinding !== i.recoveryBinding || h.envelopeHash !== i.envelope.envelopeHash || typeof h.materialHash !== "string" || !/^[a-f0-9]{64}$/u.test(h.materialHash) || typeof h.transactionHash !== "string" || !/^0x[a-f0-9]{64}$/u.test(h.transactionHash) || typeof h.ciphertext !== "string" || h.ciphertext.length === 0) circleBlocked("cleanup86_material_metadata_changed");
    return { transactionHash: h.transactionHash as Hex, materialHash: h.materialHash };
  }
  async seal(op: CircleOperationV1, i: Cleanup86Intent, grant: Cleanup86Grant, beforePrivate: () => Promise<void>): Promise<Cleanup86Material> {
    if (["apn.circle-cleanup86-intent.v3", "apn.circle-cleanup86-intent.v4", "apn.circle-cleanup86-intent.v5"].includes(i.version)) circleBlocked("cleanup86_private_current_custody_required");
    const gate = () => assertCleanup86Grant(grant, this.state.root, op, i);
    gate(); if (!await new Cleanup86Store(this.root).claimed(op, i, "sign")) circleBlocked("cleanup86_sign_claim_required"); gate(); await this.assertAbsent(op); gate();
    return this.state.withLocks([`custody:${op.sourceCustody.profileHash}`], async () => {
      claimCleanup86Custody(grant, this.state.root, op, i); gate();
      if (!await new Cleanup86Store(this.root).claimed(op, i, "sign")) circleBlocked("cleanup86_sign_claim_required");
      await this.assertAbsent(op); gate();
      await beforePrivate(); gate(); await assertEvmNativeCustody(this.state, op.profile, op.sourceCustody); gate();
      const wallet = await this.wallets.describe(op.profile, undefined, async identity => { await beforePrivate(); gate(); await assertEvmNativeCustody(this.state, op.profile, op.sourceCustody, identity); gate(); });
      if (wallet === null) circleBlocked("cleanup86_wallet_missing");
      try {
        await beforePrivate(); gate(); const account = privateKeyToAccount(wallet.secret.privateKey); if (account.address !== i.envelope.from) circleBlocked("cleanup86_derived_owner_changed");
        const e = i.envelope; gate(); const rawTransaction = await account.signTransaction({ type: "eip1559", chainId: 42161, to: e.to, data: e.data, value: 0n, nonce: 86, gas: BigInt(e.gasLimitAtomic), maxFeePerGas: BigInt(e.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGasAtomic), accessList: [] }); gate();
        const body = { version: "apn.circle-cleanup86-material.v1" as const, intentHash: i.intentHash, recoveryBinding: i.recoveryBinding, envelopeHash: e.envelopeHash, rawTransaction, transactionHash: keccak256(rawTransaction) }, material = { ...body, materialHash: hashObject(body) };
        await this.encrypt(op, material, gate); return material;
      } finally { this.wallets.clear(wallet.secret); }
    });
  }
  /** V3 only: the opaque admission's live financial scope already owns this exact custody lock.
   * No public lock flag or callback can select this path. Legacy seal keeps its own lock. */
  async sealCurrent(op: CircleOperationV1, i: Cleanup86Intent, grant: Cleanup86Grant, recovery: Cleanup85RecoveryIntent, certificate: VerifiedCleanup86CurrentPurpose): Promise<Cleanup86Material> {
    const gate = () => {
      assertCleanup86Grant(grant, this.state.root, op, i);
      const purpose = verifiedCleanup86CurrentPurpose(certificate, this.state, op, recovery, i.envelope);
      if (!["apn.circle-cleanup86-intent.v3", "apn.circle-cleanup86-intent.v4", "apn.circle-cleanup86-intent.v5"].includes(i.version) || hashObject(purpose) !== hashObject(i.currentPurpose)) circleBlocked("cleanup86_private_current_custody_required");
    };
    const permission = async () => { gate(); await new Cleanup86Store(this.root).assertGeneration(op,i); gate(); if (!await new Cleanup86Store(this.root).claimed(op,i,"sign")) circleBlocked("cleanup86_sign_claim_required"); await assertCleanup86CurrentPermission(certificate, this.state, op, recovery, i.envelope); gate(); };
    gate(); if (!await new Cleanup86Store(this.root).claimed(op, i, "sign")) circleBlocked("cleanup86_sign_claim_required"); gate(); await this.assertAbsent(op); gate();
    claimCleanup86Custody(grant, this.state.root, op, i); gate(); await permission();
    const wallet = await this.wallets.describe(op.profile, gate, async identity => { await permission(); await assertEvmNativeCustody(this.state, op.profile, op.sourceCustody, identity); gate(); });
    if (wallet === null) circleBlocked("cleanup86_wallet_missing");
    try {
      await permission(); const account = privateKeyToAccount(wallet.secret.privateKey); if (account.address !== i.envelope.from) circleBlocked("cleanup86_derived_owner_changed");
      const e = i.envelope; gate(); const rawTransaction = await account.signTransaction({ type: "eip1559", chainId: 42161, to: e.to, data: e.data, value: 0n, nonce: 86, gas: BigInt(e.gasLimitAtomic), maxFeePerGas: BigInt(e.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGasAtomic), accessList: [] }); gate();
      const body = { version: "apn.circle-cleanup86-material.v1" as const, intentHash: i.intentHash, recoveryBinding: i.recoveryBinding, envelopeHash: e.envelopeHash, rawTransaction, transactionHash: keccak256(rawTransaction) }, material = { ...body, materialHash: hashObject(body) };
      await this.encrypt(op, material, gate); gate(); return material;
    } finally { this.wallets.clear(wallet.secret); }
  }
  async restoreFirstDispatch(op: CircleOperationV1, i: Cleanup86Intent, recovery: Cleanup85RecoveryIntent, grant: Cleanup86FirstDispatchGrant, metadata: { readonly transactionHash: Hex; readonly materialHash: string }, journal: Cleanup86FirstDispatchJournal): Promise<Cleanup86Material> {
    const binding = { root: this.state.root, operationId: op.operationId, intentHash: i.intentHash, recoveryId: recovery.recoveryBinding, envelopeHash: i.envelope.envelopeHash, transactionHash: metadata.transactionHash, materialHash: metadata.materialHash };
    const gate = () => {
      assertCleanup86FirstDispatchGrant(grant, binding, "restore");
      assertAuthenticatedCleanup86FirstDispatchJournal(journal, grant, binding);
      if (journal.root !== this.state.root || hashObject(journal.operation) !== hashObject(op) || hashObject(journal.intent) !== hashObject(i)) circleBlocked("cleanup86_restored_journal_binding");
    };
    gate();
    const { intentHash, ...intentBody } = i, { recoveryBinding, ...recoveryBody } = recovery;
    if (intentHash !== hashObject(intentBody) || recoveryBinding !== hashObject(recoveryBody) || i.recoveryBinding !== recoveryBinding || recovery.parentOperationId !== op.operationId || i.envelope.from !== op.sourceCustody.walletAddress || hashObject(recovery.sourceCustody) !== hashObject(op.sourceCustody)) circleBlocked("cleanup86_restored_intent_binding");
    await journal.assertStable(); gate();
    const snapshots = new Cleanup86SnapshotStore(this.state.root), original = await snapshots.capture(op.operationId); gate();
    const stable = async () => {
      gate(); await journal.assertStable(); gate();
      if (hashObject(await snapshots.capture(op.operationId)) !== hashObject(original)) circleBlocked("cleanup86_snapshot_drift");
      gate();
    };
    await stable();
    // Read exclusively from the complete nofollow/nlink=1 protected capture, never readJson.
    const h = original.entries[`${op.operationId}-cleanup86-material.json`]?.value; gate();
    if (!isPlainRecord(h) || !exactKeys(h, ["version", "operationId", "intentHash", "recoveryBinding", "envelopeHash", "materialHash", "transactionHash", "salt", "nonce", "ciphertext", "tag"]) || h.version !== "apn.circle-cleanup86-envelope.v1" || h.operationId !== op.operationId || h.intentHash !== intentHash || h.recoveryBinding !== recoveryBinding || h.envelopeHash !== binding.envelopeHash || h.materialHash !== metadata.materialHash || h.transactionHash !== metadata.transactionHash || !/^[a-f0-9]{64}$/u.test(metadata.materialHash) || !/^0x[a-f0-9]{64}$/u.test(metadata.transactionHash)) circleBlocked("cleanup86_material_metadata_changed");
    const decode = (value: unknown, length?: number): Buffer => {
      if (typeof value !== "string" || value.length === 0) circleBlocked("cleanup86_material_cipher_shape");
      const bytes = Buffer.from(value, "base64");
      if (bytes.toString("base64") !== value || length !== undefined && bytes.length !== length || bytes.length === 0) { bytes.fill(0); circleBlocked("cleanup86_material_cipher_shape"); }
      return bytes;
    };
    const salt = decode(h.salt, 32), nonce = decode(h.nonce, 12), ciphertext = decode(h.ciphertext), tag = decode(h.tag, 16);
    let wrapping: Buffer | null = null, key = Buffer.alloc(0), plaintext = Buffer.alloc(0);
    try {
      await stable(); gate(); wrapping = await this.wrapping.load(); gate(); await stable();
      if (wrapping === null || wrapping.length !== 32) circleBlocked("cleanup86_wrapping_missing");
      const { ciphertext: _ciphertext, tag: _tag, ...header } = h;
      key = Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(canonicalJson(header)), 32));
      gate();
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, nonce); decipher.setAAD(Buffer.from(canonicalJson(header))); decipher.setAuthTag(tag);
        const partial = decipher.update(ciphertext);
        try { plaintext = Buffer.concat([partial, decipher.final()]); } finally { partial.fill(0); }
      } catch { circleBlocked("cleanup86_material_authentication_failed"); }
      gate(); await stable();
      let value: unknown;
      try { const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext); value = JSON.parse(text) as unknown; if (text !== canonicalJson(value)) circleBlocked("cleanup86_material_plaintext_shape"); }
      catch { circleBlocked("cleanup86_material_plaintext_shape"); }
      if (!isPlainRecord(value) || !exactKeys(value, ["version", "intentHash", "recoveryBinding", "envelopeHash", "rawTransaction", "transactionHash", "materialHash"]) || value.version !== "apn.circle-cleanup86-material.v1" || value.intentHash !== intentHash || value.recoveryBinding !== recoveryBinding || value.envelopeHash !== binding.envelopeHash || value.transactionHash !== metadata.transactionHash || value.materialHash !== metadata.materialHash || typeof value.rawTransaction !== "string") circleBlocked("cleanup86_restored_material_binding");
      const { materialHash, ...body } = value;
      if (materialHash !== hashObject(body)) circleBlocked("cleanup86_restored_material_binding");
      const material = value as unknown as Cleanup86Material;
      gate(); await assertCleanup86RestoredWire(material.rawTransaction, i.envelope, material.transactionHash); gate(); await stable(); gate();
      return material;
    } finally { wrapping?.fill(0); key.fill(0); plaintext.fill(0); salt.fill(0); nonce.fill(0); ciphertext.fill(0); tag.fill(0); }
  }
  private async encrypt(op: CircleOperationV1, material: Cleanup86Material, gate: () => void): Promise<void> {
    gate(); const wrapping = await this.wrapping.load(); if (wrapping === null) circleBlocked("cleanup86_wrapping_missing");
    const salt = randomBytes(32), nonce = randomBytes(12), header = { version: "apn.circle-cleanup86-envelope.v1", operationId: op.operationId, intentHash: material.intentHash, recoveryBinding: material.recoveryBinding, envelopeHash: material.envelopeHash, materialHash: material.materialHash, transactionHash: material.transactionHash, salt: salt.toString("base64"), nonce: nonce.toString("base64") }, key = Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(canonicalJson(header)), 32)), plaintext = Buffer.from(canonicalJson(material));
    let ciphertext = Buffer.alloc(0);
    try {
      gate(); const cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(Buffer.from(canonicalJson(header))); ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]); gate();
      await this.writeJson(this.path(op), { ...header, ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") }, true); gate();
    } finally { wrapping.fill(0); salt.fill(0); nonce.fill(0); key.fill(0); plaintext.fill(0); ciphertext.fill(0); }
  }
}
