import { canonicalJson, domainHash } from "../../canonical.js";
import { SOLANA_USDT } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import { SolanaRpc } from "../../solana/rpc.js";
import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { validateSwapOperation } from "../model.js";
import { proveOrcaStableGuardedCore } from "./stable-candidate.js";
import { admitOrcaStableOwner, recheckOrcaStableOwner } from "./stable-admission.js";
import { validateOrcaStableMaterial } from "./stable-material.js";
import { ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { stableReservationAdmissionPorts } from "./stable-reservation-admission.js";
import { USDC_MINT, verifyOrcaProgramPins } from "./pins.js";
const MAX_PREFLIGHT_MS = 30_000;
/**
 * Internal production port only. The same budget must be retained by any later send, leaving one physical POST.
 * This function has no signer, sender, public command or operation transition.
 */
export async function freshOrcaStableExecutionPreflight(rpc, admission, usage, operation, material, clock = () => new Date()) {
    if (rpc.budget === undefined || rpc.budget.physicalRequests !== 0 || rpc.budget.maxPhysicalRequests > 24 ||
        rpc.budget.minimumIntervalMs < 750 || !rpc.hasPersistentPacer) {
        throw new ApnError("APN_RPC_CONFIG", "Stable execution requires a fresh 24 POST budget and persistent 750 ms pacing.");
    }
    const result = await freshOrcaStableExecutionPreflightCore(rpc, admission, usage, operation, material, verifyOrcaProgramPins, clock);
    if (rpc.budget.physicalRequests > 23 || rpc.budget.remainingPhysicalRequests < 1) {
        blocked("Stable preflight used the physical POST reserved for submission.", "orca_stable_rpc_budget");
    }
    return { ...result, physicalPostCount: rpc.budget.physicalRequests };
}
/** Injectable, no-effect core for deterministic fake RPC and policy tests. */
export async function freshOrcaStableExecutionPreflightCore(rpc, admission, usage, operationValue, materialValue, verifyPins, clock) {
    // Start before any validation or storage await; the bound covers the complete adapter call.
    const start = now(clock);
    const operation = validateSwapOperation(operationValue);
    const material = await validateOrcaStableMaterial(materialValue, operation);
    if (rpc.originHash !== material.sourceBinding.rpcOriginHash)
        blocked("Stable RPC source changed since preparation.", "orca_stable_rpc_source");
    if (material.maximumPriceImpactBps === undefined) {
        throw new ApnError("APN_REPREPARE_REQUIRED", "Stable material predates the durable owner price impact cap.");
    }
    if (operation.state !== "reserved" || operation.submissionMarker !== null ||
        operation.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST ||
        start.toISOString() < operation.quote.effectiveAt || start.toISOString() >= operation.quote.expiresAt) {
        blocked("Stable operation is unavailable or its quote expired.", "orca_stable_deadline");
    }
    const lease = operation.usageLease;
    if (lease === null || lease.state !== "reserved" || lease.amountAtomic !== operation.quote.inputAmountAtomic ||
        lease.policyDigest !== operation.policyDigest)
        corrupt("Stable principal lease differs from the operation.");
    const liveLease = await usage.load({ account: operation.quote.account, chain: operation.quote.sourceAsset.chain,
        asset: { kind: "token", identifier: USDC_MINT } }, lease.reservationId);
    if (liveLease === null || canonicalJson(liveLease) !== canonicalJson(lease))
        corrupt("Stable principal lease changed.");
    const admittedPorts = stableReservationAdmissionPorts(admission, usage, operation);
    const owner = await admitOrcaStableOwner(admittedPorts, { profile: operation.quote.profile,
        owner: operation.quote.account, policyRevision: material.policyRevision,
        amountInAtomic: operation.quote.inputAmountAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
        now: start }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
    if (owner.policyDigest !== material.policyDigest || owner.activationDigest !== material.activationDigest ||
        owner.policyDigest !== operation.policyDigest)
        blocked("Stable owner policy changed.", "orca_stable_policy_drift");
    const proof = await proveOrcaStableGuardedCore(rpc, admittedPorts, {
        profile: operation.quote.profile, policyRevision: material.policyRevision, owner: operation.quote.account,
        amountAtomic: operation.quote.inputAmountAtomic, slippageBps: operation.quote.slippageBps,
        maximumPriceImpactBps: material.maximumPriceImpactBps,
        approvedMinimumOutputAtomic: operation.quote.minimumOutputAtomic,
        computeUnitLimit: material.preview.computeUnitLimit,
        computeUnitPriceMicroLamports: material.preview.computeUnitPriceMicroLamports,
        createUsdtAta: material.preview.createUsdtAta,
        ...(material.preview.createUsdtAta ? { maximumAtaRentLamports: material.preview.ataRentLamports } : {}),
        maximumTotalFeeLamports: material.preview.maximumTotalFeeLamports,
    }, verifyPins, clock);
    const fresh = proof.preview, approved = material.preview;
    if (canonicalJson(proof.evidence.sourceBinding) !== canonicalJson(material.sourceBinding))
        blocked("Stable RPC source changed during preflight.", "orca_stable_rpc_source");
    if (fresh.owner !== approved.owner || fresh.sourceAta !== approved.sourceAta ||
        fresh.destinationAta !== approved.destinationAta || fresh.amountInAtomic !== approved.amountInAtomic ||
        fresh.minimumOutputAtomic !== approved.minimumOutputAtomic ||
        canonicalJson(fresh.tickArrayStarts) !== canonicalJson(approved.tickArrayStarts) ||
        fresh.oracle !== approved.oracle || fresh.createUsdtAta !== approved.createUsdtAta ||
        canonicalJson(fresh.instructionPrograms) !== canonicalJson(approved.instructionPrograms) ||
        BigInt(fresh.ataRentLamports) > BigInt(approved.ataRentLamports) ||
        BigInt(proof.evidence.actualFeeLamports) + BigInt(fresh.ataRentLamports) > BigInt(approved.maximumTotalFeeLamports) ||
        proof.quoteInput.sourceAsset.identifier !== USDC_MINT ||
        proof.quoteInput.destinationAsset.identifier !== SOLANA_USDT) {
        blocked("Fresh stable message differs from the owner approved bounds.", "orca_stable_freshness");
    }
    await recheckOrcaStableOwner(admittedPorts, owner, now(clock));
    const active = await admission.activePolicy(operation.quote.profile);
    if (active === null || active.digest !== owner.policyDigest || active.revision !== owner.policyRevision ||
        active.activationDigest !== owner.activationDigest)
        blocked("Stable owner activation changed.", "orca_stable_policy_drift");
    // This instant is the journal's freshness anchor, sampled only after all awaited checks complete.
    const checked = now(clock);
    if (checked.getTime() < start.getTime() || checked.getTime() - start.getTime() > MAX_PREFLIGHT_MS ||
        checked.toISOString() >= operation.quote.expiresAt) {
        blocked("Stable preflight exceeded its clock or quote deadline.", "orca_stable_freshness");
    }
    return { preview: fresh, checkedAt: checked.toISOString(), elapsedMs: checked.getTime() - start.getTime(),
        physicalPostCount: 0, simulationHash: domainHash("apn.orca-stable-fresh-simulation.v1", canonicalJson({ operationId: operation.operationId, messageHash: fresh.messageHash,
            result: proof.evidence.simulation })) };
}
function now(clock) {
    const value = clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
        throw new ApnError("APN_INVALID_INPUT", "Stable preflight clock is invalid.");
    return value;
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=stable-fresh-preflight.js.map