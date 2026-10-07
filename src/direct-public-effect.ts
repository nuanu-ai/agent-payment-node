import { generateKeyPairSync, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { recoverMessageAddress } from "viem";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import { walletEnvelopeIdentity, type DirectEffectMaterial } from "./encrypted-wallet-store.js";
import { ApnError } from "./errors.js";
import { assertEvmNativeCustody, evmNativeCustody, validateEvmNativeCustody, type EvmNativeCustody } from "./evm-native-custody.js";
import { evmCustodyPayload } from "./evm-transfer-approval.js";
import type { Hex, OperationRecord } from "./model.js";
import { SecureStateStore } from "./secure-state-store.js";
import type { StateStore } from "./state.js";

export function directCustodyPayload(operation: OperationRecord): Readonly<Record<string, unknown>> {
  if (operation.evm !== undefined) return evmCustodyPayload(operation);
  const e = operation.economics;
  if (e === undefined || operation.transactionData === undefined || operation.providerDirect !== undefined || operation.chainId !== CHAIN_ID || operation.token !== BASE_USDC) corrupt();
  return { profile: operation.profile, operationId: operation.operationId, fingerprint: operation.fingerprint,
    walletAddress: operation.walletAddress, chainId: CHAIN_ID,
    transaction: { type: "eip1559", to: BASE_USDC, valueAtomic: "0", data: operation.transactionData,
      nonceAtomic: e.nonceAtomic, gasLimitAtomic: e.gasLimitAtomic, maxFeePerGasAtomic: e.maxFeePerGasAtomic,
      maxPriorityFeePerGasAtomic: e.maxPriorityFeePerGasAtomic, accessList: [] },
    approval: { recipient: operation.recipient, amountAtomic: operation.amountAtomic, amountDecimal: operation.amountDecimal, expiresAt: operation.expiresAt } };
}
interface Binding { readonly profile: string; readonly operationId: string; readonly profileHash: string; readonly fingerprint: string; readonly payloadHash: string; readonly custody: EvmNativeCustody }
interface DirectSigningAttempt { readonly binding: Binding; readonly operationIntegrityHash: string; readonly preparedRecordHash: string; readonly signingRecordHash: string }
export interface DirectPublicEffect { readonly transactionHash: Hex; readonly rawTransactionHash: Hex }
/** Hash-only evidence. Raw signed material stays exclusively in encrypted wallet custody. */
export class DirectPublicEffectJournal extends SecureStateStore {
  private readonly freshAttempts = new WeakMap<DirectSigningAttempt, KeyObject>();
  constructor(private readonly state: StateStore) { super(state.root); }
  private path(operation: OperationRecord, phase: "prepared" | "signing" | "signed" | "no-private-entry") { return join("direct-public-effects", operation.profileHash, `${operation.operationId}.${phase}.json`); }
  private binding(operation: OperationRecord, custody: EvmNativeCustody): Binding {
    return { profile: operation.profile, operationId: operation.operationId, profileHash: operation.profileHash, fingerprint: operation.fingerprint,
      payloadHash: hashObject(directCustodyPayload(operation)), custody };
  }
  async prepare(operation: OperationRecord): Promise<void> {
    const custody = operation.evm?.nativeCustody ?? await evmNativeCustody(this.state, operation.profile);
    const binding = this.binding(operation, custody); await this.assertCustody(operation, custody);
    await this.ensureDirectory(join("direct-public-effects", operation.profileHash));
    const existing = await this.readJson(this.path(operation, "prepared"));
    if (existing !== null) { await this.prepared(operation); return; }
    const body = { schemaVersion: "apn.direct-public-prepared.v1", binding };
    await this.writeJson(this.path(operation, "prepared"), { ...body, integrityHash: hashObject(body) }, true);
  }
  async prepared(operation: OperationRecord): Promise<Binding> {
    const saved = await this.state.findOperation(operation.operationId);
    if (saved === null || saved.integrityHash !== operation.integrityHash || saved.profileHash !== operation.profileHash ||
        hashObject(directCustodyPayload(saved)) !== hashObject(directCustodyPayload(operation))) corrupt();
    const value = await this.readJson(this.path(operation, "prepared"));
    if (value === null) missing();
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "binding", "integrityHash"]) || value.schemaVersion !== "apn.direct-public-prepared.v1" ||
        value.integrityHash !== hashObject({ schemaVersion: value.schemaVersion, binding: value.binding }) || !isPlainRecord(value.binding)) corrupt();
    const custody = validateEvmNativeCustody(value.binding.custody);
    if (hashObject(value.binding) !== hashObject(this.binding(operation, custody))) corrupt();
    if (operation.evm !== undefined && hashObject(custody) !== hashObject(operation.evm.nativeCustody)) corrupt();
    await this.assertCustody(operation, custody); return value.binding as unknown as Binding;
  }
  private async assertCustody(operation: OperationRecord, custody: EvmNativeCustody): Promise<void> {
    await assertEvmNativeCustody(this.state, operation.profile, custody);
    const envelope = await this.state.loadEncryptedWalletEnvelope(operation.profile);
    if (envelope === null) missing();
    await assertEvmNativeCustody(this.state, operation.profile, custody, walletEnvelopeIdentity(envelope, operation.profile));
    if (custody.walletAddress !== operation.walletAddress) corrupt();
  }
  async assertUnstarted(operation: OperationRecord): Promise<void> {
    // Legacy ciphertext exposes no effect-slot index. Only a prepared new-protocol claim can establish this boundary.
    await this.prepared(operation);
    if (operation.state !== "awaiting_approval" || await this.readJson(this.path(operation, "signing")) !== null ||
        await this.readJson(this.path(operation, "signed")) !== null) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Public signing evidence or an unprovable legacy slot prevents no-effect classification; retain the nonce.", { reason: "direct_signing_evidence_retained" });
    }
  }
  async beginSigning(operation: OperationRecord): Promise<DirectSigningAttempt> {
    const binding = await this.prepared(operation);
    // Persist each containing directory before publishing the attempt fence.
    for (const path of [this.root, join(this.root, "direct-public-effects"), join(this.root, "direct-public-effects", operation.profileHash)]) {
      const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    }
    const preparedRecord = await this.readJson(this.path(operation, "prepared"));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicOutcomeKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const signingRecord = { schemaVersion: "apn.direct-public-signing.v2", binding, publicOutcomeKey };
    await this.writeJson(this.path(operation, "signing"), signingRecord, true);
    const attempt = Object.freeze({ binding, operationIntegrityHash: operation.integrityHash,
      preparedRecordHash: hashObject(preparedRecord), signingRecordHash: hashObject(signingRecord) });
    this.freshAttempts.set(attempt, privateKey);
    return attempt;
  }
  /** Called only by the catch before Native enters withWallet, with its own freshly minted attempt. */
  async recordNoPrivateEntry(operation: OperationRecord, attempt: DirectSigningAttempt): Promise<void> {
    const privateKey = this.freshAttempts.get(attempt);
    this.freshAttempts.delete(attempt);
    if (privateKey === undefined) noPrivateBlocked();
    await this.checkNoPrivateContext(operation, attempt);
    const body = { schemaVersion: "apn.direct-public-no-private-entry.v2", domain: "APN_DIRECT_PREPRIVATE_OUTCOME_V1",
      phase: "pre_private_entry", outcome: "native_approval_returned_before_private_entry", ...attempt };
    await this.syncAncestors(operation);
    await this.checkNoPrivateContext(operation, attempt);
    // The ephemeral key authenticates Native control flow only; it is never a wallet/custody key.
    const controlFlowSignature = sign(null, Buffer.from(canonicalJson(body), "utf8"), privateKey).toString("base64");
    const signedBody = { ...body, controlFlowSignature };
    await this.writeJson(this.path(operation, "no-private-entry"), { ...signedBody, integrityHash: hashObject(signedBody) }, true);
    // A conflicting writer never grants no-effect recovery, including after durable publication.
    await this.checkNoPrivateContext(operation, attempt);
  }
  /** Absence alone grants nothing. A valid outcome belongs to exactly one canonical started attempt. */
  async noPrivateEntry(operation: OperationRecord): Promise<boolean> {
    try {
      const value = await this.readJson(this.path(operation, "no-private-entry"));
      if (value === null) return false;
      if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "domain", "phase", "outcome", "binding", "operationIntegrityHash", "preparedRecordHash", "signingRecordHash", "controlFlowSignature", "integrityHash"]) ||
          value.schemaVersion !== "apn.direct-public-no-private-entry.v2" || value.domain !== "APN_DIRECT_PREPRIVATE_OUTCOME_V1" ||
          value.phase !== "pre_private_entry" || value.outcome !== "native_approval_returned_before_private_entry") noPrivateBlocked();
      const { integrityHash, ...body } = value;
      if (integrityHash !== hashObject(body)) noPrivateBlocked();
      const attempt = { binding: value.binding, operationIntegrityHash: value.operationIntegrityHash,
        preparedRecordHash: value.preparedRecordHash, signingRecordHash: value.signingRecordHash } as DirectSigningAttempt;
      const publicOutcomeKey = await this.checkNoPrivateContext(operation, attempt);
      if (typeof value.controlFlowSignature !== "string") noPrivateBlocked();
      const signature = Buffer.from(value.controlFlowSignature, "base64");
      if (signature.length !== 64 || signature.toString("base64") !== value.controlFlowSignature) noPrivateBlocked();
      const { controlFlowSignature: _, ...unsignedBody } = body;
      const key = createPublicKey({ key: Buffer.from(publicOutcomeKey, "base64"), type: "spki", format: "der" });
      if (key.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(canonicalJson(unsignedBody), "utf8"), key, signature)) noPrivateBlocked();
      // Repeat authoritative operation/claim/custody and conflict checks after signature verification and asynchronous reads.
      if (await this.checkNoPrivateContext(operation, attempt) !== publicOutcomeKey) noPrivateBlocked();
      return true;
    } catch { noPrivateBlocked(); }
  }
  private async checkNoPrivateContext(operation: OperationRecord, attempt: DirectSigningAttempt): Promise<string> {
    if (operation.state !== "started" || operation.terminal || operation.transactionHash !== undefined || operation.rawTransactionHash !== undefined ||
        operation.lastSubmissionAt !== undefined || operation.providerEffect !== undefined || attempt.operationIntegrityHash !== operation.integrityHash) noPrivateBlocked();
    const binding = await this.prepared(operation);
    const preparedRecord = await this.readJson(this.path(operation, "prepared")), signingRecord = await this.readJson(this.path(operation, "signing"));
    if (hashObject(binding) !== hashObject(attempt.binding) || attempt.preparedRecordHash !== hashObject(preparedRecord) ||
        !isPlainRecord(signingRecord) || !exactKeys(signingRecord, ["schemaVersion", "binding", "publicOutcomeKey"]) || signingRecord.schemaVersion !== "apn.direct-public-signing.v2" ||
        hashObject(signingRecord.binding) !== hashObject(binding) || attempt.signingRecordHash !== hashObject(signingRecord)) noPrivateBlocked();
    if (typeof signingRecord.publicOutcomeKey !== "string") noPrivateBlocked();
    const keyBytes = Buffer.from(signingRecord.publicOutcomeKey, "base64");
    if (keyBytes.length !== 44 || keyBytes.toString("base64") !== signingRecord.publicOutcomeKey) noPrivateBlocked();
    await this.prepared(operation);
    // Check conflicts after the last asynchronous authoritative claim/custody read.
    // Canonical lifecycle writers hold the enclosing profile/operation/custody locks.
    if (await this.readJson(this.path(operation, "signed")) !== null ||
        await this.readJson(join("direct-submissions", operation.profileHash, `${operation.operationId}.json`)) !== null) noPrivateBlocked();
    return signingRecord.publicOutcomeKey;
  }
  private async syncAncestors(operation: OperationRecord): Promise<void> {
    for (const path of [this.root, join(this.root, "direct-public-effects"), join(this.root, "direct-public-effects", operation.profileHash)]) {
      const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }
  async attestationMessage(operation: OperationRecord, effect: DirectPublicEffect): Promise<string> {
    const binding = await this.prepared(operation);
    const body = { domain: "APN_DIRECT_PUBLIC_EFFECT_PROOF_V1", binding, chainId: operation.chainId,
      nonceAtomic: operation.economics?.nonceAtomic, transactionHash: effect.transactionHash, rawTransactionHash: effect.rawTransactionHash };
    const message = canonicalJson(body);
    if (Buffer.byteLength(message, "utf8") > 4096 || operation.economics === undefined) corrupt();
    return message;
  }
  private async verifyAttestation(operation: OperationRecord, effect: DirectPublicEffect, signature: unknown): Promise<void> {
    if (typeof signature !== "string" || !/^0x[a-f0-9]{130}$/u.test(signature)) corrupt();
    const s = BigInt(`0x${signature.slice(66, 130)}`), v = signature.slice(130);
    if (s === 0n || s > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n || !["1b", "1c"].includes(v)) corrupt();
    let recovered: string;
    try { recovered = await recoverMessageAddress({ message: await this.attestationMessage(operation, effect), signature: signature as Hex }); }
    catch { corrupt(); }
    if (recovered.toLowerCase() !== operation.walletAddress.toLowerCase()) corrupt();
    // Crypto is asynchronous. Re-read authoritative public material and custody after it resolves.
    await this.prepared(operation);
  }
  async publish(operation: OperationRecord, effect: DirectEffectMaterial, attestation: Hex): Promise<void> {
    if (await this.readJson(this.path(operation, "no-private-entry")) !== null) noPrivateBlocked();
    const binding = await this.prepared(operation);
    if (effect.payloadHash !== binding.payloadHash || effect.transactionHash !== effect.rawTransactionHash) corrupt();
    await this.verifyAttestation(operation, effect, attestation);
    if (await this.readJson(this.path(operation, "no-private-entry")) !== null) noPrivateBlocked();
    const body = { schemaVersion: "apn.direct-public-signed.v1", binding, attestation, transactionHash: effect.transactionHash, rawTransactionHash: effect.rawTransactionHash };
    await this.writeJson(this.path(operation, "signed"), { ...body, integrityHash: hashObject(body) }, true);
  }
  async effect(operation: OperationRecord): Promise<DirectPublicEffect> {
    if (await this.readJson(this.path(operation, "no-private-entry")) !== null) noPrivateBlocked();
    const binding = await this.prepared(operation), value = await this.readJson(this.path(operation, "signed"));
    if (value === null) missing();
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "binding", "attestation", "transactionHash", "rawTransactionHash", "integrityHash"]) ||
        value.schemaVersion !== "apn.direct-public-signed.v1" || hashObject(value.binding) !== hashObject(binding) ||
        typeof value.transactionHash !== "string" || !/^0x[a-f0-9]{64}$/u.test(value.transactionHash) || value.rawTransactionHash !== value.transactionHash ||
        value.integrityHash !== hashObject({ schemaVersion: value.schemaVersion, binding: value.binding, attestation: value.attestation, transactionHash: value.transactionHash, rawTransactionHash: value.rawTransactionHash })) corrupt();
    if (operation.transactionHash !== undefined && operation.transactionHash !== value.transactionHash ||
        operation.rawTransactionHash !== undefined && operation.rawTransactionHash !== value.rawTransactionHash) corrupt();
    const effect = { transactionHash: value.transactionHash as Hex, rawTransactionHash: value.rawTransactionHash as Hex };
    await this.verifyAttestation(operation, effect, value.attestation);
    return Object.freeze(effect);
  }
  async hasSigned(operation: OperationRecord): Promise<boolean> { return await this.readJson(this.path(operation, "signed")) !== null; }
}
function missing(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Public direct effect evidence is missing; retain this operation for manual resolution.", { reason: "direct_public_evidence_missing" }); }
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Public direct effect evidence does not bind the saved operation."); }

function noPrivateBlocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "A no-private-entry outcome does not prove this unchanged canonical attempt; retain the operation.", { reason: "direct_no_private_entry_unprovable" }); }
