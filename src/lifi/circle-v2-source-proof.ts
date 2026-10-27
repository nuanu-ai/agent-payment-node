import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { assertFinalizedChain, type FinalizedChainRead, type FinalizedReader } from "../evm-finalized-proof.js";
import { circleResidualAllowance, finalizedBlock, type CircleResidualBlock, type CircleResidualView } from "./circle-v2-residual-allowance.js";
import { evmRpcQuantity } from "../evm-rpc-codec.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { pastUnstartedDeadline } from "../unstarted-deadline.js";
import { CIRCLE_V2_SOURCE_TTL_MS } from "./circle-v2-source-service.js";
import type { NonEvmSourceJournal } from "./non-evm-source-journal.js";
import { settleCircleSourceUsage, type CircleSourceUsage } from "./circle-v2-source-usage.js";
import { circleSolanaDelivery, type CircleSolanaDeliveryReader, type CircleSolanaDeliveryView } from "./circle-v2-solana-delivery.js";

export const CIRCLE_SOURCE_PROOF_SCHEMA = "apn.circle-v2-source-proof.v1";
/** The Base receipt of a CCTP V2 source burn, read once at the finalized tag (no archive state). */
export interface CircleSourceProof {
  readonly schemaVersion: typeof CIRCLE_SOURCE_PROOF_SCHEMA; readonly operationId: string; readonly profileHash: string;
  readonly chainId: 8453; readonly payer: string; readonly to: string; readonly transactionHash: string; readonly nonceAtomic: string;
  readonly status: "success" | "reverted"; readonly blockNumberAtomic: string; readonly blockHash: string;
  readonly blockTag: "finalized"; readonly finalizedBlockNumberAtomic: string; readonly observedAt: string; readonly integrityHash: string;
}
const PROOF_KEYS = ["blockHash", "blockNumberAtomic", "blockTag", "chainId", "finalizedBlockNumberAtomic", "integrityHash", "nonceAtomic",
  "observedAt", "operationId", "payer", "profileHash", "schemaVersion", "status", "to", "transactionHash"];
const UINT = /^(?:0|[1-9][0-9]*)$/u, WORD = /^0x[0-9a-f]{64}$/u;

/**
 * `non-evm-source-journals/<profileHash>/<operationId>.source-proof.json` beside the journal (never a record name, so the
 * operation index walk skips it). Create-only and bound to the journal's own burn (hash, nonce, payer, target): the
 * journal is never rewritten, and the index re-derives the operation as terminal from it after `rm -r operation-index`.
 */
export class CircleSourceProofStore extends SecureStateStore {
  private path(journal: NonEvmSourceJournal): string {
    stateIdentifier(journal.profileHash, "Circle source proof profile"); stateIdentifier(journal.operationId, "Circle source proof operation");
    return `non-evm-source-journals/${journal.profileHash}/${journal.operationId}.source-proof.json`;
  }
  async load(journal: NonEvmSourceJournal): Promise<CircleSourceProof | null> {
    const value = await this.readJson(this.path(journal));
    return value === null ? null : validateProof(value, journal);
  }
  /** Publishes the proof once; a concurrent observer's file wins and is returned after the same validation. */
  async create(journal: NonEvmSourceJournal, proof: CircleSourceProof): Promise<CircleSourceProof> {
    validateProof(proof, journal);
    try { await this.writeJson(this.path(journal), proof, true); }
    catch (error) {
      if (!(error instanceof ApnError) || error.message !== "State target is already occupied.") throw error;
      const existing = await this.load(journal);
      if (existing === null) throw error;
      return existing;
    }
    return proof;
  }
}

/** The payer's claim ends with the signing window, or earlier once the burn's finalized receipt is recorded (read only then). */
export function circleSourceTerminal(root: string, journal: NonEvmSourceJournal): boolean | Promise<boolean> {
  if (pastUnstartedDeadline(Date.parse(journal.createdAt) + CIRCLE_V2_SOURCE_TTL_MS)) return true;
  if (typeof journal.transactionHash !== "string") return false;
  return new CircleSourceProofStore(root).load(journal).then(proof => proof !== null);
}

