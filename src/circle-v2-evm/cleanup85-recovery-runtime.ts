import { resolveCleanup85NativeLineage, verifiedCleanup85NativeLineage } from "../circle-cleanup85-unsigned-retirement.js";
import { withCleanup85FinancialScope } from "../circle-cleanup85-financial-scope.js";
import { Cleanup85UnsignedRetirementStore } from "../circle-cleanup85-unsigned-retirement-store.js";
import { verifyCleanup86RecoveryContext, verifiedCleanup86RecoveryContext } from "./cleanup85-effective-context.js";
import { assertCleanup86CurrentPermission, verifyCleanup86CurrentPurpose, type VerifiedCleanup86CurrentPurpose } from "./cleanup86-current-purpose.js";
import type { HeldCleanup85Scope } from "../circle-cleanup85-financial-scope.js";
import { ApnError, type ErrorDetails } from "../errors.js";
import { hashObject } from "../canonical.js";
import type { Cleanup85CancellationPort, Cleanup85CancellationProof, Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import { assertExclusiveEvmRawSigner, evmAddressLock } from "../evm-address-ownership.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { OperationService } from "../operation-service.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { BridgeHttps } from "../lifi/https.js";
import { exactChainConsent, type TtyTransferApprovalOptions } from "../tty-approval.js";
import { approvalCode } from "../approval-code.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, circleRoute } from "./catalog.js";
import { circleEnvelope } from "./operation-model.js";
import { CircleRepository } from "./repository.js";
import { CircleUsage } from "./usage.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest, assertCleanup85Window, CLEANUP85_HASH, type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { Cleanup86Store, type Cleanup86Intent } from "./cleanup86-store.js";
import { Cleanup86Custody } from "./cleanup86-custody.js";
import { executeCleanup86, executeFreshCleanup86, assertCleanup86Grant, type Cleanup86Grant } from "./cleanup86-controller.js";
import { observeCleanup86 } from "./cleanup86-observer.js";
import { verifyCancellationPublic } from "./cleanup85-public-proof.js";
import { prepareCleanup85Recovery } from "./cleanup85-recovery-prepare.js";
import { consumedBurnEvidence } from "./consumed-burn-rpc.js";
import { recheckCleanup86Admission } from "./cleanup86-public-admission.js";
import { CircleRpc, currentCircleDeployments, circleRpcTransaction } from "./rpc.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
import { circleHex, circleUint, circleRecord, encodeCircleApproval } from "./protocol.js";
export interface Cleanup85RecoveryDependencies {
  readonly cancellation: Cleanup85CancellationPort;
  /** Read-only independent native operation/material/claims/reservation/actual1+fee verifier. */
  readonly verifyCancellationAccounting: (state: StateStore, request: Cleanup85CancellationRequest, proof: Cleanup85CancellationProof) => Promise<void>;
}
/** Finite normal controller; money commands require the independently installed B/C backend.
 * No Circle lock is held across B.execute/inspect. Persisted proofs are never dispatch authority. */
export class Cleanup85RecoveryRuntime {
  private readonly repo: CircleRepository; private readonly usage: CircleUsage; private readonly custody: Cleanup86Custody;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly env: Readonly<Record<string, string | undefined>>, private readonly now: () => number, private readonly tty: TtyTransferApprovalOptions, private readonly https: Pick<BridgeHttps, "request">, private readonly dependencies?: Cleanup85RecoveryDependencies) {
    this.repo = new CircleRepository(state.root); this.usage = new CircleUsage(state, now); this.custody = new Cleanup86Custody(state, wrapping);
  }
  private remotes() { const route = circleRoute(1329); return { source: new CircleRpc(this.env.APN_ARBITRUM_RPC_URL ?? "https://arbitrum-one-rpc.publicnode.com", 42161, this.https, 256, this.env.APN_ARBITRUM_ARCHIVE_MIN_INTERVAL_MS ?? "0"), destination: new CircleRpc(this.env[route.rpcEnvironment] ?? route.rpcDefault, 1329, this.https, 256, this.env.APN_ARBITRUM_ARCHIVE_MIN_INTERVAL_MS ?? "0") }; }
  async publicStatus(id: string) {
    const op = await this.repo.load(id); if (op === null || op.operationId !== "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33") return null;
    const recoveryStore = new Cleanup85RecoveryStore(this.state.root), parent = await new CircleNonceRetirementStore(this.state.root).intent(op);
    if (parent === null || await recoveryStore.publicRecord(op, "intent") === null) return null;
    const recovery = await recoveryStore.load(op, parent), store = new Cleanup86Store(this.state.root), intent = await store.intent(op, recovery!);
    return { recoveryBinding: recovery!.recoveryBinding, windowEndsAt: recovery!.windowEndsAt, ...(intent === null ? {} : { cleanup86: { intentHash: intent.intentHash, envelopeHash: intent.envelope.envelopeHash, effect: await store.effect(op, intent), signClaimed: await store.claimed(op, intent, "sign"), sendClaimed: await store.claimed(op, intent, "send"), materialMetadata: await this.custody.publicMetadata(op, intent), firstPublicFailure: await store.failure(op, intent) } }) };
  }
  private backend(): Cleanup85RecoveryDependencies { if (this.dependencies === undefined || typeof this.dependencies.verifyCancellationAccounting !== "function") circleBlocked("cleanup85_verified_native_backend_required"); return this.dependencies; }
  private async frame(id: string) {
    const op = await this.repo.load(id); if (op === null) circleBlocked("cleanup85_parent_missing");
    const parent = await new CircleNonceRetirementStore(this.state.root).intent(op); if (parent === null) circleBlocked("cleanup85_parent_intent_missing");
    const recovery = await new Cleanup85RecoveryStore(this.state.root).load(op, parent); if (recovery === null) circleBlocked("explicit_cleanup85_recovery_prepare_required");
    return { op, recovery, request: cleanup85CancellationRequest(recovery) };
  }
  async cancel(id: string) {
    const backend = this.backend(), { source, destination } = this.remotes();
    const parent=await this.repo.load(id),old=parent===null?null:await new CircleNonceRetirementStore(this.state.root).intent(parent),saved=parent===null||old===null?null:await new Cleanup85RecoveryStore(this.state.root).load(parent,old);
    if(saved!==null){const request=cleanup85CancellationRequest(saved),lineage=verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(this.state,request),this.state,request),native=await this.state.findOperation(lineage.operationId);if(native!==null&&native.state!=="awaiting_approval")return backend.cancellation.inspect(request);}
    const request = await prepareCleanup85Recovery(this.state, source, destination, id, this.now);
    // B independently refuses its own durable SIGN/SEND, before any new TTY/private access.
    return backend.cancellation.execute(request);
  }
  async approve86(id: string): Promise<CircleOperationV1> {
    const initial = await this.frame(id); if (initial.op.state === "nonce_retired") return initial.op;
    const prior = await new Cleanup86Store(this.state.root).intent(initial.op, initial.recovery);
    if (prior?.version === "apn.circle-cleanup86-intent.v5") circleBlocked("cleanup86_existing_observe_only");
    if (prior?.version === "apn.circle-cleanup86-intent.v4") await new Cleanup86Store(this.state.root).unsignedPrepared(initial.op,initial.recovery);
    if (prior?.version === "apn.circle-cleanup86-intent.v3") await new Cleanup86Store(this.state.root).unsignedOrphan(initial.op,initial.recovery);
    if (prior !== null && (await new Cleanup86Store(this.state.root).claimed(initial.op, prior, "sign") || await new Cleanup86Store(this.state.root).claimed(initial.op, prior, "send"))) circleBlocked("cleanup86_claimed_observe_only");
    const backend = this.backend(), status = await backend.cancellation.inspect(initial.request);
    if (status.phase !== "finalized" || status.proof === null || status.operationId !== status.proof.operationId || status.transactionHash !== status.proof.transactionHash) circleBlocked("cleanup85_cancellation_finalized_proof_required");
    return this.locked(id, status.proof, async (op, recovery, source, destination, scope) => {
      const store = new Cleanup86Store(this.state.root), existing = await store.intent(op, recovery);
      if (existing?.version === "apn.circle-cleanup86-intent.v5") circleBlocked("cleanup86_existing_observe_only");
      const prepared = existing?.version === "apn.circle-cleanup86-intent.v4" ? await store.unsignedPrepared(op,recovery) : undefined;
      const orphan = existing?.version === "apn.circle-cleanup86-intent.v3" ? await store.unsignedOrphan(op,recovery) : undefined;
      if (existing !== null && (await store.claimed(op, existing, "sign") || await store.claimed(op, existing, "send"))) circleBlocked("cleanup86_claimed_observe_only");
      const authority=await this.financialFrame(op,recovery), current = prepared !== undefined || (existing === null || orphan !== undefined) && authority.windowEndsAt !== null && this.now() >= Date.parse(authority.windowEndsAt);
      if (!current) await this.financialGuard(op, recovery); const cancellation = await this.verifyCancellation(initial.request, status.proof!, recovery, source);
      const evidence = await consumedBurnEvidence(source, op, "cancel85");
      // Current-purpose admission repeats these complete canonical pins after the fresh quote.
      // Legacy authority still needs this first check; the cumulative 256-request cap is unchanged.
      if (!current) await currentCircleDeployments(source, destination, 1329);
      if (await source.call("eth_getTransactionReceipt", [CLEANUP85_HASH]) !== null) circleBlocked("cleanup85_original_receipt_requires_public_reconciliation");
      let envelope = (orphan === undefined && prepared === undefined ? existing?.envelope : undefined) ?? await source.envelope(CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(true), "86");
      // Late unsigned generation2 only: normal quote already captured 2*base with tip0.
      // Canonically rebind 4*captured base without another RPC; all later guards stay 2*current.
      if(prepared !== undefined) { if(envelope.maxPriorityFeePerGasAtomic!=="0") circleBlocked("cleanup86_late_priority_changed"); const {envelopeHash:_hash,...body}=envelope; envelope=circleEnvelope({...body,maxFeePerGasAtomic:(BigInt(envelope.maxFeePerGasAtomic)*2n).toString()}); }

      const certificate: VerifiedCleanup86CurrentPurpose | undefined = current ? await verifyCleanup86CurrentPurpose(this.state, op, recovery, status.proof!, envelope, source, destination, this.now, scope) : undefined;
      const financial = () => certificate === undefined ? this.financialGuard(op, recovery) : assertCleanup86CurrentPermission(certificate, this.state, op, recovery, envelope);
      const submission = new CircleRpc("https://arb1.arbitrum.io/rpc", 42161, this.https, 256, this.env.APN_ARBITRUM_ARCHIVE_MIN_INTERVAL_MS ?? "0");
      const preflightEnvelope = async (i: Pick<Cleanup86Intent, "envelope">, guard: () => void) => {
        return source.guarded(guard, () => destination.guarded(guard, () => submission.guarded(guard, async () => {
        await financial(); await backend.verifyCancellationAccounting(this.state, initial.request, status.proof!);
        await currentCircleDeployments(source, destination, 1329); await recheckCleanup86Admission(source, evidence, cancellation);
        await submission.identity(); const head = await submission.block("latest");
        const canonical = await source.block(String(head.number));
        if (circleHex(head.hash, 32) === "0x" + "0".repeat(64) || circleHex(canonical.hash, 32) !== circleHex(head.hash, 32) || circleUint(canonical.number) !== circleUint(head.number) || circleUint(canonical.timestamp) !== circleUint(head.timestamp)) circleBlocked("cleanup86_submission_canonical_anchor_changed");
        const operands: Record<string,string | boolean>={baseFeeAtomic:circleUint(head.baseFeePerGas).toString(),maxFeePerGasAtomic:i.envelope.maxFeePerGasAtomic,nativeUpperAtomic:(BigInt(i.envelope.gasLimitAtomic)*BigInt(i.envelope.maxFeePerGasAtomic)).toString()};
        const refuse=(failurePredicate:"fee"|"pendingNative"|"approveCall"|"oldReceipt"):never=>{throw new ApnError("APN_OPERATION_BLOCKED","Circle EVM operation blocked: cleanup86_fresh_network_guard.",{reason:"cleanup86_fresh_network_guard",failurePredicate,...operands} as ErrorDetails);};
        if(BigInt(operands.baseFeeAtomic as string)*2n>BigInt(i.envelope.maxFeePerGasAtomic)) refuse("fee");
        operands.pendingNativeAtomic=circleUint(await source.call("eth_getBalance",[CIRCLE_SOURCE_OWNER,"pending"])).toString();
        if(BigInt(operands.pendingNativeAtomic as string)<BigInt(operands.nativeUpperAtomic as string)) refuse("pendingNative");
        operands.approveCallResult=circleHex(await source.call("eth_call",[circleRpcTransaction(i.envelope),"pending"]));
        if(operands.approveCallResult!=="0x"+"0".repeat(63)+"1") refuse("approveCall");
        operands.oldReceiptPresent=await source.call("eth_getTransactionReceipt",[CLEANUP85_HASH])!==null;
        if(operands.oldReceiptPresent) refuse("oldReceipt");
        })));
      };
      await this.custody.assertAbsent(op);
      let intent: Cleanup86Intent;
      const publish = async () => {
        const selected = certificate !== undefined ? prepared !== undefined ? await store.startLateReprepared(this.state,op,recovery,envelope,certificate,prepared) : orphan === undefined ? await store.startCurrent(this.state, op, recovery, envelope, certificate) : await store.startReprepared(this.state, op, recovery, envelope, certificate, orphan) : existing ?? await store.start(op, recovery, { cancellationProofHash: status.proof!.proofHash, envelope, policies: authority.policies, capturedAt: new Date(this.now()).toISOString(), windowEndsAt: authority.windowEndsAt });
        if (selected.cancellationProofHash !== status.proof!.proofHash) circleBlocked("cleanup86_cancellation_identity_changed");
        intent = selected; return selected;
      };
      const preflight = (i: Cleanup86Intent, grant?: Cleanup86Grant) => preflightEnvelope(i, () => { if (grant !== undefined) assertCleanup86Grant(grant, this.state.root, op, i); });
      const ports = { now: this.now, preflight, confirm: (i: Cleanup86Intent, deadline: string) => exactChainConsent([i.version === "apn.circle-cleanup86-intent.v5" ? "Agent Payment Node Circle cleanup86 late UNSIGNED generation2" : "Agent Payment Node distinct Circle cleanup86", `Operation: ${op.operationId}`, `Original UNKNOWN cleanup85 ${CLEANUP85_HASH} stays retained; finalized distinct native cancellation ${status.proof!.transactionHash} consumed nonce85.`, `Owner: ${op.sourceCustody.walletAddress} / eip155:42161`, `Fresh zero approval nonce86: token ${i.envelope.to}; spender ${CIRCLE_MESSENGER}; value0; USDC97924 unchanged; allowance40100→0.`, `Full native fee ceiling15000000000000; signed gas${i.envelope.gasLimitAtomic} × maxFee${i.envelope.maxFeePerGasAtomic}.`, `Immutable intent: ${i.intentHash}`, "Foreground authority lasts at most60 seconds; no old signature is replayed."], approvalCode("bridge", op.operationId, i.intentHash), deadline, this.tty),
        seal: (i: Cleanup86Intent, grant: Cleanup86Grant) => certificate === undefined ? this.custody.seal(op, i, grant, financial) : this.custody.sealCurrent(op, i, grant, recovery, certificate),
        send: async (material: import("./cleanup86-custody.js").Cleanup86Material, grant: Cleanup86Grant) => { await financial(); assertCleanup86Grant(grant, this.state.root, op, intent); return circleHex(await submission.call("eth_sendRawTransaction", [material.rawTransaction], () => assertCleanup86Grant(grant, this.state.root, op, intent)), 32); } };
      if (certificate === undefined) await executeCleanup86(this.state.root, op, await publish(), store, ports);
      else await executeFreshCleanup86(this.state.root, op, envelope, store, ports, { state: this.state, recovery, certificate }, () => preflightEnvelope({ envelope }, () => {}), publish);
      return op;
    });
  }
  async observe(id: string): Promise<CircleOperationV1> {
    const initial = await this.frame(id);
    const backend = this.backend(), status = await backend.cancellation.inspect(initial.request);
    if (status.phase !== "finalized") return initial.op;
    if (status.proof === null || status.operationId !== status.proof.operationId || status.transactionHash !== status.proof.transactionHash) circleBlocked("cleanup85_cancellation_status_identity");
    return this.locked(id, status.proof, async (op, recovery, source, destination) => {
      await this.verifyCancellation(initial.request, status.proof!, recovery, source);
      if (await new Cleanup85RecoveryStore(this.state.root).publicRecord(op, "cleanup86-finalized-proof") === null) await currentCircleDeployments(source, destination, 1329);
      const intent = await new Cleanup86Store(this.state.root).intent(op, recovery); if (intent === null) return op;
      return observeCleanup86(this.state, op, recovery, intent, status.proof!, this.custody, source, this.usage, this.repo, this.now, backend.verifyCancellationAccounting);
    });
  }
  private async verifyCancellation(request: Cleanup85CancellationRequest, proof: Cleanup85CancellationProof, recovery: Cleanup85RecoveryIntent, source: CircleRpc) {
    if (proof.requestBinding !== hashObject(request) || hashObject(proof.sourceCustody) !== hashObject(recovery.sourceCustody) || hashObject(proof.recipientCustody) !== hashObject(recovery.recipientCustody)) circleBlocked("cleanup85_detached_cancellation_binding");
    const observation = await verifyCancellationPublic(source, proof); await this.backend().verifyCancellationAccounting(this.state, request, proof); return observation;
  }
  private async financialFrame(op:CircleOperationV1,recovery:Cleanup85RecoveryIntent):Promise<Cleanup85RecoveryIntent>{if(await new Cleanup85UnsignedRetirementStore(this.state.root).load()===null)return recovery;return verifiedCleanup86RecoveryContext(await verifyCleanup86RecoveryContext(this.state,op,recovery),this.state,op,recovery).readmission;}
  private async financialGuard(op: CircleOperationV1, recovery: Cleanup85RecoveryIntent): Promise<void> {
    const authority=await this.financialFrame(op,recovery); assertCleanup85Window(authority, this.now());
    for (const [profile, custody] of [[op.profile, op.sourceCustody], [op.destinationProfile, op.destinationCustody], ["default", recovery.recipientCustody]] as const) { await assertEvmNativeCustody(this.state, profile, custody); await assertExclusiveEvmRawSigner(this.state, custody.walletAddress, custody.profileHash); }
    await new OperationService(this.state).assertCircleAccountsAvailable(op, true, "cleanup"); await this.usage.confirm(op, authority.policies); await this.usage.authorizationDeadline(op, authority.policies);
  }
  private async locked<T>(id: string, proof: Cleanup85CancellationProof, action: (op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, source: CircleRpc, destination: CircleRpc, scope: HeldCleanup85Scope) => Promise<T>): Promise<T> {
    const initial = await this.frame(id), r = initial.recovery;
    return withCleanup85FinancialScope(this.state, initial.request, proof.operationId, scope => this.usage.withCleanup85HeldPolicyScope(scope, initial.request, proof.operationId, async () => {
      const fresh = await this.frame(id), { source, destination } = this.remotes(); if (fresh.recovery.recoveryBinding !== r.recoveryBinding) circleBlocked("cleanup85_recovery_frame_changed"); return action(fresh.op, fresh.recovery, source, destination, scope);
    }));
  }
}
