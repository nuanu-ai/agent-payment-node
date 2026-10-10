import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { permit2FactHash } from "./production-proxy-call.js";
import { inspectPermit2ProductionReceipt } from "./production-receipt-facts.js";
import { validatePermit2ProductionRecord, type Permit2ProductionRecord } from "./production-repository.js";
import { permit2ProductionOperationDigest, validatePermit2ProductionSigned, type Permit2ProductionSigned } from "./production-signed.js";
import { Permit2ObserverRpc, type Permit2ObservationMetrics } from "./production-observer-rpc.js";
import { assertExpiredUnused, assertObserverChain, assertObserverIdentity, observerBlock, observerIdentityCalls,
  observerNonceCalls, observerReceipt, observerTransaction, type Permit2ObservedBlock } from "./production-observer-facts.js";

export type Permit2ObservationMode = "settlement" | "expired_unused";
/** Only the private map supplies authority. Serialization and cloning cannot mint a proof. */
export interface Permit2ObservationProof { readonly kind: "checked-permit2-production-observation" }
export interface Permit2ObservationProjection {
  readonly mode: Permit2ObservationMode;
  readonly outcome: "hold" | "settled" | "expired_unused";
  readonly reason: "checked" | "reverted_locator" | "unavailable_or_mismatch";
  readonly operationDigest: string; readonly materialHash: string; readonly requestHash: string; readonly challengeHash: string;
  readonly signedHash: string | null; readonly transactionHash: string | null;
  readonly blockNumber: string | null; readonly blockHash: string | null;
  readonly tokenPermitOutcome: "not_requested" | "not_proven" | null;
  readonly rpc: Permit2ObservationMetrics;
}
export interface Permit2ProductionObservationInput {
  readonly profile: string; readonly stateRoot: string; readonly rpcUrl: string;
  readonly record: Permit2ProductionRecord; readonly signed: Permit2ProductionSigned | null;
  readonly mode: Permit2ObservationMode; readonly locator: string | null;
}
export interface Permit2ProductionObservation {
  readonly projection: Permit2ObservationProjection; readonly proof: Permit2ObservationProof | null;
}
const proofs = new WeakMap<Permit2ObservationProof, { readonly binding: string; readonly projection: Permit2ObservationProjection }>();
function binding(record: Permit2ProductionRecord, signed: Permit2ProductionSigned | null, mode: Permit2ObservationMode): string {
  return canonicalJson({ mode, operationDigest: permit2ProductionOperationDigest(record), materialHash: record.material.materialHash,
    requestHash: record.material.checked.requestHash, challengeHash: record.material.checked.challengeHash, signedHash: signed?.signedHash ?? null });
}
/** Actual finite canonical observer only. No effect, journal, policy-admission or accounting mutation. */
export async function observePermit2Production(input: Permit2ProductionObservationInput): Promise<Permit2ProductionObservation> {
  // Every caller-owned field is copied/validated before the first await, including private context and bearer material.
  if (!isPlainRecord(input) || !exactKeys(input, ["profile", "stateRoot", "rpcUrl", "record", "signed", "mode", "locator"])) invalid();
  const profile = canonicalProfile(input.profile), stateRoot = input.stateRoot, endpoint = input.rpcUrl;
  const mode = input.mode, locator = input.locator;
  const record = validatePermit2ProductionRecord(JSON.parse(canonicalJson(input.record)));
  const supplied = input.signed === null ? null : JSON.parse(canonicalJson(input.signed)) as Permit2ProductionSigned;
  freezeObservationValue(record); freezeObservationValue(supplied);
  if (record.material.wallet.profile !== profile || typeof stateRoot !== "string" || !stateRoot || typeof endpoint !== "string" ||
      !["settlement", "expired_unused"].includes(mode) || mode === "settlement" && (!permit2FactHash(locator) || supplied === null) ||
      mode === "expired_unused" && locator !== null) invalid();
  let signed: Permit2ProductionSigned | null = null, block: Permit2ObservedBlock | null = null;
  let rpc: Permit2ObserverRpc | null = null;
  let tokenPermitOutcome: Permit2ObservationProjection["tokenPermitOutcome"] = null;
  const projection = (outcome: Permit2ObservationProjection["outcome"], reason: Permit2ObservationProjection["reason"]): Permit2ObservationProjection => Object.freeze({
    mode, outcome, reason, operationDigest: permit2ProductionOperationDigest(record), materialHash: record.material.materialHash,
    requestHash: record.material.checked.requestHash, challengeHash: record.material.checked.challengeHash,
    signedHash: signed?.signedHash ?? null, transactionHash: locator, blockNumber: block?.number ?? null, blockHash: block?.hash ?? null,
    tokenPermitOutcome, rpc: rpc?.metrics() ?? Object.freeze({ attempts: 0, admissions: 0, physicalDispatches: 0, logicalReads: 0, errors: 0, methods: Object.freeze({}) }) });
  try {
    if (supplied !== null) signed = await validatePermit2ProductionSigned(supplied, record);
    rpc = new Permit2ObserverRpc(endpoint, new StateStore(stateRoot));
    const first = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["finalized", false] },
      ...(mode === "settlement" ? [{ method: "eth_getTransactionByHash", params: [locator] },
        { method: "eth_getTransactionReceipt", params: [locator] }] : [])]);
    assertObserverChain(first[0]);
    const head = observerBlock(first[1], "finalized");
    let reverted = false;
    if (mode === "settlement") {
      const transaction = observerTransaction(first[2], locator!), receipt = observerReceipt(first[3], first[2]);
      const facts = await inspectPermit2ProductionReceipt(record, signed!, transaction, receipt);
      if (facts.attribution.transactionHash !== locator || BigInt(facts.attribution.blockNumber) > BigInt(head.number)) invalid();
      block = observerBlock((await rpc.batch([{ method: "eth_getBlockByNumber", params: [transaction.blockNumber, false] }]))[0], transaction.blockNumber);
      if (block.hash !== facts.attribution.blockHash) invalid();
      tokenPermitOutcome = facts.attribution.tokenPermitOutcome;
      reverted = facts.receiptStatus === "reverted_locator";
    } else { block = head; }
    const identity = observerIdentityCalls(record.material, block);
    const reads = await rpc.batch([...identity, ...(mode === "expired_unused" ? observerNonceCalls(record.material, block) : [])]);
    assertObserverIdentity(record.material, reads.slice(0, 3));
    if (mode === "expired_unused") assertExpiredUnused(record.material, block, reads.slice(3));
    const rechecked = await rpc.batch([{ method: "eth_chainId", params: [] },
      { method: "eth_getBlockByNumber", params: [block.tag, false] },
      ...(head.hash === block.hash ? [] : [{ method: "eth_getBlockByNumber", params: [head.tag, false] }])]);
    assertObserverChain(rechecked[0]);
    const again = observerBlock(rechecked[1], block.tag);
    if (again.hash !== block.hash || again.timestamp !== block.timestamp || rechecked.length === 3 &&
        observerBlock(rechecked[2], head.tag).hash !== head.hash) invalid();
    if (reverted) return Object.freeze({ projection: projection("hold", "reverted_locator"), proof: null });
    const checked = projection(mode === "settlement" ? "settled" : "expired_unused", "checked");
    const proof = Object.freeze({ kind: "checked-permit2-production-observation" as const });
    proofs.set(proof, { binding: binding(record, signed, mode), projection: checked });
    return Object.freeze({ projection: checked, proof });
  } catch { return Object.freeze({ projection: projection("hold", "unavailable_or_mismatch"), proof: null }); }
  finally { rpc?.close(); }
}
/** Later lifecycle code must consume this private capability, bound to the unchanged frozen operation and mode. */
export async function consumePermit2ObservationProof(proof: Permit2ObservationProof, record: Permit2ProductionRecord,
  supplied: Permit2ProductionSigned | null, mode: Permit2ObservationMode): Promise<Permit2ObservationProjection> {
  const saved = proofs.get(proof);
  if (saved === undefined) invalid();
  record = validatePermit2ProductionRecord(JSON.parse(canonicalJson(record)));
  const value = supplied === null ? null : JSON.parse(canonicalJson(supplied)) as Permit2ProductionSigned;
  freezeObservationValue(record); freezeObservationValue(value);
  const signed = value === null ? null : await validatePermit2ProductionSigned(value, record);
  // Check again after recovery: simultaneous consumers cannot both acquire authority.
  if (proofs.get(proof) !== saved || saved.binding !== binding(record, signed, mode)) invalid();
  proofs.delete(proof);
  return saved.projection;
}
function freezeObservationValue(value: unknown): void {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeObservationValue(child);
    Object.freeze(value);
  }
}
function invalid(): never { throw new ApnError("APN_X402_SETTLEMENT_INVALID", "Permit2 observation is not bound to the frozen operation."); }