export interface CircleSourceStatus {
  readonly schemaVersion: "apn.circle-v2-source-status.v1"; readonly operationId: string;
  /** The journal's phase until the burn's finalized receipt is recorded; then `source_reverted`, `source_finalized` or `delivered`. */
  readonly phase: string;
  readonly outcome: CircleSourceProof["status"] | null; readonly sourceProof: CircleSourceProof | null; readonly waitingFor: string | null;
  readonly journal: NonEvmSourceJournal; readonly proofClass: string; readonly nextActions: readonly string[];
  /** Once nothing of the operation can still spend it: the payer's allowance left on the wrapper, stored with its block. */
  readonly residualAllowance?: CircleResidualView;
  /** The payer's Base USDC daily-cap hold of this burn, settled from the recorded receipt (circle-v2-source-usage.ts). */
  readonly sourceUsage?: CircleSourceUsage;
  /** For a successful burn: its receipt on Solana, or what that receipt still waits for (circle-v2-solana-delivery.ts). */
  readonly delivery?: Pick<CircleSolanaDeliveryView, "state" | "forwardState" | "proof" | "unreadReason">;
}
const REVOKE = "apn circle approval revoke --profile <profile> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> " +
  "--max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei>";

/**
 * `operation status` of a Circle CCTP V2 Base source burn: the saved journal and, when its burn transaction is known,
 * that transaction's receipt at the finalized tag (chain id, receipt, finalized head; no archive read). A receipt in a
 * finalized block is recorded once as the operation's proof and settles the payer's daily-cap hold of the burn;
 * otherwise nothing is written and the status says why.
 * Once nothing of the operation can still spend the payer's wrapper allowance, its residual is read once, at that same
 * finalized head, and stored (circle-v2-residual-allowance.ts); later statuses read no chain unless `refreshAllowance`.
 * A successful burn's delivery on Solana is read on every status until its receipt is recorded, then never again; a failed
 * delivery read is shown as `delivery.state: "unread"` with its reason, and the rest of the status still answers.
 */
export async function circleSourceStatus(root: string, journal: NonEvmSourceJournal, read: FinalizedReader | undefined,
  now: () => number, refreshAllowance = false, deliveryReader?: CircleSolanaDeliveryReader): Promise<CircleSourceStatus> {
  const residual = async (proven?: FinalizedChainRead, head?: CircleResidualBlock) =>
    await circleResidualAllowance(root, journal, read, refreshAllowance, now, proven, head);
  const statusAction = `apn operation status --operation ${journal.operationId}`;
  const view = (proof: CircleSourceProof | null, waitingFor: string | null, proofClass: string,
    left?: CircleResidualView, usage?: CircleSourceUsage | null, delivery?: CircleSolanaDeliveryView): CircleSourceStatus => ({
    schemaVersion: "apn.circle-v2-source-status.v1", operationId: journal.operationId,
    phase: proof === null ? journal.phase : proof.status === "reverted" ? "source_reverted" : delivery?.state === "delivered" ? "delivered" : "source_finalized",
    outcome: proof?.status ?? null, sourceProof: proof, waitingFor, journal, proofClass, ...(left === undefined ? {} : { residualAllowance: left }),
    ...(usage === undefined || usage === null ? {} : { sourceUsage: usage }),
    ...(delivery === undefined ? {} : { delivery: { state: delivery.state, forwardState: delivery.forwardState, proof: delivery.proof,
      ...(delivery.unreadReason === undefined ? {} : { unreadReason: delivery.unreadReason }) } }),
    nextActions: [...delivery?.nextActions ?? [],
      ...waitingFor !== null && journal.transactionHash !== null ? [statusAction] : [],
      ...left !== undefined && left.allowanceAtomic !== null && left.allowanceAtomic !== "0" ? [REVOKE] : []] });
  const recordedView = async (proof: CircleSourceProof, proofClass: string, left: CircleResidualView, usage: CircleSourceUsage | null) => {
    if (proof.status === "reverted") return view(proof, null, proofClass, left, usage);
    const delivery = await circleSolanaDelivery(root, journal, proof, deliveryReader, read, now);
    return view(proof, delivery.waitingFor, delivery.recorded ? "chain_verified_public_read" : proofClass, left, usage, delivery);
  };
  const hash = journal.transactionHash, store = new CircleSourceProofStore(root);
  if (hash === null) {
    const waiting = "no burn transaction was signed; nothing of this operation can land";
    return circleSourceTerminal(root, journal) === true
      ? view(null, waiting, "durable_public_state", await residual()) : view(null, waiting, "durable_public_state");
  }
  const existing = await store.load(journal);
  // Every status of a recorded burn settles its hold, so a write interrupted after the proof is completed on the next one.
  const settled = async (proof: CircleSourceProof) => await settleCircleSourceUsage(root, journal, proof, new Date(now()));
  if (existing !== null) return await recordedView(existing, "durable_public_state", await residual(), await settled(existing));
  if (read === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "This runtime has no finalized-tag reader for the Base receipt.");
  const rpc = read(8453);
  await assertFinalizedChain(rpc, 8453);
  const raw = await rpc.call("eth_getTransactionReceipt", [hash]);
  if (raw === null) return view(null, `the burn transaction ${hash} to have a receipt`, "chain_verified_public_read");
  const receipt = receiptOf(raw, journal), head = finalizedBlock(await rpc.call("eth_getBlockByNumber", ["finalized", false]));
  const finalized = BigInt(head.numberAtomic);
  if (receipt.blockNumber > finalized) {
    return view(null, `the burn receipt in block ${receipt.blockNumber} to be finalized (the finalized block is ${finalized})`, "chain_verified_public_read");
  }
  const fields: Omit<CircleSourceProof, "integrityHash"> = { schemaVersion: CIRCLE_SOURCE_PROOF_SCHEMA, operationId: journal.operationId, profileHash: journal.profileHash, chainId: 8453 as const,
    payer: journal.sourceCall.from, to: journal.sourceCall.to, transactionHash: hash, nonceAtomic: journal.nonceAtomic!, status: receipt.status,
    blockNumberAtomic: receipt.blockNumber.toString(), blockHash: receipt.blockHash, blockTag: "finalized" as const,
    finalizedBlockNumberAtomic: finalized.toString(), observedAt: new Date(now()).toISOString() };
  const proof = await store.create(journal, Object.freeze({ ...fields, integrityHash: hashObject(fields) }));
  return await recordedView(proof, "chain_verified_public_read", await residual(rpc, head), await settled(proof));
}

