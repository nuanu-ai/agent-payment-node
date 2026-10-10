import { getAddress } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evmNativeCustody, validateEvmNativeCustody, type EvmNativeCustody } from "./evm-native-custody.js";
import type { OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
import { HttpsBaseRpc } from "./rpc.js";
import type { StateStore } from "./state.js";
import { CircleRepository } from "./circle-v2-evm/repository.js";
import { CircleRpc } from "./circle-v2-evm/rpc.js";
import { CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./circle-v2-evm/catalog.js";
import { circleHex, circleRecord, circleUint, assertCircleAttestation, decodeCircleSource, verifyCircleApproval, type CircleReceiptProof } from "./circle-v2-evm/protocol.js";
import { verifyCircleClosureFinality } from "./circle-v2-evm/preflight.js";
import type { CircleEffect, CircleOperationV1 } from "./circle-v2-evm/operation-model.js";

export interface CircleNativeAdmission {
  readonly schemaVersion: "apn.circle-finalized-native-admission.v1";
  readonly recipientCustody: EvmNativeCustody;
  readonly sources: readonly { readonly operationId: string; readonly sourceIdentityHash: string }[];
}
export interface VerifiedCircleNativeAdmission { readonly kind: "verified-circle-native-source" }
const verified = new WeakMap<VerifiedCircleNativeAdmission, { readonly binding: CircleNativeAdmission; readonly profileHash: string; readonly account: string }>();
export function verifiedCircleNativeSources(token: VerifiedCircleNativeAdmission, profileHash: string, account: string): ReadonlyMap<string, string> {
  const binding = verified.get(token); if (binding === undefined || binding.profileHash !== profileHash || binding.account !== account) blocked();
  return new Map(binding.binding.sources.map(source => [source.operationId, source.sourceIdentityHash]));
}
export function validateCircleNativeAdmission(value: unknown): CircleNativeAdmission {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "recipientCustody", "sources"]) ||
      value.schemaVersion !== "apn.circle-finalized-native-admission.v1" || !Array.isArray(value.sources) || value.sources.length !== 1) blocked();
  validateEvmNativeCustody(value.recipientCustody);
  for (const source of value.sources) if (!isPlainRecord(source) || !exactKeys(source, ["operationId", "sourceIdentityHash"]) ||
      ![source.operationId, source.sourceIdentityHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x))) blocked();
  return value as unknown as CircleNativeAdmission;
}
function eligible(op: CircleOperationV1, profileHash: string, account: string): boolean {
  return op.profileHash === profileHash && op.sourceCustody.profileHash === profileHash && op.sourceCustody.walletAddress === account &&
    ["awaiting_mint", "mint_unknown", "awaiting_finality", "completed"].includes(op.state) && op.source?.finalityTag === "finalized" &&
    op.attestation !== null && op.residualAllowanceAtomic === "0" && op.effects.some(e => e.role === "approval") &&
    op.effects.some(e => e.role === "burn") && op.effects.filter(e => e.role !== "mint").every(e => e.phase === "confirmed" && e.proof !== null);
}
export function circleNativeSourceIdentity(op: CircleOperationV1): string {
  return hashObject({ sourceCustody: op.sourceCustody, source: op.source, attestation: op.attestation,
    effects: op.effects.filter(e => e.role !== "mint"), residualAllowanceAtomic: op.residualAllowanceAtomic });
}

