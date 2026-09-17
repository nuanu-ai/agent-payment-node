import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex, type TransactionSerialized } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../../canonical.js";
import { ApnError } from "../../../errors.js";
import { parseAtomic } from "../../../money.js";
import { validateSwapOperation, type SwapOperationRecord } from "../../model.js";
import { requireSwapProtocol, validateSwapProtocolRegistry, type SwapProtocolRegistry } from "../../protocol-registry.js";
import type { UniswapTransactionEnvelope } from "../../uniswap-codec.js";
import { UNISWAP_CHAIN, UNISWAP_ROUTER } from "../../uniswap-pin.js";
import { decodeUniswapRouterCalldata } from "../../uniswap-router.js";
import type { UniswapExecutionApprovalRequest, UniswapExecutionBinding, UniswapExecutionFreshness, UniswapOwnerAdmission } from "./types.js";

const BINDING_VERSION = "apn.uniswap-ethereum.execution-binding.v1" as const;
const APPROVAL_VERSION = "apn.uniswap-ethereum.execution-approval.v1" as const;
const HASH = /^[a-f0-9]{64}$/u;

export function assertInjectedProtocol(operationValue: unknown, registryValue: unknown): SwapProtocolRegistry {
  const operation = validateSwapOperation(operationValue), registry = validateSwapProtocolRegistry(registryValue);
  if (registry.registryDigest !== operation.protocolRegistryDigest || registry.registryVersion !== operation.protocolRegistryVersion) {
    blocked("Injected Uniswap protocol registry does not match the prepared operation.", "uniswap_protocol_registry_drift");
  }
  requireSwapProtocol(registry, operation.mechanismDigest);
  return registry;
}

export function createUniswapApprovalRequest(operationValue: unknown, envelope: UniswapTransactionEnvelope): UniswapExecutionApprovalRequest {
  const operation = validateSwapOperation(operationValue);
  validateEnvelope(operation, envelope, Math.floor(Date.parse(operation.quote.expiresAt) / 1000));
  const maxFee = envelope.maxFeePerGas ?? envelope.gasPrice!;
  const body = { schemaVersion: APPROVAL_VERSION, operationId: operation.operationId, quoteHash: operation.quote.quoteHash,
    account: operation.quote.account, recipient: operation.quote.recipient, inputAmountAtomic: operation.quote.inputAmountAtomic,
    expectedOutputAtomic: operation.quote.expectedOutputAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
    slippageBps: operation.quote.slippageBps, gasLimit: envelope.gasLimit, maxFeePerGas: maxFee,
    maxPriorityFeePerGas: envelope.maxPriorityFeePerGas ?? "0",
    maximumGasCostAtomic: (BigInt(envelope.gasLimit) * BigInt(maxFee)).toString(), expiresAt: operation.quote.expiresAt } as const;
  return { ...body, approvalHash: domainHash(APPROVAL_VERSION, canonicalJson(body)) };
}

