import {
  address, createKeyPairSignerFromPrivateKeyBytes, getBase64EncodedWireTransaction, getPublicKeyFromAddress,
  getSignatureFromTransaction, getTransactionDecoder, signTransaction, verifySignature,
} from "@solana/kit";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import type { ChainAccount, ChainWalletStoragePort, RailSignedEffect } from "../../direct-rail-ports.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { solanaSignature, type SolanaRpcPort } from "../../solana/rpc.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import { orcaAccountBindingHash, type OrcaOwnerAdmission } from "./admission.js";
import { compileOrcaSwap, type OrcaSwapLifetime } from "./instructions.js";
import { validateOrcaKeylessMaterial, type OrcaKeylessMaterial } from "./material.js";
import { sha256Hex } from "./pins.js";
import type { OrcaSimulationEvidence } from "./simulation.js";

const BINDING_VERSION = "apn.orca-whirlpool-execution-binding.v1" as const;
const HASH = /^[a-f0-9]{64}$/u;

/** Post-approval facts taken at the send boundary: a fresh lifetime and the exact-bytes simulation. */
export interface OrcaExecutionFreshness {
  readonly lifetime: OrcaSwapLifetime; readonly unsignedPayload: string; readonly messageHash: string;
  readonly networkFeeLamports: string; readonly simulation: OrcaSimulationEvidence; readonly blockHeight: string; readonly checkedAt: string;
}
export interface OrcaExecutionBinding extends OrcaExecutionFreshness {
  readonly schemaVersion: typeof BINDING_VERSION; readonly operationId: string; readonly operationIntegrityHash: string;
  readonly profileHash: string; readonly account: string; readonly accountBindingHash: string; readonly ownerAdmissionHash: string;
  readonly quoteHash: string; readonly submissionMarkerHash: string; readonly policyDigest: string; readonly mechanismDigest: string;
  readonly protocolRegistryDigest: string; readonly bindingHash: string;
}

export function createOrcaExecutionBinding(input: { readonly operation: SwapOperationRecord; readonly material: OrcaKeylessMaterial;
  readonly freshness: OrcaExecutionFreshness; readonly admission: OrcaOwnerAdmission }): OrcaExecutionBinding {
  const operation = validateSwapOperation(input.operation);
  if (operation.state !== "submitting" || operation.submissionMarker === null) blocked("Orca execution requires a durable submission marker.", "orca_marker_missing");
  const body = { schemaVersion: BINDING_VERSION, operationId: operation.operationId,
    operationIntegrityHash: operation.submissionMarker.operationIntegrityHash, profileHash: operation.ownerProfileHash,
    account: operation.quote.account, accountBindingHash: input.admission.accountBindingHash, ownerAdmissionHash: input.admission.admissionHash,
    quoteHash: operation.quote.quoteHash, submissionMarkerHash: operation.submissionMarker.markerHash, policyDigest: operation.policyDigest,
    mechanismDigest: operation.mechanismDigest, protocolRegistryDigest: operation.protocolRegistryDigest, ...freshnessOf(input.freshness) } as const;
  return validateOrcaExecutionBinding({ ...body, bindingHash: domainHash(BINDING_VERSION, canonicalJson(body)) }, operation, input.material);
}

