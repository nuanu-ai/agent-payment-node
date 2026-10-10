import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";
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
/** First sign only. There is deliberately no private material restore/unseal API for recovery dispatch. */
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