export function createUniswapExecutionBinding(input: { readonly operation: SwapOperationRecord;
  readonly envelope: UniswapTransactionEnvelope; readonly freshness: UniswapExecutionFreshness;
  readonly admission: UniswapOwnerAdmission; readonly approvalHash: string }): UniswapExecutionBinding {
  const operation = validateSwapOperation(input.operation);
  if (operation.state !== "submitting" || operation.submissionMarker === null) blocked("Uniswap execution requires a durable submission marker.", "uniswap_marker_missing");
  const deadline = Math.floor(Date.parse(operation.quote.expiresAt) / 1000);
  validateEnvelope(operation, input.envelope, deadline); validateFreshness(operation, input.envelope, input.freshness);
  if (input.admission.profile !== operation.quote.profile || input.admission.profileHash !== operation.ownerProfileHash ||
      getAddress(input.admission.account) !== operation.quote.account || !HASH.test(input.admission.walletBindingHash) ||
      !HASH.test(input.admission.admissionHash) || !canonicalInstant(input.admission.walletCreatedAt)) {
    blocked("Uniswap owner admission does not match the prepared operation.", "uniswap_owner_admission");
  }
  if (!HASH.test(input.approvalHash)) invalid("Uniswap approval binding is invalid.");
  const body = { schemaVersion: BINDING_VERSION, operationId: operation.operationId,
    operationIntegrityHash: operation.submissionMarker.operationIntegrityHash, profileHash: operation.ownerProfileHash,
    account: operation.quote.account, walletBindingHash: input.admission.walletBindingHash,
    walletCreatedAt: input.admission.walletCreatedAt, ownerAdmissionHash: input.admission.admissionHash, chainId: 1 as const,
    envelope: input.envelope, envelopeHash: sha256(canonicalJson(input.envelope)), nonce: input.freshness.nonce, deadline,
    quoteHash: operation.quote.quoteHash, simulationRequestHash: operation.quote.simulation.requestHash,
    simulationResultHash: operation.quote.simulation.resultHash, policyDigest: operation.policyDigest,
    mechanismDigest: operation.mechanismDigest, protocolRegistryDigest: operation.protocolRegistryDigest,
    approvalHash: input.approvalHash, submissionMarkerHash: operation.submissionMarker.markerHash } as const;
  return { ...body, bindingHash: domainHash(BINDING_VERSION, canonicalJson(body)) };
}

export function validateUniswapExecutionBinding(value: unknown, operationValue: unknown): UniswapExecutionBinding {
  const operation = validateSwapOperation(operationValue);
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "operationIntegrityHash", "profileHash", "account",
    "walletBindingHash", "walletCreatedAt", "ownerAdmissionHash", "chainId", "envelope", "envelopeHash", "nonce", "deadline",
    "quoteHash", "simulationRequestHash", "simulationResultHash", "policyDigest", "mechanismDigest", "protocolRegistryDigest",
    "approvalHash", "submissionMarkerHash", "bindingHash"]) || value.schemaVersion !== BINDING_VERSION) corrupt("Uniswap execution binding schema is invalid.");
  const binding = value as unknown as UniswapExecutionBinding, { bindingHash, ...body } = binding;
  if (!HASH.test(bindingHash) || bindingHash !== domainHash(BINDING_VERSION, canonicalJson(body)) || operation.submissionMarker === null ||
      binding.operationId !== operation.operationId || binding.operationIntegrityHash !== operation.submissionMarker.operationIntegrityHash ||
      binding.profileHash !== operation.ownerProfileHash || binding.account !== operation.quote.account || binding.chainId !== 1 ||
      binding.envelopeHash !== operation.quote.unsignedTransactionPayloadHash || binding.envelopeHash !== sha256(canonicalJson(binding.envelope)) ||
      binding.quoteHash !== operation.quote.quoteHash || binding.simulationRequestHash !== operation.quote.simulation.requestHash ||
      binding.simulationResultHash !== operation.quote.simulation.resultHash || binding.policyDigest !== operation.policyDigest ||
      binding.mechanismDigest !== operation.mechanismDigest || binding.protocolRegistryDigest !== operation.protocolRegistryDigest ||
      binding.submissionMarkerHash !== operation.submissionMarker.markerHash || !HASH.test(binding.walletBindingHash) ||
      !HASH.test(binding.ownerAdmissionHash) || !HASH.test(binding.approvalHash) || !canonicalInstant(binding.walletCreatedAt)) corrupt("Uniswap execution binding integrity failed.");
  validateEnvelope(operation, binding.envelope, binding.deadline); decimal(binding.nonce, false);
  return binding;
}

