import { keccak256 } from "viem";
import { hashObject } from "../canonical.js";
import { circleBlocked } from "./operation-model.js";
import { assertAdmittedCleanup86FirstDispatchJournal, Cleanup86FirstDispatchJournal } from "./cleanup86-first-dispatch-journal.js";
import { claimCleanup86FirstDispatchPurpose, verifiedCleanup86FirstDispatchPurpose, assertCleanup86FirstDispatchPermission } from "./cleanup86-first-dispatch-purpose.js";
const grants = new WeakMap();
// Private issuer: called only after the trusted foreground consent port completes.
function mint(certificate, binding, journal) {
    assertAdmittedCleanup86FirstDispatchJournal(journal, binding);
    const { purpose, now } = claimCleanup86FirstDispatchPurpose(certificate, binding), expiresAt = Date.parse(purpose.windowEndsAt);
    if (now() >= expiresAt)
        circleBlocked("cleanup86_first_dispatch_authority_expired");
    const grant = Object.freeze({ kind: "cleanup86-first-dispatch-grant" });
    grants.set(grant, { bindingHash: hashObject(binding), journal, expiresAt, now, active: true, consumed: false });
    return grant;
}
export function assertCleanup86FirstDispatchGrant(grant, binding, stage) {
    const g = grants.get(grant);
    if (g?.active !== true || g.bindingHash !== hashObject(binding) || g.now() >= g.expiresAt || g.consumed && stage !== "broadcast")
        circleBlocked("private_cleanup86_first_dispatch_authority_required");
}
export function assertCleanup86FirstDispatchJournalBinding(grant, binding, journal) {
    assertCleanup86FirstDispatchGrant(grant, binding, "restore");
    if (grants.get(grant)?.journal !== journal)
        circleBlocked("cleanup86_private_first_dispatch_journal_required");
}
function consume(grant, binding) { assertCleanup86FirstDispatchGrant(grant, binding, "consume"); grants.get(grant).consumed = true; }
function revoke(grant) { const g = grants.get(grant); if (g !== undefined)
    g.active = false; grants.delete(grant); }
/** Exact first dispatch only. Never seal/sign, change original journals, or retry a SEND. */
export async function executeCleanup86FirstDispatch(journal, certificate, binding, ports) {
    const purpose = verifiedCleanup86FirstDispatchPurpose(certificate, binding), deadline = purpose.windowEndsAt;
    assertAdmittedCleanup86FirstDispatchJournal(journal, binding);
    await assertCleanup86FirstDispatchPermission(certificate, binding);
    await journal.assertStable();
    await journal.authorize(purpose);
    await ports.confirm(purpose, deadline);
    await assertCleanup86FirstDispatchPermission(certificate, binding);
    await journal.assertStable();
    const grant = mint(certificate, binding, journal);
    const gate = (stage = "restore") => assertCleanup86FirstDispatchGrant(grant, binding, stage);
    let claimed = false, terminalRecorded = false;
    try {
        gate();
        const material = await ports.restore(grant);
        gate();
        const { materialHash, ...body } = material;
        if (material.version !== "apn.circle-cleanup86-material.v1" || material.intentHash !== binding.intentHash || material.recoveryBinding !== binding.recoveryId || material.envelopeHash !== binding.envelopeHash || material.materialHash !== binding.materialHash || material.transactionHash !== binding.transactionHash || keccak256(material.rawTransaction) !== binding.transactionHash || materialHash !== hashObject(body))
            circleBlocked("cleanup86_first_dispatch_restored_binding_changed");
        await journal.assertStable();
        await ports.preflight(grant);
        gate();
        await assertCleanup86FirstDispatchPermission(certificate, binding);
        gate();
        await journal.assertStable();
        await journal.append("submission_started");
        gate();
        await journal.claimSend();
        claimed = true;
        consume(grant, binding);
        gate("broadcast");
        const hash = await ports.send(material, grant);
        gate("broadcast");
        if (hash !== binding.transactionHash)
            circleBlocked("cleanup86_first_dispatch_submission_hash_changed");
        terminalRecorded = true;
        await journal.append("unknown");
    }
    catch (error) {
        // Claim/crash/rejection never restores financial capability. Do not overwrite first failure,
        // original sealed/UNKNOWN effects, material or any historical file.
        if (claimed && !terminalRecorded) {
            terminalRecorded = true;
            await journal.append("unknown");
        }
        throw error;
    }
    finally {
        revoke(grant);
    }
}
//# sourceMappingURL=cleanup86-first-dispatch-controller.js.map