/** The receipt must be the journal's own burn: same hash, sent by the payer to the pinned messenger, in a block. */
function receiptOf(value: unknown, journal: NonEvmSourceJournal): { readonly blockNumber: bigint; readonly blockHash: string; readonly status: CircleSourceProof["status"] } {
  if (!isPlainRecord(value) || typeof value.transactionHash !== "string" || value.transactionHash.toLowerCase() !== journal.transactionHash ||
    typeof value.from !== "string" || value.from.toLowerCase() !== journal.sourceCall.from.toLowerCase() ||
    typeof value.to !== "string" || value.to.toLowerCase() !== journal.sourceCall.to.toLowerCase() ||
    typeof value.blockHash !== "string" || !WORD.test(value.blockHash.toLowerCase()) || (value.status !== "0x1" && value.status !== "0x0")) {
    throw new ApnError("APN_RPC_PROTOCOL", "The RPC answered a receipt that is not this operation's burn.");
  }
  return { blockNumber: evmRpcQuantity(value.blockNumber), blockHash: value.blockHash.toLowerCase(), status: value.status === "0x1" ? "success" : "reverted" };
}

function proofCorrupt(): never {
  throw new ApnError("APN_STATE_CORRUPT", "The source proof of a Circle burn is not the one its journal allows.", { reason: "circle_source_proof_binding" });
}
function validateProof(value: unknown, journal: NonEvmSourceJournal): CircleSourceProof {
  if (!isPlainRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson(PROOF_KEYS)) proofCorrupt();
  const proof = value as unknown as CircleSourceProof, { integrityHash, ...fields } = proof;
  if (proof.schemaVersion !== CIRCLE_SOURCE_PROOF_SCHEMA || hashObject(fields) !== integrityHash || proof.operationId !== journal.operationId ||
    proof.profileHash !== journal.profileHash || proof.chainId !== 8453 || proof.payer !== journal.sourceCall.from || proof.to !== journal.sourceCall.to ||
    proof.transactionHash !== journal.transactionHash || proof.nonceAtomic !== journal.nonceAtomic || !["success", "reverted"].includes(proof.status) ||
    !UINT.test(proof.blockNumberAtomic) || !UINT.test(proof.finalizedBlockNumberAtomic) ||
    BigInt(proof.blockNumberAtomic) > BigInt(proof.finalizedBlockNumberAtomic) || !WORD.test(proof.blockHash) || proof.blockTag !== "finalized" ||
    typeof proof.observedAt !== "string" || !Number.isFinite(Date.parse(proof.observedAt)) ||
    new Date(Date.parse(proof.observedAt)).toISOString() !== proof.observedAt) proofCorrupt();
  return Object.freeze(proof);
}
