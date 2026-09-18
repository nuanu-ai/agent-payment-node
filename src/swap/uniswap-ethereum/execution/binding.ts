import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex, type TransactionSerialized } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../../canonical.js";
import { ApnError } from "../../../errors.js";
import { parseAtomic } from "../../../money.js";
import { validateSwapOperation, type SwapOperationRecord } from "../../model.js";
import { requireSwapProtocol, validateSwapProtocolRegistry, type SwapProtocolRegistry } from "../../protocol-registry.js";
import type { UniswapTransactionEnvelope } from "../../uniswap-codec.js";
import { UNISWAP_CHAIN, UNISWAP_ROUTER } from "../../uniswap-pin.js";
import { decodeUniswapRouterCalldataFor } from "../../uniswap-router.js";
import type { UniswapExecutionApprovalRequest, UniswapExecutionBinding, UniswapExecutionFreshness, UniswapOwnerAdmission } from "./types.js";

const BINDING_VERSION = "apn.uniswap-ethereum.execution-binding.v1" as const;
const APPROVAL_VERSION = "apn.uniswap-ethereum.execution-approval.v1" as const;
const HASH = /^[a-f0-9]{64}$/u;
const HEX32 = /^0x[a-f0-9]{64}$/u;
const HEX_BYTES = /^0x(?:[a-fA-F0-9]{2})+$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_FRESHNESS_AGE_MS = 30_000;

export function assertInjectedProtocol(operationValue: unknown, registryValue: unknown): SwapProtocolRegistry {
  const operation = validateSwapOperation(operationValue), registry = validateSwapProtocolRegistry(registryValue);
  if (registry.registryDigest !== operation.protocolRegistryDigest || registry.registryVersion !== operation.protocolRegistryVersion) {
    blocked("Injected Uniswap protocol registry does not match the prepared operation.", "uniswap_protocol_registry_drift");
  }
  requireSwapProtocol(registry, operation.mechanismDigest);
  return registry;
}

export function createUniswapApprovalRequest(operationValue: unknown, envelope: UniswapTransactionEnvelope,
  freshness: UniswapExecutionFreshness, now: Date): UniswapExecutionApprovalRequest {
  const operation = validateSwapOperation(operationValue);
  validateEnvelope(operation, envelope, Math.floor(Date.parse(operation.quote.expiresAt) / 1000));
  validateFreshness(operation, envelope, freshness, now);
  const maxFee = envelope.maxFeePerGas ?? envelope.gasPrice!;
  const body = { schemaVersion: APPROVAL_VERSION, operationId: operation.operationId, quoteHash: operation.quote.quoteHash,
    account: operation.quote.account, recipient: operation.quote.recipient, inputAmountAtomic: operation.quote.inputAmountAtomic,
    expectedOutputAtomic: operation.quote.expectedOutputAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
    slippageBps: operation.quote.slippageBps, gasLimit: envelope.gasLimit, maxFeePerGas: maxFee,
    maxPriorityFeePerGas: envelope.maxPriorityFeePerGas ?? "0",
    maximumGasCostAtomic: (BigInt(envelope.gasLimit) * BigInt(maxFee)).toString(), chainId: 1 as const,
    router: UNISWAP_ROUTER, envelopeHash: operation.quote.unsignedTransactionPayloadHash, nonce: freshness.nonce,
    executionHeadNumber: freshness.headBlockNumber, executionHeadHash: freshness.headBlockHash,
    policyDigest: operation.policyDigest, mechanismDigest: operation.mechanismDigest,
    protocolRegistryDigest: operation.protocolRegistryDigest, expiresAt: operation.quote.expiresAt } as const;
  return { ...body, approvalHash: domainHash(APPROVAL_VERSION, canonicalJson(body)) };
}

