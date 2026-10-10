import { decodeEventLog, encodeEventTopics, erc20Abi, getAddress, serializeTransaction, type Hex } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import type { StateStore } from "../state.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { listLocalWallets } from "../wallet-import-collision.js";
import { CIRCLE_RECIPIENT, CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { CircleEffectStore, verifyCircleMaterial } from "./custody.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
import { circleHex, circleRecord, circleUint, decodeCircleDestination, circleAttesterConfigurationHash, verifyCircleAttestationSigners, type CircleObservation, type CircleReceiptProof } from "./protocol.js";
import { circleExternalHeader, circleExternalTransaction, decodeCircleExternalDestination } from "./external-proof.js";
import { readCircleAttesters, readCircleDeployment, type CircleRpc } from "./rpc.js";
import { verifyCircleDeployments, type CircleDeploymentSnapshot } from "./preflight.js";
import { readCircleMintFeeRecipient } from "./mint-fee-recipient.js";
import { HISTORICAL_LINEA_OPERATION, HISTORICAL_MONAD_OPERATION, type HistoricalPaidSourceEvidence } from "./historical-paid-source.js";
const LINEA_MINT = "0x014921c17c1f86407f2cb92b8f62169e76144ff08a18a7d3068b078194947a45";
export const HISTORICAL_MONAD_MINT = "0xa960a09b6abb91ab9cc8c847d5846266cb84b83d617e162b052c60640a28a961";
function tag(b: Record<string, unknown>) { return { blockHash: circleHex(b.hash, 32), requireCanonical: true as const }; }
function publicLog(l: Record<string, unknown>) { return { address: getAddress(String(l.address)), topics: l.topics, data: circleHex(l.data), blockHash: circleHex(l.blockHash, 32), blockNumber: circleUint(l.blockNumber).toString(), transactionHash: circleHex(l.transactionHash, 32), transactionIndex: circleUint(l.transactionIndex).toString(), logIndex: circleUint(l.logIndex).toString(), removed: l.removed }; }
async function reanchor(rpc: CircleRpc, b: Record<string, unknown>) { const fresh = await rpc.block(String(b.number)); if (circleExternalHeader(fresh) !== circleExternalHeader(b) || circleUint(fresh.number) !== circleUint(b.number) || circleUint(fresh.timestamp) !== circleUint(b.timestamp)) circleBlocked("historical_paid_destination_reanchor"); }
export interface HistoricalPaidDestinationEvidence {
  readonly kind: "owned_linea" | "external_monad"; readonly receipt: CircleReceiptProof; readonly observation: CircleObservation;
  readonly historicalDeployment: CircleDeploymentSnapshot; readonly currentDeployment: CircleDeploymentSnapshot; readonly sourceCurrentDeployment: CircleDeploymentSnapshot;
  readonly caller: string; readonly parentHash: Hex; readonly parentNumberAtomic: string; readonly beforeAtomic: string; readonly afterAtomic: string;
  readonly historicalDeploymentDigest: string; readonly signedMaterialHash: string | null; readonly rawTransactionBinding: string; readonly timestampDerived: boolean;
}
/** Called only within the private coordinator's fresh proof pipeline; never consumes supplied destination JSON. */
export async function verifyHistoricalPaidDestination(state: StateStore, op: CircleOperationV1, sourceEvidence: HistoricalPaidSourceEvidence, source: CircleRpc, destination: CircleRpc): Promise<HistoricalPaidDestinationEvidence> {
  const owned = op.operationId === HISTORICAL_LINEA_OPERATION, external = op.operationId === HISTORICAL_MONAD_OPERATION;
  if ((!owned && !external) || op.attestation === null || destination.chainId !== op.destinationChain) circleBlocked("historical_paid_destination_exact_route");
  await assertEvmNativeCustody(state, op.profile, op.sourceCustody); await assertEvmNativeCustody(state, op.destinationProfile, op.destinationCustody);
  const txHash = owned ? LINEA_MINT : HISTORICAL_MONAD_MINT, original = await destination.observation(txHash, "safe"); if (original === null) circleBlocked("historical_paid_destination_unresolved");
  const t = circleRecord(original.transaction), r = circleRecord(original.receipt), block = circleRecord(original.canonicalBlock), head = circleRecord(original.finalityHead), check = circleRecord(original.recheckedBlock), index = circleUint(t.transactionIndex), signed = await circleExternalTransaction(t);
  for (const b of [block, check, head]) circleExternalHeader(b);
  if (signed.hash !== txHash || circleHex(r.transactionHash, 32) !== txHash || circleHex(t.blockHash, 32) !== circleHex(block.hash, 32) || circleHex(r.blockHash, 32) !== circleHex(block.hash, 32) || circleUint(t.blockNumber) !== circleUint(block.number) || circleUint(r.blockNumber) !== circleUint(block.number) || circleUint(r.transactionIndex) !== index || !Array.isArray(block.transactions) || block.transactions[Number(index)] !== txHash || block.transactions.filter(x => x === txHash).length !== 1 || circleExternalHeader(check) !== circleExternalHeader(block) || circleUint(check.timestamp) !== circleUint(block.timestamp) || circleUint(head.number) < circleUint(block.number) || circleUint(head.timestamp) < circleUint(block.timestamp)) circleBlocked("historical_paid_destination_membership");
  await reanchor(destination, block); await reanchor(destination, head);
  let observation = original, signedMaterialHash: string | null = null, timestampDerived = false;
  if (owned) {
    const effect = op.effects.find(e => e.role === "mint"); if (effect === undefined || effect.phase !== "confirmed" || effect.transactionHash !== txHash || effect.materialHash === null || effect.proof === null || effect.proof.finalityTag !== "safe") circleBlocked("historical_paid_owned_mint_required");
    for (const suffix of ["signing_fence", "material_sealed", "submission_fence"]) if (!op.transitions.some(x => x.reason === `mint_${suffix}`)) circleBlocked("historical_paid_owned_mint_fence");
    await new CircleEffectStore(state.root, { load: async () => { circleBlocked("historical_paid_private_forbidden"); }, create: async () => { circleBlocked("historical_paid_private_forbidden"); } }).historicalPaidHeaders(op, true);
    const rawTransaction = serializeTransaction({ type: "eip1559", chainId: destination.chainId, nonce: Number(circleUint(t.nonce)), to: getAddress(String(t.to)), data: circleHex(t.input), value: circleUint(t.value), gas: circleUint(t.gas), maxFeePerGas: circleUint(t.maxFeePerGas), maxPriorityFeePerGas: circleUint(t.maxPriorityFeePerGas), accessList: [] }, { r: circleHex(t.r, 32), s: circleHex(t.s, 32), yParity: Number(circleUint(t.yParity ?? t.v)) });
    const body = { schemaVersion: "apn.circle-v2-evm-effect.v1" as const, operationId: op.operationId, role: effect.role, fingerprint: op.fingerprint, envelopeHash: effect.envelope.envelopeHash, rawTransaction, transactionHash: signed.hash };
    signedMaterialHash = hashObject(body); await verifyCircleMaterial(op, effect, { ...body, materialHash: signedMaterialHash });
    if (circleUint(block.number) !== 32272295n || circleUint(block.timestamp) !== 0x6ac887a6n || Object.hasOwn(t, "blockTimestamp") && (typeof t.blockTimestamp !== "string" || circleUint(t.blockTimestamp) !== circleUint(block.timestamp))) circleBlocked("historical_paid_owned_timestamp");
    timestampDerived = !Object.hasOwn(t, "blockTimestamp"); observation = timestampDerived ? { ...original, transaction: { ...t, blockTimestamp: block.timestamp } } : original;
    if (hashObject(observation.transaction) !== effect.proof.transactionHashBinding) circleBlocked("historical_paid_owned_full_binding");
  } else {
    if (op.effects.some(e => ["mint", "cleanup"].includes(e.role) && (e.phase !== "prepared" || e.transactionHash !== null || e.materialHash !== null || e.proof !== null)) || op.transitions.some(x => /^(mint|cleanup)_(signing|submission|material|submitted|fenced)/u.test(x.reason))) circleBlocked("historical_paid_external_private_entry");
    await new CircleEffectStore(state.root, { load: async () => { circleBlocked("historical_paid_private_forbidden"); }, create: async () => { circleBlocked("historical_paid_private_forbidden"); } }).assertExternalAbsent(op);
    for (const entry of await state.walletImportEntries()) if (entry.isFile() && !entry.isSymbolicLink() && /^[a-z0-9][a-z0-9._-]{0,63}\.json$/u.test(entry.name)) { const wallet = await state.loadWallet(state.profileHash(entry.name.slice(0, -5))); if (wallet === null) circleBlocked("external_public_wallet_identity_incomplete"); }
    for (const wallet of await listLocalWallets(state)) if (wallet.address.toLowerCase() === signed.caller.toLowerCase()) circleBlocked("historical_paid_external_controlled");
    for (const entry of await state.profileImportEntries()) { if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) circleBlocked("external_profile_directory"); const profile = await state.loadProviderProfile(entry.name); if (profile === null) circleBlocked("external_profile_disappeared"); if (profile.public_address.toLowerCase() === signed.caller.toLowerCase()) circleBlocked("historical_paid_external_controlled"); }
  }
  const sourceHead = await source.block("0x" + BigInt(sourceEvidence.finalityBlock.numberAtomic).toString(16));
  if (circleHex(sourceHead.hash, 32) !== sourceEvidence.finalityBlock.hash || circleUint(sourceHead.number).toString() !== sourceEvidence.finalityBlock.numberAtomic || circleUint(sourceHead.timestamp).toString() !== sourceEvidence.finalityBlock.timestampAtomic) circleBlocked("historical_paid_current_source_head");
  const sourceCurrentDeployment = await readCircleDeployment(source, op.destinationChain, sourceHead), historicalDeployment = await readCircleDeployment(destination, op.destinationChain, block), currentDeployment = await readCircleDeployment(destination, op.destinationChain, head);
  verifyCircleDeployments(sourceCurrentDeployment, currentDeployment); const historicalDeploymentDigest = verifyCircleDeployments(sourceCurrentDeployment, historicalDeployment);
  const attesters = await readCircleAttesters(destination, historicalDeploymentDigest, block), signers = await verifyCircleAttestationSigners(op.attestation, op.attestation.attestation, attesters);
  if (circleAttesterConfigurationHash(attesters) !== op.attestation.attesterConfigurationHash || hashObject(signers) !== hashObject(op.attestation.signers)) circleBlocked("historical_paid_frozen_attesters");
  const used = String(await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], tag(block))), feeRecipient = BigInt(op.attestation.feeExecutedAtomic) > 0n ? await readCircleMintFeeRecipient(destination, observation) : undefined;
  const proof = owned ? decodeCircleDestination(sourceEvidence.sourceProof, op.attestation, observation, used, op.destinationProfile, feeRecipient) : await decodeCircleExternalDestination({ ...op, source: sourceEvidence.sourceProof }, observation, used, feeRecipient);
  const saved = owned ? op.effects.find(e => e.role === "mint")!.proof! : op.externalFulfillment?.destinationReceipt;
  if (saved !== undefined && ["transactionHash", "blockHash", "blockNumberAtomic", "receiptHash", "logsHash", "transactionHashBinding", "actualFeeAtomic"].some(k => saved[k as keyof CircleReceiptProof] !== proof[k as keyof CircleReceiptProof])) circleBlocked("historical_paid_destination_saved_proof");
  if (saved !== undefined) { const oldHead = await destination.block("0x" + BigInt(saved.finalityBlockNumberAtomic).toString(16)); if (circleExternalHeader(oldHead) !== saved.finalityBlockHash || circleUint(oldHead.number).toString() !== saved.finalityBlockNumberAtomic || circleUint(oldHead.timestamp) < circleUint(block.timestamp)) circleBlocked("historical_paid_destination_frozen_head"); }
  const route = circleRoute(op.destinationChain, op.destinationProfile), parent = await destination.block("0x" + (circleUint(block.number) - 1n).toString(16)), parentHash = circleExternalHeader(parent);
  if (parentHash !== circleHex(block.parentHash, 32)) circleBlocked("historical_paid_destination_parent");
  const [before, after, logs] = await Promise.all([destination.read(route.token, "balanceOf", [CIRCLE_RECIPIENT], tag(parent)), destination.read(route.token, "balanceOf", [CIRCLE_RECIPIENT], tag(block)), destination.call("eth_getLogs", [{ address: route.token, blockHash: circleHex(block.hash, 32), topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer" }) }])]);
  if (circleUint(String(after)) - circleUint(String(before)) !== BigInt(op.attestation.receivedAtomic) || !Array.isArray(logs) || logs.length > 256) circleBlocked("historical_paid_destination_delta");
  const relevant = logs.map(circleRecord).filter(l => { if (getAddress(String(l.address)) !== route.token || circleHex(l.blockHash, 32) !== circleHex(block.hash, 32) || circleUint(l.blockNumber) !== circleUint(block.number) || l.removed !== false) circleBlocked("historical_paid_destination_block_logs"); const d = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: l.topics as [Hex, ...Hex[]], data: circleHex(l.data), strict: true }); return d.args.from === CIRCLE_RECIPIENT || d.args.to === CIRCLE_RECIPIENT; });
  const expected = (r.logs as unknown[]).map(circleRecord).find(l => { if (getAddress(String(l.address)) !== route.token || !Array.isArray(l.topics) || l.topics[0] !== encodeEventTopics({ abi: erc20Abi, eventName: "Transfer" })[0]) return false; return decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: l.topics as [Hex, ...Hex[]], data: circleHex(l.data), strict: true }).args.to === CIRCLE_RECIPIENT; });
  if (relevant.length !== 1 || expected === undefined || canonicalJson(publicLog(relevant[0]!)) !== canonicalJson(publicLog(expected))) circleBlocked("historical_paid_destination_delta_ambiguity");
  await reanchor(destination, block); await reanchor(destination, head); await reanchor(destination, parent); await reanchor(source, sourceHead);
  return { kind: owned ? "owned_linea" : "external_monad", receipt: saved ?? (owned ? proof : (({ caller: _caller, ...receipt }) => receipt)(proof as CircleReceiptProof & { caller: string })), observation, historicalDeployment, currentDeployment, sourceCurrentDeployment, caller: signed.caller, parentHash, parentNumberAtomic: circleUint(parent.number).toString(), beforeAtomic: String(before), afterAtomic: String(after), historicalDeploymentDigest, signedMaterialHash, rawTransactionBinding: hashObject(original.transaction), timestampDerived };
}
