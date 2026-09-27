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
import { GuardedSwapService } from "../service.js";
import { createSwapQuote } from "../quote.js";
const MAX_SLOT_DRIFT = 150n;
const MIN_BASE_FEE = 5000n;
export const ORCA_STABLE_CANDIDATE_SCHEMA = "apn.orca-stable-guarded-candidate.v1";
/** A bounded production entry: all RPC reads, fee pricing and simulation precede the first operation write. */
export async function prepareOrcaStableGuardedCandidate(rpc, ports, service, request) {
    if (rpc.budget === undefined || rpc.budget.physicalRequests !== 0 || rpc.budget.maxPhysicalRequests > 24 ||
        rpc.budget.minimumIntervalMs < 750 || !rpc.hasPersistentPacer) {
        throw new ApnError("APN_RPC_CONFIG", "Stable candidate requires a fresh 24 POST budget and persistent 750 ms pacing.");
    }
    return await prepareOrcaStableGuardedCandidateCore(rpc, ports, service, request, verifyOrcaProgramPins);
}
/** Injectable pin verifier permits deterministic fake-RPC tests; production always uses the pinned verifier. */
export async function prepareOrcaStableGuardedCandidateCore(rpc, ports, service, request, verifyPins) {
    const initial = await admitOrcaStableOwner(ports, { profile: request.profile, owner: request.owner,
        policyRevision: request.policyRevision, amountInAtomic: request.amountAtomic,
        minimumOutputAtomic: "1", now: request.now }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
    const observed = await readOrcaStableSnapshotCore(rpc, request, verifyPins);
    const { preview, quote } = observed;
    await validateOrcaStableUnsigned(preview);
    // The actual minimum is known only after reading the pool; enforce its cap under the exact active policy.
    const admission = await admitOrcaStableOwner(ports, { profile: request.profile, owner: request.owner,
        policyRevision: request.policyRevision, amountInAtomic: request.amountAtomic,
        minimumOutputAtomic: quote.minimumOutputAtomic, now: request.now }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
    if (admission.policyDigest !== initial.policyDigest || admission.activationDigest !== initial.activationDigest) {
        blocked("Stable owner policy changed while reading the pool.", "orca_stable_policy_drift");
    }
    assertOrcaStableQuoteAdmission(admission, quote);
    const beforeRead = await readRawAccounts(rpc, [request.owner, preview.sourceAta, preview.destinationAta], 165);
    if (beforeRead.slot < BigInt(preview.marketSlot) || beforeRead.slot - BigInt(preview.marketSlot) > MAX_SLOT_DRIFT) {
        blocked("Owner balances are outside the market slot bound.", "orca_stable_slot_drift");
    }
    const [owner = null, source = null, destination = null] = beforeRead.accounts;
    if (owner === null || owner.owner !== SYSTEM_PROGRAM || owner.executable || owner.data.length !== 0) {
        blocked("Owner system account changed.", "orca_stable_owner");
    }
    const sourceBefore = tokenAmount(source ?? null, request.owner, USDC_MINT);
    const destinationBefore = destination === null ? 0n : tokenAmount(destination, request.owner, SOLANA_USDT);
    if (sourceBefore < BigInt(request.amountAtomic) || (destination === null) !== preview.createUsdtAta) {
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
            commitment: "confirmed", encoding: "base64", minContextSlot: Number(beforeRead.slot),
            accounts: { encoding: "base64", addresses: [request.owner, preview.sourceAta, preview.destinationAta] } }];
    const response = rpcRecord(await rpc.call("simulateTransaction", params));
    const simulationSlot = rpcAtomic(rpcRecord(response.context).slot), simulation = rpcRecord(response.value);
    if (simulation.err !== null)
        blocked("Exact stable transaction simulation failed.", "orca_stable_simulation_failed");
    const units = rpcAtomic(simulation.unitsConsumed), accounts = rpcArray(simulation.accounts, 3);
    if (units === 0n || units > BigInt(request.computeUnitLimit) || accounts.length !== 3 ||
        simulationSlot < beforeRead.slot || simulationSlot - BigInt(preview.marketSlot) > MAX_SLOT_DRIFT) {
        blocked("Stable simulation compute units, accounts, or slot are invalid.", "orca_stable_simulation_invalid");
    }
    const ownerAfter = accounts[0] === null ? null : rawAccount(accounts[0], 0);
    const sourceAfter = accounts[1] === null ? null : rawAccount(accounts[1], 165);
    const destinationAfter = accounts[2] === null ? null : rawAccount(accounts[2], 165);
    if (ownerAfter === null || ownerAfter.owner !== SYSTEM_PROGRAM || ownerAfter.executable || ownerAfter.data.length !== 0 ||
        sourceAfter === null || destinationAfter === null) {
        blocked("Stable simulation owner or token account is missing.", "orca_stable_simulation_invalid");
    }
    const sourceAtomic = tokenAmount(sourceAfter, request.owner, USDC_MINT);
    const destinationAtomic = tokenAmount(destinationAfter, request.owner, SOLANA_USDT);
    const debited = sourceBefore - sourceAtomic, credited = destinationAtomic - destinationBefore;
    if (debited <= 0n || debited > BigInt(request.amountAtomic) || credited < BigInt(quote.minimumOutputAtomic)) {
        blocked("Stable simulation exceeds source debit or misses destination minimum.", "orca_stable_simulation_delta");
    }
    if (ownerAfter.lamports > owner.lamports || owner.lamports - ownerAfter.lamports > fee + rent) {
        blocked("Stable simulation exceeds the owner SOL fee and rent bound.", "orca_stable_simulation_sol");
    }
    const currentHeight = rpcAtomic(await rpc.call("getBlockHeight", [{ commitment: "confirmed", minContextSlot: Number(simulationSlot) }]));
    if (currentHeight >= BigInt(preview.lastValidBlockHeight)) {
        throw new ApnError("APN_REPREPARE_REQUIRED", "The stable candidate blockhash expired before preparation.");
    }
    await recheckOrcaStableOwner(ports, admission, request.now);
    const active = await ports.activePolicy(request.profile);
    if (active === null || active.revision !== admission.policyRevision || active.digest !== admission.policyDigest ||
        active.activationDigest !== admission.activationDigest)
        blocked("Owner policy changed before preparation.", "orca_stable_policy_drift");
    const simulationResult = { slot: simulationSlot.toString(), unitsConsumed: units.toString(),
        sourceDebitedAtomic: debited.toString(), destinationCreditedAtomic: credited.toString(),
        ownerLamportsAfter: ownerAfter.lamports.toString() };
    const evidence = { schemaVersion: ORCA_STABLE_CANDIDATE_SCHEMA, marketSlot: preview.marketSlot,
        beforeSlot: beforeRead.slot.toString(), simulation: simulationResult, sourceAta: preview.sourceAta,
        destinationAta: preview.destinationAta, pool: quote.pool, program: quote.program, blockhash: preview.blockhash,
        lastValidBlockHeight: preview.lastValidBlockHeight, messageHash: preview.messageHash,
        unsignedPayloadHash: sha256(preview.unsignedPayload), actualFeeLamports: fee.toString(), rentLamports: rent.toString(),
        policyDigest: admission.policyDigest, policyRevision: admission.policyRevision,
        activationDigest: admission.activationDigest, mechanismDigest: admission.mechanismDigest,
        ownerUsage: { source: await ports.dailyUsage(request.owner, USDC_MINT, request.now),
            destination: await ports.dailyUsage(request.owner, SOLANA_USDT, request.now) } };
    // Usage may change between read and write: recheck after material assembly as the final read barrier.
    await recheckOrcaStableOwner(ports, admission, request.now);
    const usageAfter = { source: await ports.dailyUsage(request.owner, USDC_MINT, request.now),
        destination: await ports.dailyUsage(request.owner, SOLANA_USDT, request.now) };
    if (canonicalJson(usageAfter) !== canonicalJson(evidence.ownerUsage)) {
        blocked("Owner daily usage changed before preparation.", "orca_stable_usage_drift");
    }
    const now = request.now.toISOString();
    const quoteInput = { profile: request.profile, account: request.owner, recipient: request.owner,
        sourceAsset: { chain: ORCA_SOLANA_CHAIN, kind: "token", identifier: USDC_MINT },
        destinationAsset: { chain: ORCA_SOLANA_CHAIN, kind: "token", identifier: SOLANA_USDT },
        inputAmountAtomic: quote.amountInAtomic, expectedOutputAtomic: quote.expectedOutputAtomic,
        minimumOutputAtomic: quote.minimumOutputAtomic, slippageBps: quote.slippageBps, effectiveAt: now,
        expiresAt: new Date(request.now.getTime() + 60_000).toISOString(),
        providerResponseHash: domainHash("apn.orca-stable-candidate-evidence.v1", canonicalJson(evidence)),
        routeHash: domainHash("apn.orca-stable-candidate-route.v1", canonicalJson({ pool: quote.pool, program: quote.program,
            sourceAta: preview.sourceAta, destinationAta: preview.destinationAta, messageHash: preview.messageHash })),
        unsignedTransactionPayloadHash: sha256(preview.unsignedPayload),
        simulation: { requestHash: domainHash("apn.orca-stable-candidate-simulation-request.v1", canonicalJson(params)),
            resultHash: domainHash("apn.orca-stable-candidate-simulation-result.v1", canonicalJson(simulationResult)),
            success: true, blockNumber: preview.marketSlot, blockHash: blockhashHex(preview.blockhash),
            headBlockNumber: simulationSlot.toString(), maxHeadDrift: Number(MAX_SLOT_DRIFT), gasEstimate: units.toString() } };
    const boundQuote = createSwapQuote(quoteInput);
    const operation = await service.prepare({ quote: quoteInput, assetPolicy: active.registry,
        protocolRegistry: ORCA_PROTOCOL_REGISTRY, idempotencyKey: request.idempotencyKey,
        approvalCapAtomic: "0", now: request.now });
    return { schemaVersion: ORCA_STABLE_CANDIDATE_SCHEMA, quote: boundQuote, operation,
        evidence, unsignedTransaction: { payloadBase64: preview.unsignedPayload, messageHash: preview.messageHash,
            blockhash: preview.blockhash, lastValidBlockHeight: preview.lastValidBlockHeight },
        signed: false, broadcast: false };
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
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=stable-candidate.js.map