export function createUniswapExecutionBinding(input: { readonly operation: SwapOperationRecord;
  readonly envelope: UniswapTransactionEnvelope; readonly freshness: UniswapExecutionFreshness;
  readonly admission: UniswapOwnerAdmission; readonly approvalHash: string }): UniswapExecutionBinding {
  const operation = validateSwapOperation(input.operation);
  if (operation.state !== "submitting" || operation.submissionMarker === null) blocked("Uniswap execution requires a durable submission marker.", "uniswap_marker_missing");
  const deadline = Math.floor(Date.parse(operation.quote.expiresAt) / 1000);
  validateEnvelope(operation, input.envelope, deadline); validateFreshness(operation, input.envelope, input.freshness,
    new Date(input.freshness.checkedAt));
  if (input.admission.profile !== operation.quote.profile || input.admission.profileHash !== operation.ownerProfileHash ||
      getAddress(input.admission.account) !== operation.quote.account || !HASH.test(input.admission.walletBindingHash) ||
      !HASH.test(input.admission.admissionHash) || !canonicalInstant(input.admission.walletCreatedAt)) {
    blocked("Uniswap owner admission does not match the prepared operation.", "uniswap_owner_admission");
  }
  if (!HASH.test(input.approvalHash)) invalid("Uniswap approval binding is invalid.");
  if (createUniswapApprovalRequest(operation, input.envelope, input.freshness,
    new Date(input.freshness.checkedAt)).approvalHash !== input.approvalHash) {
    blocked("Uniswap approval does not bind the exact execution state.", "uniswap_approval_tamper");
  }
  const body = { schemaVersion: BINDING_VERSION, operationId: operation.operationId,
    operationIntegrityHash: operation.submissionMarker.operationIntegrityHash, profileHash: operation.ownerProfileHash,
    account: operation.quote.account, walletBindingHash: input.admission.walletBindingHash,
    walletCreatedAt: input.admission.walletCreatedAt, ownerAdmissionHash: input.admission.admissionHash, chainId: 1 as const,
    envelope: input.envelope, envelopeHash: sha256(canonicalJson(input.envelope)), nonce: input.freshness.nonce,
    executionHeadNumber: input.freshness.headBlockNumber, executionHeadHash: input.freshness.headBlockHash,
    freshnessCheckedAt: input.freshness.checkedAt, deadline,
    quoteHash: operation.quote.quoteHash, simulationRequestHash: operation.quote.simulation.requestHash,
    simulationResultHash: operation.quote.simulation.resultHash, policyDigest: operation.policyDigest,
    mechanismDigest: operation.mechanismDigest, protocolRegistryDigest: operation.protocolRegistryDigest,
    approvalHash: input.approvalHash, submissionMarkerHash: operation.submissionMarker.markerHash } as const;
  return { ...body, bindingHash: domainHash(BINDING_VERSION, canonicalJson(body)) };
}

export function validateUniswapExecutionBinding(value: unknown, operationValue: unknown): UniswapExecutionBinding {
  const operation = validateSwapOperation(operationValue);
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "operationIntegrityHash", "profileHash", "account",
    "walletBindingHash", "walletCreatedAt", "ownerAdmissionHash", "chainId", "envelope", "envelopeHash", "nonce",
    "executionHeadNumber", "executionHeadHash", "freshnessCheckedAt", "deadline",
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
      !HASH.test(binding.ownerAdmissionHash) || !HASH.test(binding.approvalHash) || !canonicalInstant(binding.walletCreatedAt) ||
      !canonicalInstant(binding.freshnessCheckedAt) || binding.freshnessCheckedAt < operation.submissionMarker.markedAt ||
      binding.freshnessCheckedAt >= operation.quote.expiresAt || !HEX32.test(binding.executionHeadHash)) corrupt("Uniswap execution binding integrity failed.");
  validateEnvelope(operation, binding.envelope, binding.deadline); decimal(binding.nonce, false); decimal(binding.executionHeadNumber, false);
  const freshness: UniswapExecutionFreshness = { chainId: 1, account: binding.account, nonce: binding.nonce,
    gasLimit: binding.envelope.gasLimit, maxFeePerGas: binding.envelope.maxFeePerGas ?? binding.envelope.gasPrice!,
    maxPriorityFeePerGas: binding.envelope.maxPriorityFeePerGas ?? "0",
    simulationBlockNumber: operation.quote.simulation.blockNumber,
    simulationBlockHash: operation.quote.simulation.blockHash as `0x${string}`,
    headBlockNumber: binding.executionHeadNumber, headBlockHash: binding.executionHeadHash,
    checkedAt: binding.freshnessCheckedAt };
  validateFreshness(operation, binding.envelope, freshness, new Date(binding.freshnessCheckedAt));
  if (createUniswapApprovalRequest(operation, binding.envelope, freshness, new Date(binding.freshnessCheckedAt)).approvalHash !== binding.approvalHash) {
    corrupt("Uniswap foreground approval is not bound to the execution state.");
  }
  return binding;
}

