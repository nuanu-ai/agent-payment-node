import { ApnError } from "../errors.js";
import { hashObject } from "../canonical.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { exactChainConsent } from "../tty-approval.js";
import { approvalCode } from "../approval-code.js";
import { circleBlocked } from "./operation-model.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./catalog.js";
import { CircleRpc, currentCircleDeployments, circleRpcTransaction } from "./rpc.js";
import { circleHex, circleUint } from "./protocol.js";
import { verifyCancellationPublic } from "./cleanup85-public-proof.js";
import { consumedBurnEvidence } from "./consumed-burn-rpc.js";
import { recheckCleanup86Admission } from "./cleanup86-public-admission.js";
import { CLEANUP85_HASH, cleanup85CancellationRequest } from "./cleanup85-recovery-store.js";
import { Cleanup86FirstDispatchJournal } from "./cleanup86-first-dispatch-journal.js";
import { verifyCleanup86FirstDispatchPurpose, assertCleanup86FirstDispatchPermission } from "./cleanup86-first-dispatch-purpose.js";
import { assertCleanup86FirstDispatchGrant } from "./cleanup86-first-dispatch-authority.js";
import { executeCleanup86FirstDispatch } from "./cleanup86-first-dispatch-controller.js";
/** Normal explicit approve entry only: no quote, new intent, signing key or seal operation. */
export async function firstDispatchCleanup86(state, op, recovery, intent, proof, source, destination, scope, now, tty, https, custody, accounting, archiveInterval) {
    const journal = await Cleanup86FirstDispatchJournal.admit(state.root, op, intent), metadata = journal.metadata();
    const binding = { root: state.root, operationId: op.operationId, intentHash: intent.intentHash, recoveryId: recovery.recoveryBinding, envelopeHash: intent.envelope.envelopeHash, ...metadata };
    const cancellation = await verifyCancellationPublic(source, proof);
    await accounting(state, cleanup85CancellationRequest(recovery), proof);
    const evidence = await consumedBurnEvidence(source, op, "cancel85"), submission = new CircleRpc("https://arb1.arbitrum.io/rpc", 42161, https, 256, archiveInterval);
    let certificate;
    const census = () => new AssetUsageLedger(state.root).usageReadOnly({ account: CIRCLE_SOURCE_OWNER, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, new Date(now()));
    const preflight = async (grant) => {
        const guard = () => { if (grant !== undefined)
            assertCleanup86FirstDispatchGrant(grant, binding, "restore"); };
        await source.guarded(guard, () => destination.guarded(guard, () => submission.guarded(guard, async () => {
            guard();
            await journal.assertStable();
            if (certificate !== undefined)
                await assertCleanup86FirstDispatchPermission(certificate, binding);
            await accounting(state, cleanup85CancellationRequest(recovery), proof);
            await currentCircleDeployments(source, destination, 1329);
            await recheckCleanup86Admission(source, evidence, cancellation);
            await submission.identity();
            const head = await submission.block("latest"), canonical = await source.block(String(head.number));
            if (circleHex(head.hash, 32) === "0x" + "0".repeat(64) || circleHex(canonical.hash, 32) !== circleHex(head.hash, 32) || circleUint(canonical.number) !== circleUint(head.number) || circleUint(canonical.timestamp) !== circleUint(head.timestamp))
                circleBlocked("cleanup86_submission_canonical_anchor_changed");
            const operands = { baseFeeAtomic: circleUint(head.baseFeePerGas).toString(), maxFeePerGasAtomic: intent.envelope.maxFeePerGasAtomic, nativeUpperAtomic: (BigInt(intent.envelope.gasLimitAtomic) * BigInt(intent.envelope.maxFeePerGasAtomic)).toString() };
            const refuse = (failurePredicate) => { throw new ApnError("APN_OPERATION_BLOCKED", "Circle EVM operation blocked: cleanup86_fresh_network_guard.", { reason: "cleanup86_fresh_network_guard", failurePredicate, ...operands }); };
            if (BigInt(operands.baseFeeAtomic) * 2n > BigInt(intent.envelope.maxFeePerGasAtomic))
                refuse("fee");
            const before = await census(), latest = circleUint(await source.call("eth_getBalance", [CIRCLE_SOURCE_OWNER, "latest"]));
            operands.pendingNativeAtomic = circleUint(await source.call("eth_getBalance", [CIRCLE_SOURCE_OWNER, "pending"])).toString();
            if (BigInt(operands.pendingNativeAtomic) < BigInt(operands.nativeUpperAtomic))
                refuse("pendingNative");
            if (latest < BigInt(before.amountAtomic) || BigInt(operands.pendingNativeAtomic) < BigInt(before.amountAtomic))
                circleBlocked("cleanup86_first_dispatch_full_native_liabilities");
            operands.approveCallResult = circleHex(await source.call("eth_call", [circleRpcTransaction(intent.envelope), "pending"]));
            if (operands.approveCallResult !== "0x" + "0".repeat(63) + "1")
                refuse("approveCall");
            operands.oldReceiptPresent = await source.call("eth_getTransactionReceipt", [CLEANUP85_HASH]) !== null;
            if (operands.oldReceiptPresent)
                refuse("oldReceipt");
            if (hashObject(before) !== hashObject(await census()))
                circleBlocked("cleanup86_first_dispatch_native_census_changed");
            await journal.assertStable();
            guard();
        })));
    };
    await preflight();
    certificate = await verifyCleanup86FirstDispatchPurpose(state, op, recovery, intent, binding, proof, scope, now);
    await executeCleanup86FirstDispatch(journal, certificate, binding, {
        confirm: (purpose, deadline) => exactChainConsent(["Agent Payment Node Circle EXACT SEALED generation2 FIRST DISPATCH", `Operation: ${op.operationId}`, `Owner: ${op.sourceCustody.walletAddress} / eip155:42161`, `Already signed transaction: ${metadata.transactionHash}; intent: ${intent.intentHash}; material: ${metadata.materialHash}.`, `Only identical reduce-only zero approval nonce86 to ${CIRCLE_SOURCE_TOKEN}; spender ${CIRCLE_MESSENGER}; value0.`, `Historical intent and original permission window remain immutable. NEW current purpose: ${purpose.purposeHash}.`, `Current owner activations: ${purpose.policies.map(p => `${p.profile} revision${p.revision} ${p.activationDigest}`).join("; ")}.`, `Frozen fee upper ${purpose.frozenFeeUpperAtomic}; original maximum15000000000000; no new signature or repricing.`, `One atomic global SEND then one dispatch; all later outcomes observe-only. Foreground decision expires ${deadline}.`], approvalCode("bridge", op.operationId, purpose.purposeHash), deadline, tty),
        restore: grant => custody.restoreFirstDispatch(op, intent, recovery, grant, metadata, journal), preflight,
        send: async (material, grant) => { await assertCleanup86FirstDispatchPermission(certificate, binding); assertCleanup86FirstDispatchGrant(grant, binding, "broadcast"); await journal.assertStable(); return circleHex(await submission.call("eth_sendRawTransaction", [material.rawTransaction], () => assertCleanup86FirstDispatchGrant(grant, binding, "broadcast")), 32); }
    });
}
//# sourceMappingURL=cleanup86-first-dispatch-runtime.js.map