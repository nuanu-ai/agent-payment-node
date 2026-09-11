import { ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";
import { decodeDelegations, encodeDelegations, toDelegationStruct } from "@metamask/smart-accounts-kit/utils";
import { hashDelegation } from "@metamask/delegation-core";
import { canonicalJson, domainHash, sha256 } from "../canonical.js";
import type {
  SmartAccountGaslessMaterialRecord,
  SmartAccountGaslessMaterialStorePort,
} from "../encrypted-smart-account-gasless-material-store.js";
import type { SmartAccountPermissionStorePort } from "../encrypted-smart-account-permission-store.js";
import { assertMetaMaskSmartAccountPackageIdentity } from "../metamask-smart-account-package.js";
import { smartAccountEnvironment } from "../metamask-smart-account-grant.js";
import { isGrantedPermissionRecord, type GrantedSmartAccountPermissionRecord } from "../metamask-smart-account-record.js";
import type { Address, Hex } from "../model.js";
import { OfficialErc7710Engine, type Erc7710EnginePort } from "../smart-account-erc7710/engine.js";
import type { Erc7710MaterialIntent, Erc7710PaymentPayload } from "../smart-account-erc7710/intent.js";
import { validateErc7710Material } from "../smart-account-erc7710/validation.js";
import { SA_MATERIAL_DOMAINS, saMaterialHash, saRequirementsHash, saRootContextHash, saSalt } from "./integrity.js";
import { SA_MIN_REMAINING_MS, type SmartAccountGaslessBinding, type SmartAccountGaslessMaterialDescriptor,
  type SmartAccountGaslessMaterialHashes, type SmartAccountGaslessPayload,
  type SmartAccountGaslessProfileIdentity, type SmartAccountGaslessSealedMaterial } from "./model.js";
import type { SmartAccountGaslessOperationRecord } from "./operation-model.js";
import type { SmartAccountGaslessMaterialPort, SmartAccountGaslessMaterialValidatorPort,
  SmartAccountGaslessValidationInput } from "./ports.js";
import { saFail } from "./reasons.js";

export class SmartAccountGaslessMaterialValidator implements SmartAccountGaslessMaterialValidatorPort {
  async validate(input: SmartAccountGaslessValidationInput): Promise<SmartAccountGaslessMaterialHashes> {
    const intent = directIntent(input.operationId, input.fingerprint, input.intent, input.rootContext);
    const validated = await validateErc7710Material(intent, input.paymentPayload as Erc7710PaymentPayload);
    const encodedRootHash = saRootContextHash(validated.encodedRoot);
    const encodedChildHash = domainHash(SA_MATERIAL_DOMAINS.encodedChild, validated.encodedChild);
    const permissionContextHash = domainHash(SA_MATERIAL_DOMAINS.permissionContext, validated.permissionContext);
    const payload = canonicalPaymentPayload(input.intent, validated.permissionContext);
    const payloadCanonical = canonicalJson(payload);
    const payloadHash = domainHash(SA_MATERIAL_DOMAINS.payload, payloadCanonical);
    const requirementsHash = saRequirementsHash(payload.accepted);
    const partial = { encodedRootHash, encodedChildHash, permissionContextHash, payloadHash, requirementsHash,
      rootDelegationHash: validated.rootDelegationHash, childDelegationHash: validated.childDelegationHash };
    if (encodedRootHash !== input.intent.binding.encodedRootHash ||
      validated.rootDelegationHash !== input.intent.binding.rootDelegationHash) saFail("sa_gasless_state_corrupt");
    return { ...partial, materialHash: saMaterialHash(input.operationId, input.fingerprint, partial) };
  }
}

export class MetaMaskSmartAccountGaslessMaterial implements SmartAccountGaslessMaterialPort {
  constructor(
    private readonly permissions: SmartAccountPermissionStorePort,
    private readonly materials: SmartAccountGaslessMaterialStorePort,
    private readonly engine: Erc7710EnginePort = new OfficialErc7710Engine(),
    private readonly validator: SmartAccountGaslessMaterialValidatorPort = new SmartAccountGaslessMaterialValidator(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async inspect(expected: SmartAccountGaslessProfileIdentity, nowUnix: number): Promise<SmartAccountGaslessBinding> {
    await assertMetaMaskSmartAccountPackageIdentity();
    if (!Number.isSafeInteger(nowUnix) || nowUnix < 0) saFail("sa_gasless_clock");
    const expectedAddress = expected.address.toLowerCase() as Address;
    const record = await this.activeRecord(expected.profileHash, nowUnix);
    if (expected.profileHash !== sha256(`profile\0${expected.profile}`) || record.owner_address.toLowerCase() !== expectedAddress ||
      expected.accountBindingHash !== sha256(`provider-account-binding\0metamask-smart-account\0${expectedAddress}`)) {
      saFail("sa_gasless_identity");
    }
    return bindingFrom(record, expected);
  }

  async load(operation: SmartAccountGaslessOperationRecord): Promise<SmartAccountGaslessSealedMaterial | null> {
    const record = await this.materials.load(operation.operationId);
    if (record === null) {
      if (operation.material !== null) saFail("sa_gasless_state_corrupt");
      return null;
    }
    return await this.recover(operation, record);
  }

  async seal(operation: SmartAccountGaslessOperationRecord): Promise<SmartAccountGaslessSealedMaterial> {
    const existing = await this.materials.load(operation.operationId);
    if (existing !== null) return await this.recover(operation, existing);
    if (operation.state !== "material_pending" || operation.signingAttempts !== 1 || operation.material !== null) {
      saFail("sa_gasless_state_corrupt");
    }
    await assertMetaMaskSmartAccountPackageIdentity();
    const initialClockMs = clockMs(this.now());
    assertPreSignClock(operation, initialClockMs, initialClockMs);
    const record = await this.activeRecord(operation.profileHash, Math.floor(initialClockMs / 1_000));
    assertOperationAuthority(operation, record);
    const preSignClockMs = clockMs(this.now());
    assertPreSignClock(operation, initialClockMs, preSignClockMs);
    if (preSignClockMs >= record.granted_expires_at_unix * 1_000) saFail("sa_gasless_permission");
    const rootContext = canonicalRoot(record.grant_context);
    const neutral = directIntent(operation.operationId, operation.fingerprint, operation.intent, rootContext);
    let officialPayment: Erc7710PaymentPayload;
    try { officialPayment = await this.engine.create(neutral,
      { sessionPrivateKey: record.session_private_key, rootContext }); }
    catch { return saFail("sa_gasless_provider_protocol"); }
    const validated = await validateErc7710Material(neutral, officialPayment);
    const paymentPayload = canonicalPaymentPayload(operation.intent, validated.permissionContext);
    const hashes = await this.validator.validate({ operationId: operation.operationId, fingerprint: operation.fingerprint,
      intent: operation.intent, paymentPayload, rootContext });
    const sealedAt = instant(this.now());
    const stored = await this.materials.seal({ schema_version: "apn.smart-account-gasless-material.v1",
      operation_id: operation.operationId, profile_hash: operation.profileHash, fingerprint: operation.fingerprint,
      request_hash: operation.requestHash, root_grant_fingerprint: operation.intent.binding.rootGrantFingerprint,
      ...hashes, delegation_manager: operation.intent.binding.delegationManager,
      delegator: operation.intent.binding.ownerAddress, root_context: validated.encodedRoot,
      encoded_child: validated.encodedChild, permission_context: validated.permissionContext,
      payment_payload_canonical_json: canonicalJson(paymentPayload), phase: "sealed", sealed_at: sealedAt, updated_at: sealedAt });
    return projection(stored);
  }

  async markExposed(operation: SmartAccountGaslessOperationRecord,
    material: SmartAccountGaslessSealedMaterial): Promise<SmartAccountGaslessSealedMaterial> {
    const current = await this.materials.load(operation.operationId);
    if (current === null) saFail("sa_gasless_state_corrupt");
    const recovered = await this.recover(operation, current);
    if (canonicalJson(recovered) !== canonicalJson(material)) saFail("sa_gasless_state_corrupt");
    return projection(await this.materials.markExposed(operation.operationId, instant(this.now())));
  }

  private async recover(operation: SmartAccountGaslessOperationRecord,
    record: SmartAccountGaslessMaterialRecord): Promise<SmartAccountGaslessSealedMaterial> {
    if (record.operation_id !== operation.operationId || record.profile_hash !== operation.profileHash ||
      record.fingerprint !== operation.fingerprint || record.request_hash !== operation.requestHash ||
      record.root_grant_fingerprint !== operation.intent.binding.rootGrantFingerprint) saFail("sa_gasless_state_corrupt");
    const payload = JSON.parse(record.payment_payload_canonical_json) as SmartAccountGaslessPayload;
    const hashes = await this.validator.validate({ operationId: operation.operationId, fingerprint: operation.fingerprint,
      intent: operation.intent, paymentPayload: payload, rootContext: record.root_context });
    if (canonicalJson(hashes) !== canonicalJson(materialHashes(record)) ||
      (operation.material !== null && canonicalJson(operation.material) !== canonicalJson(descriptor(record)))) {
      saFail("sa_gasless_state_corrupt");
    }
    return { descriptor: descriptor(record), paymentPayload: payload, phase: record.phase };
  }

  private async activeRecord(profileHash: string, nowUnix: number): Promise<GrantedSmartAccountPermissionRecord> {
    const record = await this.permissions.load(profileHash);
    if (record === null || !isGrantedPermissionRecord(record) || record.phase !== "active" ||
      nowUnix >= record.granted_expires_at_unix) saFail("sa_gasless_permission");
    return record;
  }
}

export function directIntent(operationId: string, fingerprint: string,
  intent: SmartAccountGaslessOperationRecord["intent"], rootContext: Hex): Erc7710MaterialIntent {
  return { operationId, fingerprint, chainId: 8453, token: intent.token, amountAtomic: intent.request.grossAtomic,
    payee: intent.request.recipient, ownerAddress: intent.binding.ownerAddress,
    sessionAddress: intent.binding.sessionAddress, delegationManager: intent.binding.delegationManager,
    afterUnix: intent.afterUnix, beforeUnix: intent.beforeUnix,
    facilitatorAddresses: intent.requirements.extra.facilitatorAddresses, salt: saSalt(operationId, fingerprint),
    requirements: intent.requirements, rootContext };
}

function bindingFrom(record: GrantedSmartAccountPermissionRecord,
  expected: SmartAccountGaslessProfileIdentity): SmartAccountGaslessBinding {
  const rootContext = canonicalRoot(record.grant_context), root = decodeDelegations(rootContext)[0]!;
  const environment = smartAccountEnvironment();
  if (root.delegate.toLowerCase() !== record.session_address.toLowerCase() ||
    root.delegator.toLowerCase() !== record.owner_address.toLowerCase() || root.authority.toLowerCase() !== ROOT_AUTHORITY.toLowerCase()) {
    saFail("sa_gasless_state_corrupt");
  }
  const period = root.caveats.find(c => c.enforcer.toLowerCase() === environment.caveatEnforcers.ERC20PeriodTransferEnforcer?.toLowerCase());
  const nonce = root.caveats.find(c => c.enforcer.toLowerCase() === environment.caveatEnforcers.NonceEnforcer?.toLowerCase());
  if (period === undefined || nonce === undefined || period.terms.length !== 234 || nonce.terms.length !== 66) {
    saFail("sa_gasless_state_corrupt");
  }
  const cap = BigInt(`0x${period.terms.slice(42, 106)}`).toString();
  const starts = Number(BigInt(`0x${period.terms.slice(170, 234)}`));
  if (cap !== record.granted_cap_atomic || starts !== record.starts_at_unix || !Number.isSafeInteger(starts)) {
    saFail("sa_gasless_state_corrupt");
  }
  return { providerId: "metamask-smart-account", trustClass: "external_owner_delegated_local_session",
    profileHash: expected.profileHash, ownerAddress: record.owner_address.toLowerCase() as Address,
    sessionAddress: record.session_address.toLowerCase() as Address, accountBindingHash: expected.accountBindingHash,
    capabilityHash: expected.capabilityHash, profileRevision: expected.revision, permissionRevision: record.revision,
    rootGrantFingerprint: record.grant_fingerprint, encodedRootHash: saRootContextHash(rootContext),
    rootDelegationHash: hashDelegation(toDelegationStruct(root)).toLowerCase() as Hex,
    delegationManager: record.delegation_manager.toLowerCase() as Address, rootCapAtomic: cap,
    rootStartsAtUnix: starts, rootExpiresAtUnix: record.granted_expires_at_unix,
    periodTerms: period.terms.toLowerCase() as Hex, rootNonceAtomic: BigInt(nonce.terms).toString() };
}

function canonicalRoot(context: Hex): Hex {
  let roots;
  try { roots = decodeDelegations(context); } catch { return saFail("sa_gasless_state_corrupt"); }
  if (roots.length !== 1 || roots[0] === undefined) saFail("sa_gasless_state_corrupt");
  return encodeDelegations([roots[0]]).toLowerCase() as Hex;
}
function assertOperationAuthority(operation: SmartAccountGaslessOperationRecord, record: GrantedSmartAccountPermissionRecord): void {
  const b = operation.intent.binding;
  if (b.profileHash !== operation.profileHash || b.permissionRevision !== record.revision ||
    b.rootGrantFingerprint !== record.grant_fingerprint || b.ownerAddress !== record.owner_address.toLowerCase() ||
    b.sessionAddress !== record.session_address.toLowerCase() || b.delegationManager !== record.delegation_manager.toLowerCase() ||
    b.encodedRootHash !== saRootContextHash(canonicalRoot(record.grant_context))) saFail("sa_gasless_identity");
}
function materialHashes(record: SmartAccountGaslessMaterialRecord): SmartAccountGaslessMaterialHashes {
  return { encodedRootHash: record.encodedRootHash, encodedChildHash: record.encodedChildHash,
    permissionContextHash: record.permissionContextHash, payloadHash: record.payloadHash,
    requirementsHash: record.requirementsHash, materialHash: record.materialHash,
    rootDelegationHash: record.rootDelegationHash, childDelegationHash: record.childDelegationHash };
}
function descriptor(record: SmartAccountGaslessMaterialRecord): SmartAccountGaslessMaterialDescriptor {
  return { ...materialHashes(record), sealedAt: record.sealed_at };
}
function projection(record: SmartAccountGaslessMaterialRecord): SmartAccountGaslessSealedMaterial {
  return { descriptor: descriptor(record), paymentPayload: JSON.parse(record.payment_payload_canonical_json) as SmartAccountGaslessPayload,
    phase: record.phase };
}
function instant(value: Date): string {
  if (!Number.isFinite(value.getTime())) saFail("sa_gasless_clock");
  return value.toISOString();
}

function clockMs(value: Date): number {
  const milliseconds = value.getTime();
  if (!Number.isSafeInteger(milliseconds)) saFail("sa_gasless_clock");
  return milliseconds;
}

function canonicalPaymentPayload(intent: SmartAccountGaslessOperationRecord["intent"],
  permissionContext: Hex): SmartAccountGaslessPayload {
  return { x402Version: 2, accepted: intent.requirements,
    payload: { delegationManager: intent.binding.delegationManager,
      delegator: intent.binding.ownerAddress, permissionContext } };
}

function assertPreSignClock(operation: SmartAccountGaslessOperationRecord,
  initialClockMs: number, currentClockMs: number): void {
  if (currentClockMs < initialClockMs) saFail("sa_gasless_clock");
  for (const value of savedObservationTimes(operation)) {
    const observed = Date.parse(value);
    if (!Number.isSafeInteger(observed) || new Date(observed).toISOString() !== value) saFail("sa_gasless_state_corrupt");
    if (currentClockMs < observed) saFail("sa_gasless_clock");
  }
  const afterMs = operation.intent.afterUnix * 1_000, beforeMs = operation.intent.beforeUnix * 1_000;
  if (!Number.isSafeInteger(afterMs) || !Number.isSafeInteger(beforeMs) || currentClockMs < afterMs ||
    beforeMs - currentClockMs < SA_MIN_REMAINING_MS) saFail("sa_gasless_expired");
}

function savedObservationTimes(operation: SmartAccountGaslessOperationRecord): readonly string[] {
  const mutable = (value: SmartAccountGaslessOperationRecord | SmartAccountGaslessOperationRecord["transitions"][number]) => [
    value.approval?.approvedAt, value.exposureStartedAt, value.dispatchStartedAt,
    value.verification?.observedAt, value.providerSettlement?.observedAt, value.observation?.observedAt,
    value.settlement?.observedAt, value.unusedProof?.observedAt,
  ].filter((item): item is string => item !== null && item !== undefined);
  return [operation.intent.preparedAt, operation.intent.initialSnapshot.observedAt, operation.intent.provider.observedAt,
    operation.createdAt, operation.updatedAt, ...mutable(operation),
    ...operation.transitions.flatMap(transition => [transition.at, ...mutable(transition)])];
}
