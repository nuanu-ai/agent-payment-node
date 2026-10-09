import { hashObject } from "../canonical.js";
import { assertExclusiveEvmRawSigner, evmAddressLock } from "../evm-address-ownership.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { OperationService } from "../operation-service.js";
import { BridgeHttps } from "../lifi/https.js";
import { exactChainConsent } from "../tty-approval.js";
import { approvalCode } from "../approval-code.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, circleRoute } from "./catalog.js";
import { CircleRepository } from "./repository.js";
import { CircleUsage } from "./usage.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest, assertCleanup85Window, CLEANUP85_HASH } from "./cleanup85-recovery-store.js";
import { Cleanup86Store } from "./cleanup86-store.js";
import { Cleanup86Custody } from "./cleanup86-custody.js";
import { executeCleanup86, assertCleanup86Grant } from "./cleanup86-controller.js";
import { observeCleanup86 } from "./cleanup86-observer.js";
import { verifyCancellationPublic } from "./cleanup85-public-proof.js";
import { prepareCleanup85Recovery } from "./cleanup85-recovery-prepare.js";
import { consumedBurnEvidence } from "./consumed-burn-rpc.js";
import { recheckCleanup86Admission } from "./cleanup86-public-admission.js";
import { CircleRpc, currentCircleDeployments, circleRpcTransaction } from "./rpc.js";
import { circleBlocked } from "./operation-model.js";
import { circleHex, circleUint, circleRecord, encodeCircleApproval } from "./protocol.js";
/** Finite normal controller; money commands require the independently installed B/C backend.
 * No Circle lock is held across B.execute/inspect. Persisted proofs are never dispatch authority. */