export function validateFreshness(operationValue: unknown, envelope: UniswapTransactionEnvelope, fresh: UniswapExecutionFreshness,
  now: Date): void {
  const operation = validateSwapOperation(operationValue);
  const at = instant(now);
  if (!isPlainRecord(fresh) || !exactKeys(fresh, ["chainId", "account", "nonce", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas",
    "simulationBlockNumber", "simulationBlockHash", "headBlockNumber", "headBlockHash", "checkedAt"]) ||
      fresh.chainId !== 1 || getAddress(fresh.account) !== operation.quote.account || fresh.account !== operation.quote.account || !canonicalInstant(fresh.checkedAt) ||
      fresh.gasLimit !== envelope.gasLimit || fresh.maxFeePerGas !== (envelope.maxFeePerGas ?? envelope.gasPrice) ||
      fresh.maxPriorityFeePerGas !== (envelope.maxPriorityFeePerGas ?? "0") ||
      fresh.simulationBlockNumber !== operation.quote.simulation.blockNumber ||
      fresh.simulationBlockHash !== operation.quote.simulation.blockHash || !HEX32.test(fresh.headBlockHash)) {
    blocked("Uniswap nonce, gas, or fee guard drifted from the exact unsigned envelope.", "uniswap_execution_drift");
  }
  const nonce = decimal(fresh.nonce, false), simulationBlock = decimal(fresh.simulationBlockNumber, false),
    headBlock = decimal(fresh.headBlockNumber, false);
  decimal(fresh.gasLimit, true); const maxFee = decimal(fresh.maxFeePerGas, true), priority = decimal(fresh.maxPriorityFeePerGas, false);
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || priority > maxFee || headBlock < simulationBlock ||
      headBlock - simulationBlock > BigInt(operation.quote.simulation.maxHeadDrift)) {
    blocked("Uniswap execution head, nonce, gas, or fee is outside the admitted bounds.", "uniswap_execution_drift");
  }
  const checked = Date.parse(fresh.checkedAt), observed = Date.parse(at);
  if (fresh.checkedAt >= operation.quote.expiresAt || checked > observed || observed - checked > MAX_FRESHNESS_AGE_MS) {
    blocked("Uniswap execution freshness proof is stale or the deadline expired.", "uniswap_deadline_drift");
  }
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
  if (!isPlainRecord(envelope)) invalid("Uniswap execution envelope schema is invalid.");
  const keys = Object.keys(envelope), base = ["from", "to", "data", "value", "gasLimit", "chainId"],
    expected = keys.includes("gasPrice") ? [...base, "gasPrice"] : [...base, "maxFeePerGas", "maxPriorityFeePerGas"];
  if (!exactKeys(envelope, expected) || typeof envelope.from !== "string" || typeof envelope.to !== "string" ||
      typeof envelope.data !== "string" || !HEX_BYTES.test(envelope.data) || envelope.data.length > 131_074 ||
      getAddress(envelope.from) !== envelope.from || getAddress(envelope.to) !== envelope.to ||
      operation.quote.sourceAsset.chain !== UNISWAP_CHAIN || operation.quote.destinationAsset.chain !== UNISWAP_CHAIN ||
      envelope.chainId !== 1 || envelope.from !== operation.quote.account || envelope.to !== UNISWAP_ROUTER ||
      envelope.value !== operation.quote.inputAmountAtomic || sha256(canonicalJson(envelope)) !== operation.quote.unsignedTransactionPayloadHash ||
      deadline !== Math.floor(Date.parse(operation.quote.expiresAt) / 1000) || !Number.isSafeInteger(deadline) ||
      deadline <= 0 || deadline > 4_294_967_295) blocked("Uniswap envelope does not match the validated quote.", "uniswap_envelope_binding");
  const gas = decimal(envelope.gasLimit, true), value = decimal(envelope.value, true);
  if (gas > MAX_UINT64 || value > MAX_UINT256) invalid("Uniswap execution integer exceeds protocol bounds.");
  let maximumFee: bigint;
  if (envelope.gasPrice !== undefined) { maximumFee = decimal(envelope.gasPrice, true); }
  else {
    const fee = decimal(envelope.maxFeePerGas, true), priority = decimal(envelope.maxPriorityFeePerGas, false);
    if (fee > MAX_UINT256 || priority > fee) invalid("Uniswap execution fee bounds are invalid.");
    maximumFee = fee;
  }
  if (gas * maximumFee > MAX_UINT256) invalid("Uniswap maximum gas cost exceeds uint256.");
  if (operation.quote.destinationAsset.kind !== "token" || operation.quote.destinationAsset.identifier === null) {
    blocked("Uniswap output must be an exact pinned token.", "uniswap_envelope_binding");
  }
  const decoded = decodeUniswapRouterCalldataFor(envelope.data, { recipient: operation.quote.recipient,
    inputAmountAtomic: operation.quote.inputAmountAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic, deadline,
    outputToken: operation.quote.destinationAsset.identifier });
  if (decoded.routeHash !== operation.quote.routeHash) blocked("Uniswap router route changed after quote validation.", "uniswap_route_drift");
}

function decimal(value: unknown, positive: boolean): bigint { try { if (typeof value !== "string" || value.length > 78) throw new Error();
  const parsed = parseAtomic(value, { positive }); if (parsed > MAX_UINT256) throw new Error(); return parsed; }
  catch { return invalid("Uniswap execution integer is invalid."); } }
function instant(value: Date): string { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid("Uniswap execution time is invalid."); return value.toISOString(); }
function canonicalInstant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
