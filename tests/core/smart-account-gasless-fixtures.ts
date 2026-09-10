import { keccak256 } from "viem";
import { canonicalJson, domainHash, sha256 } from "../../src/canonical.js";
import type { Address, Hex } from "../../src/model.js";
import type { SmartAccountGaslessIntent, SmartAccountGaslessRpcObservation, SmartAccountGaslessSealedMaterial } from "../../src/smart-account-gasless/model.js";
import { saRegistry } from "../../src/smart-account-gasless/registry.js";
import { SA_MATERIAL_DOMAINS, saMaterialHash, saPolicyHash, saRequirementsHash } from "../../src/smart-account-gasless/integrity.js";
import { createErc20TokenAllowanceCaveats } from "@metamask/7715-permission-types";
import type { SmartAccountGaslessOperationRecord } from "../../src/smart-account-gasless/operation-model.js";
import type { SmartAccountGaslessObserveInput } from "../../src/smart-account-gasless/ports.js";

export const SA_TEST_OWNER = `0x${"11".repeat(20)}` as Address;
export const SA_TEST_SESSION = `0x${"22".repeat(20)}` as Address;
export const SA_TEST_RECIPIENT = `0x${"33".repeat(20)}` as Address;
export const SA_TEST_AT = "2026-09-10T20:30:00.000Z";
const hexHash = (digit: string): Hex => `0x${digit.repeat(64)}`;

/** Public synthetic binding only. Real SDK/chain fixtures are separate proof obligations. */
export function saTestIntent(): SmartAccountGaslessIntent {
  const registry = saRegistry(8453), nowUnix = Date.parse(SA_TEST_AT) / 1000;
  const allowanceCaveats = createErc20TokenAllowanceCaveats({ permission: {
    type: "erc20-token-allowance", isAdjustmentAllowed: true, data: { tokenAddress: registry.token.address,
      allowanceAmount: "0xf4240", startTime: nowUnix - 86400, justification: "Public synthetic APN fixture" } }, contracts: {
    erc20PeriodTransferEnforcer: registry.protocol.period.address, valueLteEnforcer: registry.protocol.value.address } });
  const periodic = allowanceCaveats.find(c => typeof c.enforcer === "string" && c.enforcer.toLowerCase() === registry.protocol.period.address);
  if (periodic === undefined || typeof periodic.terms !== "string") throw new Error("Pinned SDK fixture requires hexadecimal periodic terms.");
  const periodTerms = periodic.terms;
  const block = { numberAtomic: "50000000", hash: hexHash("4"), timestampAtomic: String(nowUnix) };
  const safe = { numberAtomic: "49999980", hash: hexHash("5"), timestampAtomic: String(nowUnix - 40) };
  const state = {
    ownerAddress: SA_TEST_OWNER, sessionAddress: SA_TEST_SESSION,
    ownerCodeHash: registry.ownerDesignationCodeHash, sessionCodeHash: keccak256("0x"),
    protocolCodeHashes: Object.fromEntries(Object.entries(registry.protocol).map(([name, pin]) => [name, pin.codeHash])) as unknown as SmartAccountGaslessIntent["initialSnapshot"]["safeState"]["protocolCodeHashes"],
    tokenProxyCodeHash: registry.token.proxyCodeHash,
    tokenImplementationAddress: registry.token.implementationAddress,
    tokenImplementationCodeHash: registry.token.implementationCodeHash,
    tokenDomainSeparator: registry.token.domainSeparator, tokenDecimals: 6 as const,
    usdcBalanceAtomic: "2000000", ownerNativeBalanceWei: "0", sessionNativeBalanceWei: "0",
    availableAtomic: "1000000", allowancePeriodAtomic: "1", allowanceIsNewPeriod: true, currentNonceAtomic: "0",
  };
  const intent: SmartAccountGaslessIntent = {
    profile: "sa-synthetic", request: { chainId: 8453, recipient: SA_TEST_RECIPIENT,
      grossAtomic: "10000", maxFeeAtomic: "0", minReceivedAtomic: "10000" },
    binding: { providerId: "metamask-smart-account", trustClass: "external_owner_delegated_local_session",
      profileHash: sha256("profile\0sa-synthetic"), ownerAddress: SA_TEST_OWNER, sessionAddress: SA_TEST_SESSION,
      accountBindingHash: sha256(`provider-account-binding\0metamask-smart-account\0${SA_TEST_OWNER}`),
      capabilityHash: "a".repeat(64), profileRevision: 2, permissionRevision: 1,
      rootGrantFingerprint: "b".repeat(64), encodedRootHash: "c".repeat(64), rootDelegationHash: hexHash("d"),
      delegationManager: registry.protocol.manager.address, rootCapAtomic: "1000000",
      rootStartsAtUnix: nowUnix - 86400, rootExpiresAtUnix: nowUnix + 86400,
      periodTerms,
      rootNonceAtomic: "0" },
    token: registry.token.address, decimals: 6, deploymentEvidenceHash: registry.evidenceHash,
    provider: { endpointOrigin: registry.facilitatorOrigin, endpointHash: registry.facilitatorEndpointHash,
      facilitatorAddresses: registry.facilitatorAddresses, supportedResponseHash: "e".repeat(64), observedAt: SA_TEST_AT },
    initialSnapshot: { chainId: 8453, endpointOrigin: "https://mainnet.base.org", endpointHash: "f".repeat(64),
      observedAt: SA_TEST_AT, preparationBlock: block, safeBlock: safe, safeState: state },
    requirements: { scheme: "exact", network: "eip155:8453", asset: registry.token.address, amount: "10000",
      payTo: SA_TEST_RECIPIENT, maxTimeoutSeconds: 300,
      extra: { assetTransferMethod: "erc7710", facilitatorAddresses: registry.facilitatorAddresses } },
    preparedAt: SA_TEST_AT, expiresAt: new Date(Date.parse(SA_TEST_AT) + 300000).toISOString(),
    afterUnix: nowUnix, beforeUnix: nowUnix + 300, policyHash: "9".repeat(64),
  };
  return { ...intent, policyHash: saPolicyHash(intent.binding, intent.request) };
}

