import {
  ANY_BENEFICIARY,
  decodeAllowedCalldataTerms,
  decodeERC20TransferAmountTerms,
  decodeRedeemerTerms,
  decodeTimestampTerms,
  decodeValueLteTerms,
  hashDelegation,
} from "@metamask/delegation-core";
import type { PermissionContext } from "@metamask/smart-accounts-kit";
import {
  METAMASK_FACILITATOR_ADDRESSES,
  createx402DelegationProvider,
} from "@metamask/smart-accounts-kit/experimental";
import {
  SIGNABLE_DELEGATION_TYPED_DATA,
  decodeDelegations,
  encodeDelegations,
  toDelegationStruct,
} from "@metamask/smart-accounts-kit/utils";
import { x402Erc7710Client } from "@metamask/x402";
import { getAddress, keccak256, pad, recoverTypedDataAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash, isPlainRecord, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import type { SmartAccountX402MaterialStorePort } from "./encrypted-smart-account-x402-material-store.js";
import type { SmartAccountPermissionStorePort } from "./encrypted-smart-account-permission-store.js";
import { ApnError } from "./errors.js";
import { assertMetaMaskSmartAccountPackageIdentity } from "./metamask-smart-account-package.js";
import { smartAccountEnvironment } from "./metamask-smart-account-grant.js";
import { isGrantedPermissionRecord, type GrantedSmartAccountPermissionRecord } from "./metamask-smart-account-record.js";
import type { SmartAccountAllowancePort } from "./metamask-smart-account-direct.js";
import type { Address, Hex } from "./model.js";
import type { RpcPort } from "./ports.js";
import type {
  X402DelegatedMaterialBinding,
  X402MaterialPrepareInput,
  X402PaymentMaterialPort,
  X402SealedPaymentMaterial,
} from "./provider-ports.js";
import {
  encodePaymentSignatureHeader,
  type X402PaymentPayload as PaymentPayload,
  type X402PaymentRequirements as PaymentRequirements,
} from "./x402-codec.js";
import { materializePaymentIdentifier } from "./x402-policy.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";

export interface SmartAccountX402EnginePort {
  create(input: {
    readonly record: GrantedSmartAccountPermissionRecord;
    readonly operation: X402OperationRecord;
    readonly approvedFacilitators: readonly Address[];
  }): Promise<PaymentPayload>;
}

export class OfficialSmartAccountX402Engine implements SmartAccountX402EnginePort {
  async create(input: Parameters<SmartAccountX402EnginePort["create"]>[0]): Promise<PaymentPayload> {
    const binding = delegatedBinding(input.operation);
    const requirements = protectedRequirements(input.operation);
    const account = privateKeyToAccount(input.record.session_private_key);
    const provider = createx402DelegationProvider({
      account,
      environment: smartAccountEnvironment(),
      from: input.record.session_address,
      salt: deterministicSalt(input.operation),
      parentPermissionContext: input.record.grant_context as PermissionContext,
      caveats: [{
        type: "timestamp",
        afterThreshold: Number(input.operation.authorization.createdAt),
        beforeThreshold: Number(binding.effectiveExpiryUnix),
      }],
      redeemers: { requireRedeemers: true, addresses: [...input.approvedFacilitators] },
    });
    const client = new x402Erc7710Client({ delegationProvider: provider });
    const material = await client.createPaymentPayload(2, requirements);
    const resource = JSON.parse(input.operation.sellerWire.resourceCanonicalJson) as NonNullable<PaymentPayload["resource"]>;
    const paymentIdentifier = materializePaymentIdentifier(input.operation.paymentIdentifier);
    return {
      x402Version: 2,
      resource,
      accepted: requirements,
      payload: material.payload,
      ...(paymentIdentifier === undefined ? {} : {
        extensions: { "payment-identifier": paymentIdentifier as Record<string, unknown> },
      }),
    };
  }
}

export class MetaMaskSmartAccountX402Adapter implements X402PaymentMaterialPort {
  readonly method = "erc7710" as const;

  constructor(
    private readonly permissions: SmartAccountPermissionStorePort,
    private readonly materials: SmartAccountX402MaterialStorePort,
    private readonly rpc: RpcPort,
    private readonly allowance: SmartAccountAllowancePort,
    private readonly engine: SmartAccountX402EnginePort = new OfficialSmartAccountX402Engine(),
    private readonly now: () => Date = () => new Date(),
    private readonly approvedFacilitators: readonly Address[] = METAMASK_FACILITATOR_ADDRESSES,
  ) {}

  async prepare(input: X402MaterialPrepareInput): Promise<X402DelegatedMaterialBinding> {
    await assertMetaMaskSmartAccountPackageIdentity();
    const record = await this.preflightRecord(input.profileHash, input.wallet, input.amountAtomic, input.rpcOriginHash);
    const facilitators = intersection(input.facilitatorAddresses, this.approvedFacilitators);
    if (facilitators.length === 0) incompatible("Seller facilitators do not intersect the approved MetaMask facilitator set.");
    const requestedExpiry = BigInt(input.preparedAtUnix) + BigInt(input.maxTimeoutSeconds);
    const effectiveExpiryUnix = (requestedExpiry < BigInt(record.granted_expires_at_unix)
      ? requestedExpiry : BigInt(record.granted_expires_at_unix)).toString();
    if (BigInt(effectiveExpiryUnix) <= BigInt(input.preparedAtUnix)) inactive();
    return {
      schemaVersion: "apn.x402.delegated-material-binding.v1",
      method: "erc7710",
      providerId: record.provider_id,
      profileRevision: input.profileRevision,
      capabilityHash: input.capabilityHash,
      accountBindingHash: input.accountBindingHash,
      permissionRevision: record.revision,
      rootGrantFingerprint: record.grant_fingerprint,
      sessionAddress: lower(record.session_address),
      delegationManager: lower(record.delegation_manager),
      facilitatorAddresses: facilitators,
      effectiveExpiryUnix,
      rpcOriginHash: input.rpcOriginHash,
    };
  }

  async materialize(operation: X402OperationRecord): Promise<X402SealedPaymentMaterial> {
    const existing = await this.materials.load(operation.operationId);
    if (existing !== null) return this.recovered(operation, existing);
    const binding = delegatedBinding(operation);
    if (this.nowUnix() >= BigInt(binding.effectiveExpiryUnix)) inactive();
    const record = await this.preflightRecord(
      operation.profileHash, operation.wallet, operation.amountAtomic, binding.rpcOriginHash,
    );
    assertAuthorityBinding(operation, record);
    let payload: PaymentPayload;
    try {
      payload = await this.engine.create({
        record,
        operation,
        approvedFacilitators: binding.facilitatorAddresses,
      });
      await validateOfficialMaterial(payload, operation, record);
    } catch (error) {
      if (error instanceof ApnError) throw error;
      throw new ApnError("APN_PROVIDER_PROTOCOL", "MetaMask ERC-7710 payment material construction failed safely.");
    }
    const paymentPayloadCanonicalJson = canonicalJson(payload);
    const paymentHeader = encodePaymentSignatureHeader(payload);
    const context = erc7710Payload(payload).permissionContext;
    const child = decodeDelegations(context)[0];
    if (child === undefined) protocol("ERC-7710 child is missing after validated materialization.");
    const childHash = domainHash("apn.x402.erc7710.child.v1", encodeDelegations([child]));
    const sealedAt = this.instant();
    const sealed = await this.materials.seal({
      schema_version: "apn.metamask-smart-account-x402-material.v1",
      operation_id: operation.operationId,
      profile_hash: operation.profileHash,
      fingerprint: operation.fingerprint,
      request_hash: operation.requestHash,
      offer_hash: operation.selectedOffer.offerHash,
      root_grant_fingerprint: record.grant_fingerprint,
      child_hash: childHash,
      permission_context_hash: domainHash("apn.x402.erc7710.permission-context.v1", context),
      payment_payload_hash: domainHash("apn.x402.payment-payload.v1", paymentPayloadCanonicalJson),
      payment_header_hash: domainHash("apn.x402.payment-header.v1", Buffer.from(paymentHeader, "ascii")),
      delegation_manager: lower(erc7710Payload(payload).delegationManager),
      delegator: lower(erc7710Payload(payload).delegator),
      child_permission_context: context,
      payment_payload_canonical_json: paymentPayloadCanonicalJson,
      payment_header: paymentHeader,
      effective_expiry_unix: binding.effectiveExpiryUnix,
      phase: "sealed",
      sealed_at: sealedAt,
      updated_at: sealedAt,
    });
    return materialProjection(sealed);
  }

  async recover(operation: X402OperationRecord): Promise<X402SealedPaymentMaterial> {
    const binding = delegatedBinding(operation);
    const record = await this.materials.load(operation.operationId);
    if (record === null) {
      if (
        operation.state === "authorization_material_pending" && operation.attempts.length === 0 &&
        operation.signatureHash === undefined && operation.paymentPayloadHash === undefined &&
        operation.paymentHeaderHash === undefined && operation.paymentContextHash === undefined
      ) return await this.materialize(operation);
      throw new ApnError("APN_STATE_CORRUPT", "Authorized ERC-7710 operation lost its sealed payment material.");
    }
    if (record.phase === "sealed") {
      const authority = await this.preflightRecord(
        operation.profileHash, operation.wallet, operation.amountAtomic, binding.rpcOriginHash,
      );
      assertAuthorityBinding(operation, authority);
    }
    return this.recovered(operation, record);
  }

  async markExposed(operation: X402OperationRecord): Promise<void> {
    const record = await this.materials.markExposed(operation.operationId, this.instant());
    this.recovered(operation, record);
  }

  private recovered(
    operation: X402OperationRecord,
    record: Awaited<ReturnType<SmartAccountX402MaterialStorePort["load"]>> & {},
  ): X402SealedPaymentMaterial {
    const binding = delegatedBinding(operation);
    if (
      record.operation_id !== operation.operationId || record.profile_hash !== operation.profileHash ||
      record.fingerprint !== operation.fingerprint || record.request_hash !== operation.requestHash ||
      record.offer_hash !== operation.selectedOffer.offerHash ||
      record.root_grant_fingerprint !== binding.rootGrantFingerprint ||
      record.delegation_manager.toLowerCase() !== binding.delegationManager ||
      record.delegator.toLowerCase() !== operation.wallet ||
      record.effective_expiry_unix !== binding.effectiveExpiryUnix
    ) throw new ApnError("APN_STATE_CORRUPT", "Sealed ERC-7710 material differs from the frozen operation.");
    return materialProjection(record);
  }

  private async preflightRecord(
    profileHash: string,
    wallet: Address,
    amountAtomic: string,
    rpcOriginHash: string,
  ): Promise<GrantedSmartAccountPermissionRecord> {
    const record = await this.permissions.load(profileHash);
    if (record === null || !isGrantedPermissionRecord(record) || record.phase !== "active" ||
      this.nowUnix() >= BigInt(record.granted_expires_at_unix)) inactive();
    if (record.owner_address.toLowerCase() !== wallet.toLowerCase()) drift();
    const chain = await this.rpc.assertBaseChain();
    if (sha256(chain.rpcOrigin) !== rpcOriginHash) {
      throw new ApnError("APN_RPC_PROTOCOL", "Smart Account x402 RPC origin changed during preparation.");
    }
    const amount = canonicalAtomic(amountAtomic);
    if (amount > BigInt(record.granted_cap_atomic) || amount > canonicalAtomic(await this.allowance.available(record))) {
      throw new ApnError("APN_PERMISSION_ALLOWANCE_INSUFFICIENT", "Current Smart Account allowance is insufficient for this x402 payment.");
    }
    const owner = await this.rpc.getBalances(record.owner_address);
    if (owner.address.toLowerCase() !== record.owner_address.toLowerCase()) {
      throw new ApnError("APN_RPC_PROTOCOL", "RPC balance response does not match the Smart Account owner.");
    }
    if (canonicalAtomic(owner.usdcAtomic) < amount) {
      throw new ApnError("APN_INSUFFICIENT_USDC", "Owner Smart Account USDC is insufficient for this x402 payment.");
    }
    return record;
  }

  private nowUnix(): bigint { return BigInt(Math.floor(this.now().getTime() / 1000)); }
  private instant(): string {
    const value = this.now();
    if (!Number.isFinite(value.getTime())) throw new ApnError("APN_INTERNAL", "Smart Account x402 clock is invalid.");
    return value.toISOString();
  }
}

async function validateOfficialMaterial(
  payload: PaymentPayload,
  operation: X402OperationRecord,
  record: GrantedSmartAccountPermissionRecord,
): Promise<void> {
  const binding = delegatedBinding(operation);
  if (canonicalJson(payload.accepted) !== operation.selectedOffer.declaredCanonicalJson) protocol("Accepted requirements changed during materialization.");
  const delegationPayload = erc7710Payload(payload);
  if (delegationPayload.delegationManager.toLowerCase() !== binding.delegationManager ||
    delegationPayload.delegator.toLowerCase() !== operation.wallet) protocol("ERC-7710 payload identity differs from the frozen operation.");
  const chain = decodeDelegations(delegationPayload.permissionContext);
  if (chain.length !== 2 || chain[0] === undefined || chain[1] === undefined) protocol("ERC-7710 child/root chain is invalid.");
  const [child, root] = chain;
  if (encodeDelegations([root]).toLowerCase() !== record.grant_context.toLowerCase()) {
    protocol("ERC-7710 root permission context differs from the committed grant.");
  }
  if (child.delegate.toLowerCase() !== ANY_BENEFICIARY.toLowerCase()) {
    protocol("ERC-7710 child beneficiary is not the required open beneficiary.");
  }
  if (child.delegator.toLowerCase() !== binding.sessionAddress) {
    protocol("ERC-7710 child delegator differs from the frozen session account.");
  }
  if (child.authority.toLowerCase() !== hashDelegation(toDelegationStruct(root)).toLowerCase()) {
    protocol("ERC-7710 child authority does not bind the committed root grant.");
  }
  if (!sameDelegationSalt(child.salt, deterministicSalt(operation))) {
    protocol("ERC-7710 child salt differs from the deterministic operation identity.");
  }
  const recovered = await recoverTypedDataAddress({
    domain: { chainId: CHAIN_ID, name: "DelegationManager", version: "1", verifyingContract: binding.delegationManager },
    types: SIGNABLE_DELEGATION_TYPED_DATA,
    primaryType: "Delegation",
    message: toDelegationStruct({ ...child, signature: "0x" }),
    signature: child.signature,
  });
  if (recovered.toLowerCase() !== binding.sessionAddress) protocol("ERC-7710 child was not signed by the frozen session account.");
  validateChildCaveats(child.caveats, operation, binding);
}

function validateChildCaveats(
  caveats: readonly { readonly enforcer: Hex; readonly terms: Hex; readonly args: Hex }[],
  operation: X402OperationRecord,
  binding: X402DelegatedMaterialBinding,
): void {
  const environment = smartAccountEnvironment();
  const required = [
    environment.caveatEnforcers.ValueLteEnforcer,
    environment.caveatEnforcers.ERC20TransferAmountEnforcer,
    environment.caveatEnforcers.AllowedCalldataEnforcer,
    environment.caveatEnforcers.TimestampEnforcer,
    environment.caveatEnforcers.RedeemerEnforcer,
  ];
  const expectedArgs = ["0x00", "0x00", "0x", "0x00", "0x"] as const;
  if (required.some((value) => value === undefined) || caveats.length !== required.length ||
    new Set(caveats.map((item) => item.enforcer.toLowerCase())).size !== required.length ||
    required.some((address, index) => !caveats.some((item) =>
      item.enforcer.toLowerCase() === address?.toLowerCase() && item.args.toLowerCase() === expectedArgs[index]))) {
    protocol("ERC-7710 child caveat set is invalid.");
  }
  const caveat = (address: Hex | undefined) => caveats.find((item) => item.enforcer.toLowerCase() === address?.toLowerCase());
  try {
    const value = decodeValueLteTerms(caveat(required[0])?.terms as Hex);
    const scope = decodeERC20TransferAmountTerms(caveat(required[1])?.terms as Hex);
    const calldata = decodeAllowedCalldataTerms(caveat(required[2])?.terms as Hex);
    const timestamp = decodeTimestampTerms(caveat(required[3])?.terms as Hex);
    const redeemer = decodeRedeemerTerms(caveat(required[4])?.terms as Hex);
    const expectedRedeemers = [...binding.facilitatorAddresses].map(lower).sort();
    const actualRedeemers = redeemer.redeemers.map((item) => lower(getAddress(item))).sort();
    if (
      value.maxValue !== 0n || getAddress(scope.tokenAddress).toLowerCase() !== BASE_USDC.toLowerCase() ||
      scope.maxAmount !== BigInt(operation.amountAtomic) ||
      calldata.startIndex !== 4 || calldata.value.toLowerCase() !== pad(operation.payee, { size: 32 }).toLowerCase() ||
      timestamp.afterThreshold !== Number(operation.authorization.createdAt) ||
      timestamp.beforeThreshold !== Number(binding.effectiveExpiryUnix) ||
      canonicalJson(actualRedeemers) !== canonicalJson(expectedRedeemers)
    ) protocol("ERC-7710 child scope, payee, expiry or redeemers differ from the frozen operation.");
  } catch (error) {
    if (error instanceof ApnError) throw error;
    protocol("ERC-7710 child caveat terms are malformed.");
  }
}

function protectedRequirements(operation: X402OperationRecord): PaymentRequirements {
  const value = JSON.parse(operation.selectedOffer.declaredCanonicalJson) as unknown;
  if (!isPlainRecord(value)) protocol("Frozen ERC-7710 requirements are invalid.");
  return value as unknown as PaymentRequirements;
}

function erc7710Payload(payload: PaymentPayload): {
  readonly delegationManager: Address; readonly permissionContext: Hex; readonly delegator: Address;
} {
  if (!isPlainRecord(payload.payload) || typeof payload.payload.delegationManager !== "string" ||
    typeof payload.payload.permissionContext !== "string" || typeof payload.payload.delegator !== "string") {
    protocol("Official ERC-7710 payload is malformed.");
  }
  return payload.payload as unknown as {
    readonly delegationManager: Address; readonly permissionContext: Hex; readonly delegator: Address;
  };
}

function delegatedBinding(operation: X402OperationRecord): X402DelegatedMaterialBinding {
  if (operation.selectedOffer.resolved.assetTransferMethod !== "erc7710" || operation.delegatedMaterial?.method !== "erc7710") {
    throw new ApnError("APN_STATE_CORRUPT", "ERC-7710 adapter received an operation with a different transfer method.");
  }
  return operation.delegatedMaterial;
}

function assertAuthorityBinding(operation: X402OperationRecord, record: GrantedSmartAccountPermissionRecord): void {
  const binding = delegatedBinding(operation);
  if (binding.permissionRevision !== record.revision || binding.rootGrantFingerprint !== record.grant_fingerprint ||
    binding.sessionAddress !== record.session_address.toLowerCase() ||
    binding.delegationManager !== record.delegation_manager.toLowerCase() ||
    operation.wallet !== record.owner_address.toLowerCase()) drift();
}

function materialProjection(record: NonNullable<Awaited<ReturnType<SmartAccountX402MaterialStorePort["load"]>>>): X402SealedPaymentMaterial {
  return {
    materialHash: record.child_hash,
    contextHash: record.permission_context_hash,
    paymentPayloadHash: record.payment_payload_hash,
    paymentHeaderHash: record.payment_header_hash,
    paymentHeader: record.payment_header,
  };
}

function deterministicSalt(operation: X402OperationRecord): Hex {
  return keccak256(toHex(`apn.smart-account.x402\0${operation.operationId}\0${operation.fingerprint}`));
}
export function sameDelegationSalt(actual: Hex, expected: Hex): boolean {
  return BigInt(actual) === BigInt(expected);
}
function intersection(offered: readonly Address[], approved: readonly Address[]): readonly Address[] {
  const allowed = new Set(approved.map(lower));
  return [...new Set(offered.map(lower).filter((address) => allowed.has(address)))].sort() as Address[];
}
function canonicalAtomic(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new ApnError("APN_PROVIDER_PROTOCOL", "Smart Account x402 atomic value is invalid.");
  return BigInt(value);
}
function lower(value: string): Address { return value.toLowerCase() as Address; }
function inactive(): never { throw new ApnError("APN_PERMISSION_INACTIVE", "Smart Account permission is inactive for x402."); }
function drift(): never { throw new ApnError("APN_PROFILE_DRIFT", "Smart Account x402 authority differs from the frozen profile."); }
function incompatible(message: string): never { throw new ApnError("APN_X402_UNSUPPORTED_OFFER", message); }
function protocol(message: string): never { throw new ApnError("APN_PROVIDER_PROTOCOL", message); }