export function validateFreshness(operationValue: unknown, envelope: UniswapTransactionEnvelope, fresh: UniswapExecutionFreshness): void {
  const operation = validateSwapOperation(operationValue);
  if (!isPlainRecord(fresh) || !exactKeys(fresh, ["chainId", "account", "nonce", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas", "checkedAt"]) ||
      fresh.chainId !== 1 || getAddress(fresh.account) !== operation.quote.account || fresh.account !== operation.quote.account || !canonicalInstant(fresh.checkedAt) ||
      fresh.gasLimit !== envelope.gasLimit || fresh.maxFeePerGas !== (envelope.maxFeePerGas ?? envelope.gasPrice) ||
      fresh.maxPriorityFeePerGas !== (envelope.maxPriorityFeePerGas ?? "0")) {
    blocked("Uniswap nonce, gas, or fee guard drifted from the exact unsigned envelope.", "uniswap_execution_drift");
  }
  decimal(fresh.nonce, false); decimal(fresh.gasLimit, true); decimal(fresh.maxFeePerGas, true); decimal(fresh.maxPriorityFeePerGas, false);
  if (fresh.checkedAt >= operation.quote.expiresAt) blocked("Uniswap execution deadline expired.", "uniswap_deadline_drift");
}

export async function verifySignedUniswapTransaction(raw: Hex, bindingValue: unknown, operationValue: unknown): Promise<Hex> {
  const operation = validateSwapOperation(operationValue), binding = validateUniswapExecutionBinding(bindingValue, operation);
  try {
    const tx = parseTransaction(raw), recovered = getAddress(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized }));
    const envelope = binding.envelope, legacy = envelope.gasPrice !== undefined;
    if ((legacy ? tx.type !== "legacy" : tx.type !== "eip1559") || tx.chainId !== 1 || recovered !== binding.account ||
        tx.to === null || tx.to === undefined || getAddress(tx.to) !== UNISWAP_ROUTER || (tx.data ?? "0x").toLowerCase() !== envelope.data.toLowerCase() ||
        (tx.value ?? 0n).toString() !== envelope.value || (tx.nonce ?? -1).toString() !== binding.nonce ||
        tx.gas?.toString() !== envelope.gasLimit || (legacy ? tx.gasPrice?.toString() !== envelope.gasPrice :
          tx.maxFeePerGas?.toString() !== envelope.maxFeePerGas || tx.maxPriorityFeePerGas?.toString() !== envelope.maxPriorityFeePerGas) ||
        (tx.accessList ?? []).length !== 0 || tx.r === undefined || tx.s === undefined || BigInt(tx.s) <= 0n ||
        BigInt(tx.s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n ||
        (legacy ? tx.v === undefined : tx.yParity !== 0 && tx.yParity !== 1) ||
        serializeTransaction(tx, legacy ? { r: tx.r, s: tx.s, v: tx.v! } : { r: tx.r, s: tx.s, yParity: tx.yParity! }) !== raw) throw new Error();
    return keccak256(raw);
  } catch { return blocked("Signed Uniswap transaction does not match the exact sender, chain, nonce, or envelope.", "uniswap_signed_binding"); }
}

function validateEnvelope(operation: SwapOperationRecord, envelope: UniswapTransactionEnvelope, deadline: number): void {
  if (operation.quote.sourceAsset.chain !== UNISWAP_CHAIN || operation.quote.destinationAsset.chain !== UNISWAP_CHAIN ||
      envelope.chainId !== 1 || envelope.from !== operation.quote.account || envelope.to !== UNISWAP_ROUTER ||
      envelope.value !== operation.quote.inputAmountAtomic || sha256(canonicalJson(envelope)) !== operation.quote.unsignedTransactionPayloadHash ||
      deadline !== Math.floor(Date.parse(operation.quote.expiresAt) / 1000)) blocked("Uniswap envelope does not match the validated quote.", "uniswap_envelope_binding");
  const decoded = decodeUniswapRouterCalldata(envelope.data, { recipient: operation.quote.recipient,
    inputAmountAtomic: operation.quote.inputAmountAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic, deadline });
  if (decoded.routeHash !== operation.quote.routeHash) blocked("Uniswap router route changed after quote validation.", "uniswap_route_drift");
}

function decimal(value: unknown, positive: boolean): bigint { try { if (typeof value !== "string" || value.length > 78) throw new Error(); return parseAtomic(value, { positive }); }
  catch { return invalid("Uniswap execution integer is invalid."); } }
function canonicalInstant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