export class Cleanup85RecoveryRuntime {
    state;
    env;
    now;
    tty;
    https;
    dependencies;
    repo;
    usage;
    custody;
    constructor(state, wrapping, env, now, tty, https, dependencies) {
        this.state = state;
        this.env = env;
        this.now = now;
        this.tty = tty;
        this.https = https;
        this.dependencies = dependencies;
        this.repo = new CircleRepository(state.root);
        this.usage = new CircleUsage(state, now);
        this.custody = new Cleanup86Custody(state, wrapping);
    }
    remotes() { const route = circleRoute(1329); return { source: new CircleRpc(this.env.APN_ARBITRUM_RPC_URL ?? "https://arbitrum-one-rpc.publicnode.com", 42161, this.https), destination: new CircleRpc(this.env[route.rpcEnvironment] ?? route.rpcDefault, 1329, this.https) }; }
    async publicStatus(id) {
        const op = await this.repo.load(id);
        if (op === null || op.operationId !== "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33")
            return null;
        const recoveryStore = new Cleanup85RecoveryStore(this.state.root), parent = await new CircleNonceRetirementStore(this.state.root).intent(op);
        if (parent === null || await recoveryStore.publicRecord(op, "intent") === null)
            return null;
        const recovery = await recoveryStore.load(op, parent), store = new Cleanup86Store(this.state.root), intent = await store.intent(op, recovery);
        return { recoveryBinding: recovery.recoveryBinding, windowEndsAt: recovery.windowEndsAt, ...(intent === null ? {} : { cleanup86: { intentHash: intent.intentHash, envelopeHash: intent.envelope.envelopeHash, effect: await store.effect(op, intent), signClaimed: await store.claimed(op, intent, "sign"), sendClaimed: await store.claimed(op, intent, "send"), materialMetadata: await this.custody.publicMetadata(op, intent), firstPublicFailure: await store.failure(op, intent) } }) };
    }
    backend() { if (this.dependencies === undefined || typeof this.dependencies.verifyCancellationAccounting !== "function")
        circleBlocked("cleanup85_verified_native_backend_required"); return this.dependencies; }
    async frame(id) {
        const op = await this.repo.load(id);
        if (op === null)
            circleBlocked("cleanup85_parent_missing");
        const parent = await new CircleNonceRetirementStore(this.state.root).intent(op);
        if (parent === null)
            circleBlocked("cleanup85_parent_intent_missing");
        const recovery = await new Cleanup85RecoveryStore(this.state.root).load(op, parent);
        if (recovery === null)
            circleBlocked("explicit_cleanup85_recovery_prepare_required");
        return { op, recovery, request: cleanup85CancellationRequest(recovery) };
    }
    async cancel(id) {
        const backend = this.backend(), { source, destination } = this.remotes();
        const request = await prepareCleanup85Recovery(this.state, source, destination, id, this.now);
        // B independently refuses its own durable SIGN/SEND, before any new TTY/private access.
        return backend.cancellation.execute(request);
    }
    async approve86(id) {
        const initial = await this.frame(id);
        if (initial.op.state === "nonce_retired")
            return initial.op;
        const prior = await new Cleanup86Store(this.state.root).intent(initial.op, initial.recovery);
        if (prior !== null && (await new Cleanup86Store(this.state.root).claimed(initial.op, prior, "sign") || await new Cleanup86Store(this.state.root).claimed(initial.op, prior, "send")))
            circleBlocked("cleanup86_claimed_observe_only");
        const backend = this.backend(), status = await backend.cancellation.inspect(initial.request);
        if (status.phase !== "finalized" || status.proof === null || status.operationId !== status.proof.operationId || status.transactionHash !== status.proof.transactionHash)
            circleBlocked("cleanup85_cancellation_finalized_proof_required");
        return this.locked(id, status.proof, async (op, recovery, source, destination) => {
            const store = new Cleanup86Store(this.state.root), existing = await store.intent(op, recovery);
            if (existing !== null && (await store.claimed(op, existing, "sign") || await store.claimed(op, existing, "send")))
                circleBlocked("cleanup86_claimed_observe_only");
            await this.financialGuard(op, recovery);
            const cancellation = await this.verifyCancellation(initial.request, status.proof, recovery, source);
            const evidence = await consumedBurnEvidence(source, op, "cancel85");
            await currentCircleDeployments(source, destination, 1329);
            if (await source.call("eth_getTransactionReceipt", [CLEANUP85_HASH]) !== null)
                circleBlocked("cleanup85_original_receipt_requires_public_reconciliation");
            const envelope = existing?.envelope ?? await source.envelope(CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(true), "86");
            const intent = existing ?? await store.start(op, recovery, { cancellationProofHash: status.proof.proofHash, envelope, policies: recovery.policies, capturedAt: new Date(this.now()).toISOString(), windowEndsAt: recovery.windowEndsAt });
            if (intent.cancellationProofHash !== status.proof.proofHash)
                circleBlocked("cleanup86_cancellation_identity_changed");
            const submission = new CircleRpc("https://arb1.arbitrum.io/rpc", 42161, this.https);
            const preflight = async (i, grant) => {
                const guard = () => { if (grant !== undefined)
                    assertCleanup86Grant(grant, this.state.root, op, i); };
                return source.guarded(guard, () => destination.guarded(guard, () => submission.guarded(guard, async () => {
                    await this.financialGuard(op, recovery);
                    await backend.verifyCancellationAccounting(this.state, initial.request, status.proof);
                    await currentCircleDeployments(source, destination, 1329);
                    await recheckCleanup86Admission(source, evidence, cancellation);
                    await submission.identity();
                    const head = await submission.block("latest");
                    const canonical = await source.block(String(head.number));
                    if (circleHex(head.hash, 32) === "0x" + "0".repeat(64) || circleHex(canonical.hash, 32) !== circleHex(head.hash, 32) || circleUint(canonical.number) !== circleUint(head.number) || circleUint(canonical.timestamp) !== circleUint(head.timestamp))
                        circleBlocked("cleanup86_submission_canonical_anchor_changed");
                    if (circleUint(head.baseFeePerGas) * 2n > BigInt(i.envelope.maxFeePerGasAtomic) || circleUint(await source.call("eth_getBalance", [CIRCLE_SOURCE_OWNER, "pending"])) < BigInt(i.envelope.gasLimitAtomic) * BigInt(i.envelope.maxFeePerGasAtomic) || circleHex(await source.call("eth_call", [circleRpcTransaction(i.envelope), "pending"])) !== "0x" + "0".repeat(63) + "1" || await source.call("eth_getTransactionReceipt", [CLEANUP85_HASH]) !== null)
                        circleBlocked("cleanup86_fresh_network_guard");
                })));
            };
            await this.custody.assertAbsent(op);
            await executeCleanup86(this.state.root, op, intent, store, { now: this.now, preflight, confirm: (i, deadline) => exactChainConsent(["Agent Payment Node distinct Circle cleanup86", `Operation: ${op.operationId}`, `Original UNKNOWN cleanup85 ${CLEANUP85_HASH} stays retained; finalized distinct native cancellation ${status.proof.transactionHash} consumed nonce85.`, `Owner: ${op.sourceCustody.walletAddress} / eip155:42161`, `Fresh zero approval nonce86: token ${i.envelope.to}; spender ${CIRCLE_MESSENGER}; value0; USDC97924 unchanged; allowance40100→0.`, `Full native fee ceiling15000000000000; signed gas${i.envelope.gasLimitAtomic} × maxFee${i.envelope.maxFeePerGasAtomic}.`, `Immutable intent: ${i.intentHash}`, "Foreground authority lasts at most60 seconds; no old signature is replayed."], approvalCode("bridge", op.operationId, i.intentHash), deadline, this.tty),
                seal: (i, grant) => this.custody.seal(op, i, grant, () => this.financialGuard(op, recovery)),
                send: async (material, grant) => { await this.financialGuard(op, recovery); assertCleanup86Grant(grant, this.state.root, op, intent); return circleHex(await submission.call("eth_sendRawTransaction", [material.rawTransaction], () => assertCleanup86Grant(grant, this.state.root, op, intent)), 32); } });
            return op;
        });
    }
    async observe(id) {
        const initial = await this.frame(id);
        const backend = this.backend(), status = await backend.cancellation.inspect(initial.request);
        if (status.phase !== "finalized")
            return initial.op;
        if (status.proof === null || status.operationId !== status.proof.operationId || status.transactionHash !== status.proof.transactionHash)
            circleBlocked("cleanup85_cancellation_status_identity");
        return this.locked(id, status.proof, async (op, recovery, source, destination) => {
            await this.verifyCancellation(initial.request, status.proof, recovery, source);
            if (await new Cleanup85RecoveryStore(this.state.root).publicRecord(op, "cleanup86-finalized-proof") === null)
                await currentCircleDeployments(source, destination, 1329);
            const intent = await new Cleanup86Store(this.state.root).intent(op, recovery);
            if (intent === null)
                return op;
            return observeCleanup86(this.state, op, recovery, intent, status.proof, this.custody, source, this.usage, this.repo, this.now, backend.verifyCancellationAccounting);
        });
    }
    async verifyCancellation(request, proof, recovery, source) {
        if (proof.requestBinding !== hashObject(request) || hashObject(proof.sourceCustody) !== hashObject(recovery.sourceCustody) || hashObject(proof.recipientCustody) !== hashObject(recovery.recipientCustody))
            circleBlocked("cleanup85_detached_cancellation_binding");
        const observation = await verifyCancellationPublic(source, proof);
        await this.backend().verifyCancellationAccounting(this.state, request, proof);
        return observation;
    }
    async financialGuard(op, recovery) {
        assertCleanup85Window(recovery, this.now());
        for (const [profile, custody] of [[op.profile, op.sourceCustody], [op.destinationProfile, op.destinationCustody], ["default", recovery.recipientCustody]]) {
            await assertEvmNativeCustody(this.state, profile, custody);
            await assertExclusiveEvmRawSigner(this.state, custody.walletAddress, custody.profileHash);
        }
        await new OperationService(this.state).assertCircleAccountsAvailable(op, true, "cleanup");
        await this.usage.confirm(op, recovery.policies);
        await this.usage.authorizationDeadline(op, recovery.policies);
    }
    async locked(id, proof, action) {
        const initial = await this.frame(id), r = initial.recovery;
        return this.state.withLocks([`profile:${initial.op.profileHash}`, `profile:${initial.op.destinationProfileHash}`, `profile:${r.recipientCustody.profileHash}`, `operation:${id}`, `operation:${proof.operationId}`, `operation:idempotency:${initial.op.idempotencyHash}`, evmAddressLock(r.sourceCustody.walletAddress), evmAddressLock(r.destinationCustody.walletAddress), evmAddressLock(r.recipientCustody.walletAddress)], () => this.usage.withPolicyLocks([initial.op.profile, initial.op.destinationProfile, "default"], async () => {
            const fresh = await this.frame(id), { source, destination } = this.remotes();
            if (fresh.recovery.recoveryBinding !== r.recoveryBinding)
                circleBlocked("cleanup85_recovery_frame_changed");
            return action(fresh.op, fresh.recovery, source, destination);
        }));
    }
}
//# sourceMappingURL=cleanup85-recovery-runtime.js.map