/** Re-derives the exact signed-to-be bytes from the stored plan and the recorded lifetime; any drift is corruption. */
export function validateOrcaExecutionBinding(value: unknown, operationValue: SwapOperationRecord, materialValue: OrcaKeylessMaterial): OrcaExecutionBinding {
  const operation = validateSwapOperation(operationValue), material = validateOrcaKeylessMaterial(materialValue);
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "operationIntegrityHash", "profileHash", "account",
    "accountBindingHash", "ownerAdmissionHash", "quoteHash", "submissionMarkerHash", "policyDigest", "mechanismDigest", "protocolRegistryDigest",
    "lifetime", "unsignedPayload", "messageHash", "networkFeeLamports", "simulation", "blockHeight", "checkedAt", "bindingHash"]) ||
      value.schemaVersion !== BINDING_VERSION || !isPlainRecord(value.lifetime) || !isPlainRecord(value.simulation)) corrupt("Orca execution binding schema is invalid.");
  const binding = value as unknown as OrcaExecutionBinding, { bindingHash, ...body } = binding;
  let compiled: ReturnType<typeof compileOrcaSwap>;
  try { compiled = compileOrcaSwap(material.execution.plan, binding.lifetime); } catch { return corrupt("Orca execution bytes do not rebuild from the plan."); }
  if (typeof bindingHash !== "string" || bindingHash !== domainHash(BINDING_VERSION, canonicalJson(body)) || operation.submissionMarker === null ||
      binding.operationId !== operation.operationId || binding.operationIntegrityHash !== operation.submissionMarker.operationIntegrityHash ||
      binding.profileHash !== operation.ownerProfileHash || binding.account !== operation.quote.account || binding.quoteHash !== operation.quote.quoteHash ||
      binding.submissionMarkerHash !== operation.submissionMarker.markerHash || binding.policyDigest !== operation.policyDigest ||
      binding.mechanismDigest !== operation.mechanismDigest || binding.protocolRegistryDigest !== operation.protocolRegistryDigest ||
      !HASH.test(binding.accountBindingHash) || !HASH.test(binding.ownerAdmissionHash) || compiled.unsignedPayload !== binding.unsignedPayload ||
      compiled.messageHash !== binding.messageHash || binding.simulation.replaceRecentBlockhash !== false ||
      BigInt(binding.networkFeeLamports) > BigInt(material.execution.networkFeeLamports) ||
      BigInt(binding.simulation.usdcReceivedAtomic) < BigInt(operation.quote.minimumOutputAtomic) ||
      BigInt(binding.simulation.solSpentLamports) > BigInt(material.execution.maximumSolSpendLamports) ||
      !/^[1-9][0-9]{0,19}$/u.test(binding.blockHeight) || BigInt(binding.blockHeight) > BigInt(binding.lifetime.lastValidBlockHeight) ||
      !canonicalInstant(binding.checkedAt) || binding.checkedAt < operation.submissionMarker.markedAt || binding.checkedAt >= operation.quote.expiresAt) {
    corrupt("Orca execution binding integrity failed.");
  }
  return binding;
}

/** Durable binding written after the submission marker and before signing. It holds no secret. */
export class OrcaExecutionBindingStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  async save(operation: SwapOperationRecord, value: OrcaExecutionBinding, material: OrcaKeylessMaterial): Promise<OrcaExecutionBinding> {
    const binding = validateOrcaExecutionBinding(value, operation, material); await this.ready();
    return await this.withLocks([`orca-binding:${operation.operationId}`], async () => {
      const existing = await this.readJson(this.path(operation));
      if (existing !== null) {
        const prior = validateOrcaExecutionBinding(existing, operation, material);
        if (canonicalJson(prior) !== canonicalJson(binding)) corrupt("A different Orca execution binding already exists.");
        return prior;
      }
      await this.ensureDirectory(`orca-execution-bindings/${operation.ownerProfileHash}`);
      await this.writeJson(this.path(operation), binding, true);
      return binding;
    });
  }
  async load(operation: SwapOperationRecord, material: OrcaKeylessMaterial): Promise<OrcaExecutionBinding | null> {
    await this.ready(); const value = await this.readJson(this.path(operation));
    return value === null ? null : validateOrcaExecutionBinding(value, operation, material);
  }
  private path(operation: SwapOperationRecord): string {
    stateIdentifier(operation.ownerProfileHash, "Orca binding profile"); stateIdentifier(operation.operationId, "Orca binding operation");
    return `orca-execution-bindings/${operation.ownerProfileHash}/${operation.operationId}.json`;
  }
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-execution-bindings"); })();
    await this.initialized;
  }
}