/** Structural material for public-surface tests only, never SDK/chain acceptance proof. */
export function saStructuralMaterial(op: SmartAccountGaslessOperationRecord): SmartAccountGaslessSealedMaterial {
  const paymentPayload = { x402Version: 2 as const, accepted: op.intent.requirements, payload: {
    delegationManager: op.intent.binding.delegationManager, delegator: op.intent.binding.ownerAddress,
    permissionContext: "0x1234" as Hex } };
  const hashes = { encodedRootHash: op.intent.binding.encodedRootHash, encodedChildHash: "1".repeat(64),
    permissionContextHash: domainHash(SA_MATERIAL_DOMAINS.permissionContext, paymentPayload.payload.permissionContext),
    payloadHash: domainHash(SA_MATERIAL_DOMAINS.payload, canonicalJson(paymentPayload)),
    requirementsHash: saRequirementsHash(op.intent.requirements), rootDelegationHash: op.intent.binding.rootDelegationHash,
    childDelegationHash: hexHash("4") };
  return { phase: "sealed", paymentPayload,
    descriptor: { ...hashes, materialHash: saMaterialHash(op.operationId, op.fingerprint, hashes), sealedAt: op.createdAt } };
}

/** Structural finalized-unused proof for routing/storage tests; the actual RPC proof is tested separately. */
export function saStructuralUnused(input: SmartAccountGaslessObserveInput, observedAt: string): SmartAccountGaslessRpcObservation {
  const expiry = { numberAtomic: "50000150", hash: hexHash("a"), timestampAtomic: String(input.intent.beforeUnix) };
  return { cursor: { ...input.cursor, nextBlockAtomic: "50000151", previousEndBlock: expiry, expiryBlock: expiry,
    childScanComplete: true, transferScanComplete: true }, settlement: null,
    observation: { observedAt, phase: "expired_unused", reason: null, candidateTxHash: null, evidenceHash: "8".repeat(64) },
    unusedProof: { observedAt, startBlock: input.cursor.startBlock, expiryBlock: expiry,
      finalityBlock: { numberAtomic: "50000200", hash: hexHash("b"), timestampAtomic: String(input.intent.beforeUnix + 100) },
      childDelegationHash: input.material.childDelegationHash, childSpentAtomic: "0", childScanHash: "a".repeat(64),
      transferScanHash: "b".repeat(64), anchorsHash: "c".repeat(64), protocolHash: "d".repeat(64) } };
}
