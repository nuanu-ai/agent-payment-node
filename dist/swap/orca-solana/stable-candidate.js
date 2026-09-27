import { getTokenDecoder } from "@solana-program/token";
import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { SOLANA_USDT } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import { rpcArray, rpcAtomic, rpcRecord, SolanaRpc } from "../../solana/rpc.js";
import { readRawAccounts, rawAccount } from "./accounts.js";
import { ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, verifyOrcaProgramPins } from "./pins.js";
import { admitOrcaStableOwner, assertOrcaStableQuoteAdmission, recheckOrcaStableOwner } from "./stable-admission.js";
import { ORCA_PROTOCOL_REGISTRY, ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { validateOrcaStableUnsigned } from "./stable-prepare.js";
import { readOrcaStableSnapshotCore } from "./stable-snapshot.js";
import { blockhashHex } from "./material.js";
import { GuardedSwapService, preparedSwapOperationId, swapIdempotencyHash } from "../service.js";
import { createSwapQuote } from "../quote.js";
import { proveOrcaStableSimulationTransfers } from "./stable-effects.js";
import { SavedOrcaStableMaterialStore, sealOrcaStableMaterial } from "./stable-material.js";
const MAX_SLOT_DRIFT = 150n;
const MIN_BASE_FEE = 5000n;
const MIN_REMAINING_BLOCKS = 12n;
const MAX_PREPARATION_AGE_MS = 30_000;
export const ORCA_STABLE_CANDIDATE_SCHEMA = "apn.orca-stable-guarded-candidate.v1";
export const ORCA_STABLE_SIMULATION_SCHEMA = "apn.orca-stable-guarded-simulation.v1";
function assertFreshBoundedRpc(rpc) {
    if (rpc.budget === undefined || rpc.budget.physicalRequests !== 0 || rpc.budget.maxPhysicalRequests > 24 ||
        rpc.budget.minimumIntervalMs < 750 || !rpc.hasPersistentPacer) {
        throw new ApnError("APN_RPC_CONFIG", "Stable simulation requires a fresh 24 POST budget and persistent 750 ms pacing.");
    }
}
/** Current-owner proof only. It reads active policy, accounts and RPC; it never creates an operation or exposes transaction bytes. */
export async function simulateOrcaStableGuardedReadOnly(rpc, ports, request) {
    assertFreshBoundedRpc(rpc);
    return await simulateOrcaStableGuardedCore(rpc, ports, request, verifyOrcaProgramPins, () => new Date());
}
/** A bounded production entry: all RPC reads, fee pricing and simulation precede persistence.
 * Validated material is durable before the first operation write, so interrupted transitions can resume. */
export async function prepareOrcaStableGuardedCandidate(rpc, ports, service, request) {
    assertFreshBoundedRpc(rpc);
    return await prepareOrcaStableGuardedCandidateCore(rpc, ports, service, request, verifyOrcaProgramPins, () => new Date(), new SavedOrcaStableMaterialStore(service.operations.root));
}
/** Injectable pin verifier permits deterministic fake-RPC tests; production always uses the pinned verifier. */
export async function prepareOrcaStableGuardedCandidateCore(rpc, ports, service, request, verifyPins, clock, materialStore = new SavedOrcaStableMaterialStore(service.operations.root)) {
    const operationId = preparedSwapOperationId(request.profile, request.idempotencyKey);
    const requestDigest = domainHash("apn.orca-stable-candidate-request.v1", canonicalJson(request));
    const staged = await materialStore.loadStaged(operationId);
    if (staged !== null) {
        if (staged.requestDigest !== requestDigest)
            blocked("Stable idempotency identity belongs to different preparation input.", "orca_stable_idempotency_collision");
        const now = trustedNow(clock);
        if (now.toISOString() < staged.quote.effectiveAt || now.toISOString() >= staged.quote.expiresAt)
            throw new ApnError("APN_REPREPARE_REQUIRED", "Stored stable candidate has expired; use a new idempotency key.");
        const admission = await admitOrcaStableOwner(ports, { profile: request.profile, owner: request.owner,
            policyRevision: request.policyRevision, amountInAtomic: staged.quote.inputAmountAtomic,
            minimumOutputAtomic: staged.quote.minimumOutputAtomic, now }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
        if (admission.policyDigest !== staged.policyDigest || admission.activationDigest !== staged.activationDigest)
            blocked("Owner policy changed before stable candidate recovery.", "orca_stable_policy_drift");
        const active = await ports.activePolicy(request.profile);
        if (active === null || active.digest !== staged.policyDigest || active.revision !== staged.policyRevision ||
            active.activationDigest !== staged.activationDigest)
            blocked("Owner policy changed before stable candidate recovery.", "orca_stable_policy_drift");
        const { schemaVersion: _schema, profileHash: _profileHash, quoteHash: _quoteHash, ...quoteInput } = staged.quote;
        const operation = await service.prepare({ quote: quoteInput, assetPolicy: active.registry,
            protocolRegistry: ORCA_PROTOCOL_REGISTRY, idempotencyKey: request.idempotencyKey, approvalCapAtomic: "0", now });
        if (await materialStore.load(operation.operationId, operation) === null)
            throw new ApnError("APN_STATE_CORRUPT", "Stable Orca material disappeared during recovery.");
        return { schemaVersion: ORCA_STABLE_CANDIDATE_SCHEMA, quote: staged.quote, operation,
            evidence: staged.evidence,
            unsignedTransaction: { payloadBase64: staged.preview.unsignedPayload,
                messageHash: staged.preview.messageHash, blockhash: staged.preview.blockhash,
                lastValidBlockHeight: staged.preview.lastValidBlockHeight }, signed: false, broadcast: false };
    }
    const proof = await proveOrcaStableGuardedCore(rpc, ports, request, verifyPins, clock);
    await materialStore.save(await sealOrcaStableMaterial({ operationId,
        idempotencyHash: swapIdempotencyHash(request.idempotencyKey), requestDigest, quote: proof.boundQuote,
        policyRevision: request.policyRevision, policyDigest: proof.evidence.policyDigest,
        activationDigest: proof.evidence.activationDigest, evidence: proof.evidence, preview: proof.preview }, request.idempotencyKey));
    const operation = await service.prepare({ quote: proof.quoteInput, assetPolicy: proof.active.registry,
        protocolRegistry: ORCA_PROTOCOL_REGISTRY, idempotencyKey: request.idempotencyKey,
        approvalCapAtomic: "0", now: proof.commitNow });
    if (await materialStore.load(operation.operationId, operation) === null)
        throw new ApnError("APN_STATE_CORRUPT", "Stable Orca material disappeared during preparation.");
    return { schemaVersion: ORCA_STABLE_CANDIDATE_SCHEMA, quote: proof.boundQuote, operation,
        evidence: proof.evidence, unsignedTransaction: proof.unsignedTransaction,
        signed: false, broadcast: false };
}
/** Injectable read-only proof for fake transport tests. No service or repository is reachable from this path. */
export async function simulateOrcaStableGuardedCore(rpc, ports, request, verifyPins, clock) {
    const proof = await proveOrcaStableGuardedCore(rpc, ports, request, verifyPins, clock);
    return { schemaVersion: ORCA_STABLE_SIMULATION_SCHEMA, mode: "read_only",
        quote: proof.boundQuote, evidence: proof.evidence, signable: false,
        executable: false, signed: false, broadcast: false };
}
async function proveOrcaStableGuardedCore(rpc, ports, request, verifyPins, clock) {
    const initialNow = trustedNow(clock);
    const initial = await admitOrcaStableOwner(ports, { profile: request.profile, owner: request.owner,
        policyRevision: request.policyRevision, amountInAtomic: request.amountAtomic,
        minimumOutputAtomic: "1", now: initialNow }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
    const observed = await readOrcaStableSnapshotCore(rpc, request, verifyPins);
    const { preview, quote } = observed;
    await validateOrcaStableUnsigned(preview);
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
    if (preview.createUsdtAta ? destination !== null : destination === null) {
        blocked("Destination ATA presence changed after the snapshot.", "orca_stable_ata_state");
    }
    const destinationBalance = destination === null ? 0n : tokenAmount(destination, request.owner, SOLANA_USDT);
    if (sourceBalance < BigInt(request.amountAtomic)) {
        blocked("Owner token accounts changed after the snapshot.", "orca_stable_ata_state");
    }
    const feeValue = rpcRecord(await rpc.call("getFeeForMessage", [preview.messageBase64, { commitment: "confirmed",
            minContextSlot: Number(beforeRead.slot) }])).value;
    if (feeValue === null)
        throw new ApnError("APN_REPREPARE_REQUIRED", "The stable candidate blockhash expired before pricing.");
    const fee = rpcAtomic(feeValue), rent = BigInt(preview.ataRentLamports);
    const priority = BigInt(preview.maximumPriorityFeeLamports);
    if (fee < MIN_BASE_FEE + priority || fee + rent > BigInt(request.maximumTotalFeeLamports) || owner.lamports < fee + rent) {
        blocked("Exact network fee or rent exceeds owner funds or cap.", "orca_stable_fee_cap");
    }
    const params = [preview.unsignedPayload, { sigVerify: false, replaceRecentBlockhash: false,
            commitment: "confirmed", encoding: "base64", minContextSlot: Number(beforeRead.slot), innerInstructions: true,
            accounts: { encoding: "base64", addresses: [request.owner, preview.sourceAta, preview.destinationAta] } }];
    const response = rpcRecord(await rpc.call("simulateTransaction", params));
    const simulationSlot = rpcAtomic(rpcRecord(response.context).slot), simulation = rpcRecord(response.value);
    if (simulation.err !== null)
        blocked("Exact stable transaction simulation failed.", "orca_stable_simulation_failed");
    const units = rpcAtomic(simulation.unitsConsumed);
    if (units === 0n || units > BigInt(request.computeUnitLimit) || simulationSlot > BigInt(Number.MAX_SAFE_INTEGER) ||
        simulationSlot < beforeRead.slot || simulationSlot - BigInt(preview.marketSlot) > MAX_SLOT_DRIFT) {
        blocked("Stable simulation compute units, accounts, or slot are invalid.", "orca_stable_simulation_invalid");
    }
    const transfers = proveOrcaStableSimulationTransfers(simulation.innerInstructions, preview, request.owner, quote.amountInAtomic, quote.minimumOutputAtomic);
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
    if (sourcePostAmount !== sourceBalance - BigInt(transfers.sourceDebitedAtomic) ||
        destinationPostAmount !== destinationBalance + BigInt(transfers.destinationCreditedAtomic) ||
        ownerPost.lamports !== owner.lamports - fee - rent ||
        sourcePost.lamports !== source.lamports ||
        destinationPost.lamports !== (destination === null ? rent : destination.lamports)) {
        blocked("Stable simulated account effects differ from the exact transfer, fee, or ATA rent.", "orca_stable_simulation_delta");
    }
    const policyNow = trustedNow(clock);
    await recheckOrcaStableOwner(ports, admission, policyNow);
    const active = await ports.activePolicy(request.profile);
    if (active === null || active.revision !== admission.policyRevision || active.digest !== admission.policyDigest ||
        active.activationDigest !== admission.activationDigest)
        blocked("Owner policy changed before preparation.", "orca_stable_policy_drift");
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
        sourceAsset: { chain: ORCA_SOLANA_CHAIN, kind: "token", identifier: USDC_MINT },
        destinationAsset: { chain: ORCA_SOLANA_CHAIN, kind: "token", identifier: SOLANA_USDT },
        inputAmountAtomic: quote.amountInAtomic, expectedOutputAtomic: quote.expectedOutputAtomic,
        minimumOutputAtomic: quote.minimumOutputAtomic, slippageBps: quote.slippageBps, effectiveAt: now,
        expiresAt: new Date(commitNow.getTime() + 60_000).toISOString(),
        providerResponseHash: domainHash("apn.orca-stable-candidate-evidence.v1", canonicalJson(evidence)),
        routeHash: domainHash("apn.orca-stable-candidate-route.v1", canonicalJson({ pool: quote.pool, program: quote.program,
            sourceAta: preview.sourceAta, destinationAta: preview.destinationAta, messageHash: preview.messageHash })),
        unsignedTransactionPayloadHash: sha256(preview.unsignedPayload),
        simulation: { requestHash: domainHash("apn.orca-stable-candidate-simulation-request.v1", canonicalJson(params)),
            resultHash: domainHash("apn.orca-stable-candidate-simulation-result.v1", canonicalJson(simulationResult)),
            success: true, blockNumber: preview.marketSlot, blockHash: blockhashHex(preview.blockhash),
            headBlockNumber: simulationSlot.toString(), maxHeadDrift: Number(MAX_SLOT_DRIFT), gasEstimate: units.toString() } };
    const boundQuote = createSwapQuote(quoteInput);
    return { quoteInput, active, commitNow, boundQuote, evidence, preview,
        unsignedTransaction: { payloadBase64: preview.unsignedPayload, messageHash: preview.messageHash,
            blockhash: preview.blockhash, lastValidBlockHeight: preview.lastValidBlockHeight } };
}
function tokenAmount(account, owner, mint) {
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
function trustedNow(clock) {
    const value = clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
        throw new ApnError("APN_INVALID_INPUT", "Stable candidate clock is invalid.");
    return value;
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=stable-candidate.js.map