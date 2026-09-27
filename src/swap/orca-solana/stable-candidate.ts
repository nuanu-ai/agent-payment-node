import { getTokenDecoder } from "@solana-program/token";
import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { SOLANA_USDT } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import { rpcArray, rpcAtomic, rpcRecord, type SolanaRpcPort, SolanaRpc } from "../../solana/rpc.js";
import { readRawAccounts, rawAccount, type RawSolanaAccount } from "./accounts.js";
import { ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, type OrcaProgramPinVerifier, verifyOrcaProgramPins } from "./pins.js";
import { admitOrcaStableOwner, assertOrcaStableQuoteAdmission, recheckOrcaStableOwner, type OrcaStableAdmissionPorts } from "./stable-admission.js";
import { ORCA_PROTOCOL_REGISTRY, ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { validateOrcaStableUnsigned } from "./stable-prepare.js";
import { readOrcaStableSnapshotCore, type OrcaStableSnapshotRequest } from "./stable-snapshot.js";
import { blockhashHex } from "./material.js";
import { GuardedSwapService } from "../service.js";
import { createSwapQuote } from "../quote.js";
import { proveOrcaStableSimulationTransfers } from "./stable-effects.js";

const MAX_SLOT_DRIFT = 150n;
const MIN_BASE_FEE = 5_000n;
const MIN_REMAINING_BLOCKS = 12n;
const MAX_PREPARATION_AGE_MS = 30_000;
export const ORCA_STABLE_CANDIDATE_SCHEMA = "apn.orca-stable-guarded-candidate.v1" as const;

export interface OrcaStableCandidateRequest extends OrcaStableSnapshotRequest {
  readonly profile: string; readonly policyRevision: number; readonly idempotencyKey: string;
}
export type OrcaStableSimulationRequest = Omit<OrcaStableCandidateRequest, "idempotencyKey">;
export const ORCA_STABLE_SIMULATION_SCHEMA = "apn.orca-stable-guarded-simulation.v1" as const;

function assertFreshBoundedRpc(rpc: SolanaRpc): void {
  if (rpc.budget === undefined || rpc.budget.physicalRequests !== 0 || rpc.budget.maxPhysicalRequests > 24 ||
      rpc.budget.minimumIntervalMs < 750 || !rpc.hasPersistentPacer) {
    throw new ApnError("APN_RPC_CONFIG", "Stable simulation requires a fresh 24 POST budget and persistent 750 ms pacing.");
  }
}

/** Current-owner proof only. It reads active policy, accounts and RPC; it never creates an operation or exposes transaction bytes. */
export async function simulateOrcaStableGuardedReadOnly(rpc: SolanaRpc, ports: OrcaStableAdmissionPorts,
  request: OrcaStableSimulationRequest) {
  assertFreshBoundedRpc(rpc);
  return await simulateOrcaStableGuardedCore(rpc, ports, request, verifyOrcaProgramPins, () => new Date());
}

/** A bounded production entry: all RPC reads, fee pricing and simulation precede the first operation write.
 * GuardedSwapService can retain a recoverable quoted/prepared record if a later transition fails. */
export async function prepareOrcaStableGuardedCandidate(rpc: SolanaRpc, ports: OrcaStableAdmissionPorts,
  service: GuardedSwapService, request: OrcaStableCandidateRequest) {
  assertFreshBoundedRpc(rpc);
  return await prepareOrcaStableGuardedCandidateCore(rpc, ports, service, request, verifyOrcaProgramPins, () => new Date());
}

/** Injectable pin verifier permits deterministic fake-RPC tests; production always uses the pinned verifier. */
export async function prepareOrcaStableGuardedCandidateCore(rpc: SolanaRpcPort, ports: OrcaStableAdmissionPorts,
  service: GuardedSwapService, request: OrcaStableCandidateRequest, verifyPins: OrcaProgramPinVerifier,
  clock: () => Date) {
  const proof = await proveOrcaStableGuardedCore(rpc, ports, request, verifyPins, clock);
  const operation = await service.prepare({ quote: proof.quoteInput, assetPolicy: proof.active.registry,
    protocolRegistry: ORCA_PROTOCOL_REGISTRY, idempotencyKey: request.idempotencyKey,
    approvalCapAtomic: "0", now: proof.commitNow });
  return { schemaVersion: ORCA_STABLE_CANDIDATE_SCHEMA, quote: proof.boundQuote, operation,
    evidence: proof.evidence, unsignedTransaction: proof.unsignedTransaction,
    signed: false as const, broadcast: false as const };
}

/** Injectable read-only proof for fake transport tests. No service or repository is reachable from this path. */
export async function simulateOrcaStableGuardedCore(rpc: SolanaRpcPort, ports: OrcaStableAdmissionPorts,
  request: OrcaStableSimulationRequest, verifyPins: OrcaProgramPinVerifier, clock: () => Date) {
  const proof = await proveOrcaStableGuardedCore(rpc, ports, request, verifyPins, clock);
  return { schemaVersion: ORCA_STABLE_SIMULATION_SCHEMA, mode: "read_only" as const,
    quote: proof.boundQuote, evidence: proof.evidence, signable: false as const,
    executable: false as const, signed: false as const, broadcast: false as const };
}

async function proveOrcaStableGuardedCore(rpc: SolanaRpcPort, ports: OrcaStableAdmissionPorts,
  request: OrcaStableSimulationRequest, verifyPins: OrcaProgramPinVerifier, clock: () => Date) {
  const initialNow = trustedNow(clock);
  const initial = await admitOrcaStableOwner(ports, { profile: request.profile, owner: request.owner,
    policyRevision: request.policyRevision, amountInAtomic: request.amountAtomic,
    minimumOutputAtomic: "1", now: initialNow }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
  const observed = await readOrcaStableSnapshotCore(rpc, request, verifyPins);
  const { preview, quote } = observed;
  await validateOrcaStableUnsigned(preview);
  if (preview.createUsdtAta) blocked("Guarded ATA creation needs an exact CPI setup whitelist.", "orca_stable_ata_trace_unsupported");
  // The actual minimum is known only after reading the pool; enforce its cap under the exact active policy.
  const admission = await admitOrcaStableOwner(ports, { profile: request.profile, owner: request.owner,
    policyRevision: request.policyRevision, amountInAtomic: request.amountAtomic,
    minimumOutputAtomic: quote.minimumOutputAtomic, now: trustedNow(clock) }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
  if (admission.policyDigest !== initial.policyDigest || admission.activationDigest !== initial.activationDigest) {
    blocked("Stable owner policy changed while reading the pool.", "orca_stable_policy_drift");
  }
  assertOrcaStableQuoteAdmission(admission, quote);
  const beforeRead = await readRawAccounts(rpc, [request.owner, preview.sourceAta, preview.destinationAta], 165);
  if (beforeRead.slot > BigInt(Number.MAX_SAFE_INTEGER) || beforeRead.slot < BigInt(preview.marketSlot) ||
      beforeRead.slot - BigInt(preview.marketSlot) > MAX_SLOT_DRIFT) {
    blocked("Owner balances are outside the market slot bound.", "orca_stable_slot_drift");
  }
  const [owner = null, source = null, destination = null] = beforeRead.accounts;
  if (owner === null || owner.owner !== SYSTEM_PROGRAM || owner.executable || owner.data.length !== 0) {
    blocked("Owner system account changed.", "orca_stable_owner");
  }
  const sourceBalance = tokenAmount(source ?? null, request.owner, USDC_MINT);
  tokenAmount(destination, request.owner, SOLANA_USDT);
  if (sourceBalance < BigInt(request.amountAtomic)) {
    blocked("Owner token accounts changed after the snapshot.", "orca_stable_ata_state");
  }
  const feeValue = rpcRecord(await rpc.call("getFeeForMessage", [preview.messageBase64, { commitment: "confirmed",
    minContextSlot: Number(beforeRead.slot) }])).value;
  if (feeValue === null) throw new ApnError("APN_REPREPARE_REQUIRED", "The stable candidate blockhash expired before pricing.");
  const fee = rpcAtomic(feeValue), rent = BigInt(preview.ataRentLamports);
  const priority = BigInt(preview.maximumPriorityFeeLamports);
  if (fee < MIN_BASE_FEE + priority || fee + rent > BigInt(request.maximumTotalFeeLamports) || owner.lamports < fee + rent) {
    blocked("Exact network fee or rent exceeds owner funds or cap.", "orca_stable_fee_cap");
  }
  const params = [preview.unsignedPayload, { sigVerify: false, replaceRecentBlockhash: false,
    commitment: "confirmed", encoding: "base64", minContextSlot: Number(beforeRead.slot), innerInstructions: true,
    accounts: { encoding: "base64", addresses: [request.owner, preview.sourceAta, preview.destinationAta] } }] as const;
  const response = rpcRecord(await rpc.call("simulateTransaction", params));
  const simulationSlot = rpcAtomic(rpcRecord(response.context).slot), simulation = rpcRecord(response.value);
  if (simulation.err !== null) blocked("Exact stable transaction simulation failed.", "orca_stable_simulation_failed");
  const units = rpcAtomic(simulation.unitsConsumed);
  if (units === 0n || units > BigInt(request.computeUnitLimit) || simulationSlot > BigInt(Number.MAX_SAFE_INTEGER) ||
      simulationSlot < beforeRead.slot || simulationSlot - BigInt(preview.marketSlot) > MAX_SLOT_DRIFT) {
    blocked("Stable simulation compute units, accounts, or slot are invalid.", "orca_stable_simulation_invalid");
  }
  const transfers = proveOrcaStableSimulationTransfers(simulation.innerInstructions, preview, request.owner,
    quote.amountInAtomic, quote.minimumOutputAtomic);
  // Same simulation result confirms post-state account identities. Amount effects come only from the CPI trace.
  const postAccounts = rpcArray(simulation.accounts, 3);
  if (postAccounts.length !== 3 || postAccounts.some((account) => account === null)) {
    blocked("Stable simulation omitted owner token account identities.", "orca_stable_simulation_invalid");
  }
  const ownerPost = rawAccount(postAccounts[0], 0);
  const sourcePost = rawAccount(postAccounts[1], 165);
  const destinationPost = rawAccount(postAccounts[2], 165);
  if (ownerPost.owner !== SYSTEM_PROGRAM || ownerPost.executable || ownerPost.data.length !== 0) {
    blocked("Stable simulation owner account identity changed.", "orca_stable_simulation_invalid");
  }
  const sourcePostAmount = tokenAmount(sourcePost, request.owner, USDC_MINT);
  const destinationPostAmount = tokenAmount(destinationPost, request.owner, SOLANA_USDT);
  const policyNow = trustedNow(clock);
  await recheckOrcaStableOwner(ports, admission, policyNow);
  const active = await ports.activePolicy(request.profile);
  if (active === null || active.revision !== admission.policyRevision || active.digest !== admission.policyDigest ||
      active.activationDigest !== admission.activationDigest) blocked("Owner policy changed before preparation.", "orca_stable_policy_drift");
  const simulationResult = { slot: simulationSlot.toString(), unitsConsumed: units.toString(),
    ...transfers, postAccountDataSha256: { owner: sha256(ownerPost.data), source: sha256(sourcePost.data),
      destination: sha256(destinationPost.data) }, ownerLamportsAfter: ownerPost.lamports.toString(),
    sourceAtomicAfter: sourcePostAmount.toString(), destinationAtomicAfter: destinationPostAmount.toString() };
  const evidence = { schemaVersion: ORCA_STABLE_CANDIDATE_SCHEMA, marketSlot: preview.marketSlot,
    beforeSlot: beforeRead.slot.toString(), simulation: simulationResult, sourceAta: preview.sourceAta,
    destinationAta: preview.destinationAta, pool: quote.pool, program: quote.program, blockhash: preview.blockhash,
    lastValidBlockHeight: preview.lastValidBlockHeight, messageHash: preview.messageHash,
    unsignedPayloadHash: sha256(preview.unsignedPayload), actualFeeLamports: fee.toString(), rentLamports: rent.toString(),
    policyDigest: admission.policyDigest, policyRevision: admission.policyRevision,
    activationDigest: admission.activationDigest, mechanismDigest: admission.mechanismDigest,
    ownerUsage: { source: await ports.dailyUsage(request.owner, USDC_MINT, policyNow),
      destination: await ports.dailyUsage(request.owner, SOLANA_USDT, policyNow) } };
  // Usage may change between read and write: recheck after material assembly as the final read barrier.
  await recheckOrcaStableOwner(ports, admission, policyNow);
  const usageAfter = { source: await ports.dailyUsage(request.owner, USDC_MINT, policyNow),
    destination: await ports.dailyUsage(request.owner, SOLANA_USDT, policyNow) };
  if (canonicalJson(usageAfter) !== canonicalJson(evidence.ownerUsage)) {
    blocked("Owner daily usage changed before preparation.", "orca_stable_usage_drift");
  }
  // All policy/usage reads are complete. Observe height last, then take a fresh trusted clock before persistence.
  const currentHeight = rpcAtomic(await rpc.call("getBlockHeight", [{ commitment: "confirmed", minContextSlot: Number(simulationSlot) }]));
  const commitNow = trustedNow(clock);
  if (commitNow.getTime() < initialNow.getTime() || commitNow.getTime() - initialNow.getTime() > MAX_PREPARATION_AGE_MS ||
      commitNow.toISOString().slice(0, 10) !== policyNow.toISOString().slice(0, 10) ||
      commitNow.getTime() - policyNow.getTime() > 5_000 ||
      currentHeight + MIN_REMAINING_BLOCKS >= BigInt(preview.lastValidBlockHeight)) {
    throw new ApnError("APN_REPREPARE_REQUIRED", "Stable candidate clock or blockhash freshness expired before persistence.");
  }
  const now = commitNow.toISOString();
  const quoteInput = { profile: request.profile, account: request.owner, recipient: request.owner,
    sourceAsset: { chain: ORCA_SOLANA_CHAIN, kind: "token" as const, identifier: USDC_MINT },
    destinationAsset: { chain: ORCA_SOLANA_CHAIN, kind: "token" as const, identifier: SOLANA_USDT },
    inputAmountAtomic: quote.amountInAtomic, expectedOutputAtomic: quote.expectedOutputAtomic,
    minimumOutputAtomic: quote.minimumOutputAtomic, slippageBps: quote.slippageBps, effectiveAt: now,
    expiresAt: new Date(commitNow.getTime() + 60_000).toISOString(),
    providerResponseHash: domainHash("apn.orca-stable-candidate-evidence.v1", canonicalJson(evidence)),
    routeHash: domainHash("apn.orca-stable-candidate-route.v1", canonicalJson({ pool: quote.pool, program: quote.program,
      sourceAta: preview.sourceAta, destinationAta: preview.destinationAta, messageHash: preview.messageHash })),
    unsignedTransactionPayloadHash: sha256(preview.unsignedPayload),
    simulation: { requestHash: domainHash("apn.orca-stable-candidate-simulation-request.v1", canonicalJson(params)),
      resultHash: domainHash("apn.orca-stable-candidate-simulation-result.v1", canonicalJson(simulationResult)),
      success: true as const, blockNumber: preview.marketSlot, blockHash: blockhashHex(preview.blockhash),
      headBlockNumber: simulationSlot.toString(), maxHeadDrift: Number(MAX_SLOT_DRIFT), gasEstimate: units.toString() } };
  const boundQuote = createSwapQuote(quoteInput);
  return { quoteInput, active, commitNow, boundQuote, evidence,
    unsignedTransaction: { payloadBase64: preview.unsignedPayload, messageHash: preview.messageHash,
      blockhash: preview.blockhash, lastValidBlockHeight: preview.lastValidBlockHeight } };
}

function tokenAmount(account: RawSolanaAccount | null, owner: string, mint: string): bigint {
  if (account === null || account.owner !== TOKEN_PROGRAM || account.executable || account.data.length !== 165) {
    blocked("Stable token account is malformed.", "orca_stable_ata_state");
  }
  const token = getTokenDecoder().decode(account.data);
  if (token.owner !== owner || token.mint !== mint || token.state !== 1 || token.isNative.__option !== "None" ||
      token.delegate.__option !== "None" || token.closeAuthority.__option !== "None") {
    blocked("Stable token account identity changed.", "orca_stable_ata_state");
  }
  return token.amount;
}
function trustedNow(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ApnError("APN_INVALID_INPUT", "Stable candidate clock is invalid.");
  return value;
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