/** Opens the local Solana seed only inside the signing call and seals the signed bytes in the encrypted wallet state. */
export class OrcaLocalSigner {
  constructor(private readonly accounts: Pick<ChainWalletStoragePort, "withSeed" | "effect" | "saveEffect">) {}

  async sign(operation: SwapOperationRecord, binding: OrcaExecutionBinding, material: OrcaKeylessMaterial, account: ChainAccount): Promise<RailSignedEffect> {
    validateOrcaExecutionBinding(binding, operation, material);
    if (account.address !== binding.account || orcaAccountBindingHash(account) !== binding.accountBindingHash) {
      blocked("The Solana signing account changed after the execution binding.", "orca_signing_gate");
    }
    const existing = await this.accounts.effect(account, operation.operationId, binding.bindingHash);
    if (existing !== null) { await verifySignedOrcaTransaction(existing, binding); return existing; }
    const compiled = compileOrcaSwap(material.execution.plan, binding.lifetime);
    if (compiled.unsignedPayload !== binding.unsignedPayload) corrupt("Orca signing bytes differ from the execution binding.");
    const effect = await this.accounts.withSeed(account, async (seed) => {
      const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
      if (signer.address !== account.address) throw new ApnError("APN_WALLET_MISMATCH", "The Solana signer changed.");
      const signed = await signTransaction([signer.keyPair], compiled.transaction), rawPayload = getBase64EncodedWireTransaction(signed);
      return { operationId: operation.operationId, fingerprint: binding.bindingHash, transactionId: getSignatureFromTransaction(signed),
        rawPayload, rawPayloadHash: sha256(rawPayload) };
    });
    await verifySignedOrcaTransaction(effect, binding);
    // Persisted before the single send: resume can only observe this exact signature.
    await this.accounts.saveEffect(account, effect);
    return effect;
  }
}

export async function verifySignedOrcaTransaction(effect: RailSignedEffect, binding: OrcaExecutionBinding): Promise<string> {
  try {
    const bytes = Buffer.from(effect.rawPayload, "base64"), transaction = getTransactionDecoder().decode(bytes);
    const signature = transaction.signatures[address(binding.account)];
    if (bytes.toString("base64") !== effect.rawPayload || sha256(effect.rawPayload) !== effect.rawPayloadHash ||
        effect.fingerprint !== binding.bindingHash || effect.operationId !== binding.operationId ||
        Object.keys(transaction.signatures).length !== 1 || signature === undefined || signature === null ||
        sha256Hex(new Uint8Array(transaction.messageBytes)) !== binding.messageHash || getBase64EncodedWireTransaction(transaction) !== effect.rawPayload ||
        getSignatureFromTransaction(transaction) !== solanaSignature(effect.transactionId) ||
        !await verifySignature(await getPublicKeyFromAddress(address(binding.account)), signature, transaction.messageBytes)) throw new Error();
    return effect.transactionId;
  } catch { return corrupt("The signed Orca transaction does not match the exact bound message and owner."); }
}

/** One sendTransaction call. It never throws: any failure is an ambiguous possible send that only status may resolve. */
export class OrcaSingleSender {
  constructor(private readonly rpc: SolanaRpcPort) {}
  async sendOnce(effect: RailSignedEffect): Promise<"submitted" | "possible_send"> {
    try {
      const result = await this.rpc.call("sendTransaction", [effect.rawPayload,
        { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]);
      return solanaSignature(result) === effect.transactionId ? "submitted" : "possible_send";
    } catch { return "possible_send"; }
  }
}

function freshnessOf(value: OrcaExecutionFreshness): OrcaExecutionFreshness {
  return { lifetime: value.lifetime, unsignedPayload: value.unsignedPayload, messageHash: value.messageHash,
    networkFeeLamports: value.networkFeeLamports, simulation: value.simulation, blockHeight: value.blockHeight, checkedAt: value.checkedAt };
}
function canonicalInstant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