function envelope(effect: CircleEffect, input: unknown): void {
  const t = circleRecord(input), e = effect.envelope;
  if (circleHex(t.hash, 32) !== effect.transactionHash || circleUint(t.nonce).toString() !== e.nonceAtomic ||
      circleUint(t.gas).toString() !== e.gasLimitAtomic || circleUint(t.maxFeePerGas).toString() !== e.maxFeePerGasAtomic ||
      circleUint(t.maxPriorityFeePerGas).toString() !== e.maxPriorityFeePerGasAtomic || circleHex(t.input) !== e.data ||
      getAddress(String(t.from)) !== e.from || getAddress(String(t.to)) !== e.to || circleUint(t.value) !== 0n || circleUint(t.chainId) !== 42161n) blocked();
}
function sameReceipt(old: CircleReceiptProof, current: CircleReceiptProof): void {
  for (const key of ["transactionHash", "blockHash", "blockNumberAtomic", "transactionHashBinding", "receiptHash", "logsHash", "actualFeeAtomic"] as const)
    if (old[key] !== current[key]) blocked();
}
export async function verifyCircleNativeAdmission(state: StateStore, port: RpcPort, profile: string, account: string, recipient: string,
  expected?: CircleNativeAdmission): Promise<{ readonly binding: CircleNativeAdmission; readonly token: VerifiedCircleNativeAdmission } | null> {
  const profileHash = state.profileHash(profile);
  const candidates = (await new CircleRepository(state.root).listOperations(profileHash)).filter(op => !op.terminal && eligible(op, profileHash, account));
  if (expected === undefined && candidates.length === 0) return null;
  const recipientCustody = await evmNativeCustody(state, "default");
  if (recipientCustody.walletAddress !== recipient) { if (expected !== undefined) blocked(); return null; }
  if (expected !== undefined && hashObject(recipientCustody) !== hashObject(validateCircleNativeAdmission(expected).recipientCustody)) blocked();
  const owner = await evmNativeCustody(state, profile);
  const op = expected === undefined ? candidates.length === 1 ? candidates[0] : undefined :
    await new CircleRepository(state.root).load(expected.sources[0]!.operationId);
  if (op == null) { if (expected !== undefined) blocked(); return null; }
  if (!eligible(op, profileHash, account) || hashObject(owner) !== hashObject(op.sourceCustody) ||
      expected !== undefined && expected.sources[0]!.sourceIdentityHash !== circleNativeSourceIdentity(op)) blocked();
  port.armEvmDirectRpcGuard?.();
  assertCircleAttestation(op.source!, op.attestation!);
  /** Exactly fourteen scalar read POSTs for one saved source. No journal mutation or custody entry. */
  class PublicCircleReads extends CircleRpc {
    private count = 0;
    constructor(private readonly port: RpcPort) { super("https://public.invalid", 42161); }
    override async call(method: string, params: readonly unknown[]): Promise<unknown> {
      if (++this.count > 14 || !["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_call"].includes(method) ||
          this.port.coinbaseGaslessCall === undefined) blocked();
      return await this.port.coinbaseGaslessCall(method as Parameters<NonNullable<RpcPort["coinbaseGaslessCall"]>>[0], params);
    }
  }
  const rpc = new PublicCircleReads(port), approval = op.effects.find(e => e.role === "approval")!, burn = op.effects.find(e => e.role === "burn")!;
  const a = await rpc.observation(approval.transactionHash!, "finalized"), b = await rpc.observation(burn.transactionHash!, "finalized");
  if (a === null || b === null) blocked(); envelope(approval, a.transaction); envelope(burn, b.transaction);
  const historical = String(await rpc.read(CIRCLE_SOURCE_TOKEN, "allowance", [owner.walletAddress, CIRCLE_MESSENGER], { blockHash: circleRecord(a.canonicalBlock).hash, requireCanonical: true } as unknown as string));
  const zero = String(await rpc.read(CIRCLE_SOURCE_TOKEN, "allowance", [owner.walletAddress, CIRCLE_MESSENGER], { blockHash: circleRecord(b.finalityHead).hash, requireCanonical: true } as unknown as string));
  if (zero !== "0") blocked(); sameReceipt(approval.proof!, verifyCircleApproval(a, false, historical));
  const source = decodeCircleSource(b, op.destinationChain); sameReceipt(burn.proof!, source); verifyCircleClosureFinality(op.source!, source);
  const binding: CircleNativeAdmission = { schemaVersion: "apn.circle-finalized-native-admission.v1", recipientCustody,
    sources: [{ operationId: op.operationId, sourceIdentityHash: circleNativeSourceIdentity(op) }] };
  // The public journal projection must never alias the private verified authority snapshot.
  const snapshot: CircleNativeAdmission = Object.freeze({ schemaVersion: binding.schemaVersion,
    recipientCustody: Object.freeze({ ...binding.recipientCustody }),
    sources: Object.freeze(binding.sources.map(source => Object.freeze({ ...source }))) });
  const token = Object.freeze({ kind: "verified-circle-native-source" as const });
  verified.set(token, Object.freeze({ binding: snapshot, profileHash, account })); return { binding, token };
}
/** Native calls this after foreground approval, before the actual signature; one additional pending nonce read. */
export async function recheckCircleNativeAdmission(state: StateStore, operation: OperationRecord, port?: RpcPort): Promise<VerifiedCircleNativeAdmission | null> {
  const binding = operation.evm?.circleNativeAdmission; if (binding === undefined) return null;
  if (operation.chainId !== 42161 || operation.evm?.asset.kind !== "native") blocked();
  const rpc = port ?? new HttpsBaseRpc(operation.evm.feeQuote.rpcOrigin, { directGuardState: state }); rpc.armEvmDirectRpcGuard?.();
  const result = await verifyCircleNativeAdmission(state, rpc, operation.profile, operation.walletAddress, operation.recipient, binding);
  if (result === null || rpc.coinbaseGaslessCall === undefined || circleUint(await rpc.coinbaseGaslessCall("eth_getTransactionCount", [operation.walletAddress, "pending"])).toString() !== operation.economics?.nonceAtomic) blocked();
  return result.token;
}
function blocked(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Finalized Circle source admission is unavailable or changed; retain the existing source holds."); }
