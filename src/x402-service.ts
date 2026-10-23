import { assertLocalNetworkProfile, isBaseUsdc, releasedX402Pair, x402Asset, x402AssetOf } from "./x402-network.js";
import { assertX402RpcChain, requireX402Rpc, selectX402Rpc } from "./x402-service-rpc.js";
import { randomBytes } from "node:crypto";
import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import type { CommandRequest } from "./commands.js";
import { BASE_USDC } from "./constants.js";
import { ApnError } from "./errors.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
import { evmConflictDomain, sharedEvmConflictDomain } from "./operation-conflict-domain.js";
import {
  assertUnattendedX402Balance,
  effectiveX402Cap,
  requireProfilePolicy,
  x402PayeeAdmittedOffers,
} from "./profile-policy.js";
import { candidatesWithinCap, canonicalPrepareUrl, freshChallenge, positiveCap } from "./x402-policy.js";
import { readAndSelectX402Offer, x402PaymentIdentifier } from "./x402-prepare-select.js";
import {
  appendX402Transition,
  publicX402Operation,
  sealX402Operation,
  x402AuthorizationIntentHash,
  x402Fingerprint,
  x402RequestHash,
  type X402OperationRecord,
  type X402SettlementWaitProjection,
} from "./x402-state-integrity.js";
import type { X402SealedPaymentMaterial } from "./provider-ports.js";

type X402PrepareRequest = Extract<CommandRequest, { readonly command: "x402.fetch.prepare" }>;
type X402ApproveRequest = Extract<CommandRequest, { readonly command: "x402.fetch.approve" }>;
import { X402PaidRequest } from "./x402-paid-request.js";
import {
  assertWaitRpcProvenance,
  remainingWaitMs,
  waitOutcome,
  waitTimeout,
  boundedX402ReadPort,
  isPostExposureWaitState,
  isRecoverableX402RpcObservationFailure,
  x402ReadPort,
} from "./x402-service-rpc.js";
import { ProviderX402Service } from "./provider-x402-service.js";
import { isCode } from "./secure-state-store.js";
import { resolveX402Payer } from "./x402-payer.js";
import { reconcileX402Method } from "./x402-method-reconciliation.js";
import { optionalX402HttpRequest } from "./x402-http-request.js";
import { assertCurrentX402Payee } from "./x402-network-policy.js";

export class X402Service extends X402PaidRequest {
  private readonly providerX402: ProviderX402Service;

  constructor(context: RuntimeContext) {
    super(context);
    this.providerX402 = new ProviderX402Service(context);
  }

  async prepare(request: X402PrepareRequest): Promise<unknown> {
    const network = x402Asset(request.chainId ?? 8453, request.asset);
    await assertLocalNetworkProfile(this.context, request.profile, network);
    const httpRequest = optionalX402HttpRequest(request.url, request.httpRequest);
    const requestFields = httpRequest === undefined ? {} : { httpRequest };
    if (isBaseUsdc(network) && await this.providerX402.canHandle(request.profile)) return await this.providerX402.prepare(request);
    const profile = canonicalProfile(request.profile);
    const idempotencyKey = canonicalIdempotencyKey(request.idempotencyKey);
    const callerCap = request.maxAmountAtomic === undefined ? undefined : positiveCap(request.maxAmountAtomic);
    const endpoint = canonicalPrepareUrl(request.url);
    const canonicalUrl = endpoint.toString(); await this.context.ready();
    const state = this.context.state;
    const profileHash = state.profileHash(profile);
    const operationId = state.operationId(profile, idempotencyKey);
    const idempotencyHash = state.idempotencyHash(idempotencyKey);

    return await state.withLocks([
      `profile:${profileHash}`,
      `operation:${operationId}`,
      `operation:idempotency:${idempotencyHash}`,
    ], async () => {
      const existingAtExpectedId = await state.loadX402Operation(profileHash, operationId);
      const provisionalCap = callerCap === undefined
        ? existingAtExpectedId?.capAtomic ?? "0"
        : callerCap;
      const provisionalRequestHash = x402RequestHash({ profile, canonicalUrl, capAtomic: provisionalCap, chainId: network.chainId, token: network.token, ...requestFields });
      const existing = await this.operations.resolvePrepare({
        kind: "x402_fetch",
        profileHash,
        operationId,
        idempotencyHash,
        requestHash: provisionalRequestHash,
      });
      if (existing !== null) return publicX402Operation(existing.record as X402OperationRecord);
      const payer = await resolveX402Payer(this.context, profileHash, network);
      const profilePolicy = requireProfilePolicy(
        await this.context.requirePolicy().load(payer.policy),
      );
      const capAtomic = effectiveX402Cap(profilePolicy, callerCap);
      const requestHash = x402RequestHash({ profile, canonicalUrl, capAtomic, chainId: network.chainId, token: network.token, ...requestFields });
      // The account claim is written before the seller challenge and any RPC read, and dropped if no operation is written.
      // EIP-3009 uses its own random nonce: purchases share the account, but nonce and EIP-7702 spenders still exclude them.
      return await this.operations.admit({ kind: "x402_fetch", profileHash, operationId, idempotencyHash, requestHash },
        { domains: () => [payer.transferMethod === "eip3009" ? sharedEvmConflictDomain(network.chainId, payer.wallet)
          : evmConflictDomain(network.chainId, payer.wallet)] }, async () => {
      const wallet = payer.wallet;
      const http = this.context.requireHttp();
      const rpc = selectX402Rpc(requireX402Rpc(this.context, network), network);
      const discovered = await freshChallenge(http, canonicalUrl, httpRequest, network);
      // The owner's optional payee pin narrows the offers before selection (checked again before signing and the first send).
      const underCap = x402PayeeAdmittedOffers(profilePolicy, candidatesWithinCap(discovered, capAtomic));
      const createdAtDate = new Date(Math.floor(this.context.clock.now().getTime() / 1000) * 1000);
      const createdAt = createdAtDate.toISOString();
      const createdAtUnix = Math.floor(createdAtDate.getTime() / 1000).toString();
      const invocationStartedAtMs = this.context.clock.now().getTime();
      const chain = await assertX402RpcChain(rpc, network.chainId);
      // The authorization nonce is drawn first: prepare proves it reads unused (EIP-3009 state or Permit2 nonce bit).
      const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
      const evidence = await readAndSelectX402Offer({ profile, rpc, rpcOrigin: chain.rpcOrigin, discovered, underCap, wallet, asset: network,
        transferMethod: payer.transferMethod, permit2Signer: payer.providerSigner === undefined && payer.delegated === undefined, nonce,
        startedAtMs: invocationStartedAtMs, nowMs: () => this.context.clock.now().getTime() });
      const selected = evidence.selected;
      assertUnattendedX402Balance(profilePolicy, evidence.balanceAtomic);
      const delegatedMaterial = payer.delegated === undefined ? undefined : await payer.delegated.port.prepare({
        profile,
        profileHash,
        profileRevision: payer.delegated.profileRevision,
        capabilityHash: payer.delegated.capabilityHash,
        accountBindingHash: payer.delegated.accountBindingHash,
        wallet,
        token: BASE_USDC,
        payee: selected.payee,
        amountAtomic: selected.amountAtomic,
        capAtomic,
        offerHash: selected.selectedOffer.offerHash,
        requirements: selected.requirements as unknown as Readonly<Record<string, unknown>>,
        facilitatorAddresses: selected.selectedOffer.resolved.assetTransferMethod === "erc7710"
          ? selected.selectedOffer.resolved.facilitatorAddresses
          : [],
        preparedAtUnix: createdAtUnix,
        maxTimeoutSeconds: selected.maxTimeoutSeconds,
        rpcOriginHash: sha256(chain.rpcOrigin),
      });
      const paymentIdentifier = x402PaymentIdentifier(discovered.paymentRequired, operationId, selected.selectedOffer.resolved.assetTransferMethod);
      const resourceCanonicalJson = canonicalJson(discovered.paymentRequired.resource);
      const authorizationBase = {
        from: wallet,
        to: selected.payee.toLowerCase() as `0x${string}`,
        value: selected.amountAtomic,
        validAfter: "0" as const,
        validBefore: delegatedMaterial?.effectiveExpiryUnix ??
          (BigInt(createdAtUnix) + BigInt(selected.maxTimeoutSeconds)).toString(),
        nonce,
        createdAt: createdAtUnix,
      };
      const resource = {
        ...requestFields,
        canonicalUrl,
        origin: endpoint.origin,
        path: endpoint.pathname,
        urlHash: sha256(canonicalUrl),
      };
      const fingerprintInput = {
        kind: "x402_fetch" as const,
        profile,
        operationId,
        resource,
        chainId: network.chainText,
        network: network.network,
        token: network.token.toLowerCase() as `0x${string}`,
        capAtomic,
        selectedOffer: selected.selectedOffer,
        wallet,
        ...(payer.providerSigner === undefined ? {} : { providerSigner: payer.providerSigner }),
        ...(delegatedMaterial === undefined ? {} : { delegatedMaterial }),
        ...(paymentIdentifier === undefined ? {} : { paymentIdentifier }),
      };
      const initial = {
        at: createdAt,
        state: "awaiting_approval" as const,
        terminal: false,
        reason: "x402_awaiting_authorization" as const,
        proofClass: "x402_frozen_offer" as const,
      };
      const operation = sealX402Operation({
        schemaVersion: "apn.x402.state.v1",
        kind: "x402_fetch",
        operationId,
        idempotencyHash,
        profile,
        profileHash,
        requestHash,
        fingerprint: x402Fingerprint(fingerprintInput),
        resource,
        sellerWire: {
          resourceCanonicalJson,
          resourceHash: domainHash("apn.x402.resource.v1", resourceCanonicalJson),
        },
        chainId: network.chainText,
        network: network.network,
        token: network.token.toLowerCase() as `0x${string}`,
        wallet,
        payee: authorizationBase.to,
        amountAtomic: selected.amountAtomic,
        capAtomic,
        selectedOffer: selected.selectedOffer,
        ...(releasedX402Pair(network.chainId, network.token) || evidence.decimals === undefined ? {}
          : { tokenFacts: { decimals: evidence.decimals, proofTag: network.proofTag } }),
        ...(payer.providerSigner === undefined ? {} : { providerSigner: payer.providerSigner }),
        ...(delegatedMaterial === undefined ? {} : { delegatedMaterial }),
        preparedBlock: {
          number: evidence.block.number,
          hash: evidence.block.hash,
          observedAt: evidence.observedAt,
        },
        ...(paymentIdentifier === undefined ? {} : { paymentIdentifier }),
        authorization: { ...authorizationBase, intentHash: x402AuthorizationIntentHash(authorizationBase) },
        attempts: [],
        state: initial.state,
        finalityClass: "pre_effect",
        terminal: initial.terminal,
        reason: initial.reason,
        proofClass: initial.proofClass,
        nextActions: ["x402.fetch.approve", "operation.status"],
        createdAt,
        updatedAt: createdAt,
        transitions: appendX402Transition([], initial),
      });
      await state.writeX402Operation(operation);
      return publicX402Operation(operation);
      });
    });
  }

  async approve(request: X402ApproveRequest): Promise<unknown> {
    const operationId = canonicalOperationId(request.operationId);
    await this.context.ready();
    const found = await this.operations.required(operationId);
    if (found.kind !== "x402_fetch") throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
    if (found.strategy === "provider_atomic") return await this.providerX402.approve(operationId);
    if (found.record.terminal) return publicX402Operation(found.record);
    return await this.withOperationLock(found.record, async (current) => {
      if (current.terminal) return publicX402Operation(current);
      if (current.state !== "awaiting_approval") {
        throw new ApnError("APN_OPERATION_BLOCKED", "x402 operation is already authorized; use operation resume.");
      }
      // Nothing was signed yet, so an approval after validBefore ends with no effect instead of a stranded signature.
      if (this.authorizationExpired(current)) return publicX402Operation(await this.commitTerminal(current, "failed_before_effect"));
      // The owner's payee pin is re-read before any hold or signature (and again inside authorization and before the first send).
      await assertCurrentX402Payee(this.context, current);
      // The shared daily usage sees this spend before anything is signed.
      await this.usage.reserve(current);
      const pending = await this.transition(current, "authorization_material_pending");
      return await this.completeAuthorization(pending, "create");
    });
  }

  async resume(
    operationIdInput: string,
    waitSeconds?: number,
  ): Promise<X402SettlementWaitProjection | undefined> {
    const operationId = canonicalOperationId(operationIdInput);
    if (waitSeconds !== undefined && (!Number.isSafeInteger(waitSeconds) || waitSeconds < 1 || waitSeconds > 300)) {
      throw new ApnError("APN_INVALID_INPUT", "Settlement wait must be an integer from 1 through 300 seconds.");
    }
    const deadline = waitSeconds === undefined ? undefined : this.context.wait.nowMs() + waitSeconds * 1_000;
    await this.context.ready();
    const found = await this.operations.required(operationId);
    if (found.kind !== "x402_fetch") throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
    if (found.strategy === "provider_atomic") return await this.providerX402.resume(operationId, waitSeconds);
    if (waitSeconds !== undefined) {
      if (["awaiting_approval", "authorization_material_pending"].includes(found.record.state)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Settlement wait requires an authorized or post-exposure x402 operation.");
      }
      const remaining = remainingWaitMs(deadline as number, this.context.wait.nowMs());
      if (remaining < 1) return waitTimeout(waitSeconds, 0);
      const waitRpc = boundedX402ReadPort(requireX402Rpc(this.context, x402AssetOf(found.record)), Math.min(20_000, remaining), x402AssetOf(found.record));
      try { await assertWaitRpcProvenance(waitRpc, found.record); }
      catch (error) {
        if (remainingWaitMs(deadline as number, this.context.wait.nowMs()) < 1) return waitTimeout(waitSeconds, 0);
        throw error;
      }
    }
    if (found.record.terminal) {
      return waitSeconds === undefined ? undefined : waitOutcome("completed", waitSeconds, 0);
    }
    try { await this.resumeOnce(found.record, deadline); }
    catch (error) {
      if (waitSeconds !== undefined && (
        isCode(error, "APN_STATE_BUSY") || remainingWaitMs(deadline as number, this.context.wait.nowMs()) < 1
      )) return waitTimeout(waitSeconds, 0);
      throw error;
    }
    if (waitSeconds === undefined) return undefined;
    return await this.waitForSettlement(found.record.operationId, waitSeconds, deadline as number);
  }

  async recoverRead(operationIdInput: string): Promise<void> {
    const operationId = canonicalOperationId(operationIdInput);
    const found = await this.operations.required(operationId);
    if (found.kind === "x402_fetch" && found.strategy === "provider_atomic") {
      await this.providerX402.recoverRead(operationId);
    }
  }

  private async resumeOnce(initial: X402OperationRecord, deadline?: number): Promise<unknown> {
    if (initial.terminal) return publicX402Operation(initial);
    const remaining = deadline === undefined ? undefined : remainingWaitMs(deadline, this.context.wait.nowMs());
    if (remaining !== undefined && remaining < 1) throw new ApnError("APN_STATE_BUSY", "Settlement wait deadline elapsed before lock acquisition.");
    return await this.withOperationLock(initial, async (current) => {
      if (current.terminal) return publicX402Operation(current);
      const receiptRecovered = await this.recoverOrphanReceipt(current);
      if (receiptRecovered !== null) return publicX402Operation(receiptRecovered);
      if (current.state === "awaiting_approval") {
        throw new ApnError("APN_OPERATION_BLOCKED", "x402 operation still requires explicit fetch approve.");
      }
      if (current.state === "authorization_material_pending") {
        const pendingCount = current.transitions.filter((transition) => transition.state === "authorization_material_pending").length;
        return await this.completeAuthorization(current, pendingCount === 1 ? "get" : "create");
      }

      const lastAttempt = current.attempts.at(-1);
      let operation = current.state === "paid_request_pending"
        ? await this.markInterruptedPaidAttempt(current, "effect_unknown")
        : current.state === "seller_result_recovery_pending" &&
            lastAttempt?.purpose === "result_recovery" && lastAttempt.phase === "pending"
          ? await this.markInterruptedPaidAttempt(current, "seller_result_recovery_pending")
          : current;
      operation = await this.recoverOrphanResult(operation);
      operation = await this.finishReconciledEvidence(operation);
      if (operation.terminal) return publicX402Operation(operation);
      const expiredUnexposed = await this.closeExpiredUnexposed(operation);
      if (expiredUnexposed !== null) return publicX402Operation(expiredUnexposed);
      const rpc = requireX402Rpc(this.context, x402AssetOf(operation));
      const rpcRemaining = deadline === undefined ? undefined : remainingWaitMs(deadline, this.context.wait.nowMs());
      if (rpcRemaining !== undefined && rpcRemaining < 1) return publicX402Operation(operation);
      const x402Rpc = rpcRemaining === undefined
        ? x402ReadPort(rpc, x402AssetOf(operation))
        : boundedX402ReadPort(rpc, Math.min(20_000, rpcRemaining), x402AssetOf(operation));
      let verified: X402SealedPaymentMaterial | undefined;
      let unusedAtSafe = false;
      try {
        const reconciled = await reconcileX402Method(x402Rpc, this.context.clock, {
          persist: async (next) => await this.context.state.writeX402Operation(next),
        }, operation);
        operation = reconciled.operation;
        unusedAtSafe = reconciled.unusedAtSafe;
      } catch (error) {
        if (isRecoverableX402RpcObservationFailure(error)) {
          const durable = await this.context.state.loadX402Operation(operation.profileHash, operation.operationId);
          if (durable === null) throw new ApnError("APN_STATE_CORRUPT", "Durable x402 operation disappeared during RPC recovery.");
          return publicX402Operation(durable);
        }
        throw error;
      }
      operation = await this.finishReconciledEvidence(operation);
      if (operation.terminal) return publicX402Operation(operation);

      if (operation.state === "authorized_not_sent") {
        if (operation.selectedOffer.resolved.assetTransferMethod === "erc7710") {
          if (this.authorizationExpired(operation)) {
            return publicX402Operation(await this.commitTerminal(operation, "failed_before_effect"));
          }
          verified = await this.recoverPaymentMaterial(operation);
          if (verified === undefined) return publicX402Operation(operation);
        } else {
          // First send only after this resume read the nonce as unused at the safe head; the pending attempt marker keeps it at most once.
          if (!unusedAtSafe) return publicX402Operation(operation);
          verified = await this.recoverPaymentMaterial(operation);
          if (verified === undefined) return publicX402Operation(operation);
        }
        if (verified === undefined) return publicX402Operation(operation);
        return await this.sendPaidRequest(operation, "payment", verified, false, deadline);
      }

      if (operation.state === "seller_result_recovery_pending") {
        if (operation.resultLink !== undefined) {
          return publicX402Operation(await this.finishReconciledEvidence(operation));
        }
        if (this.authorizationExpired(operation) && operation.settlementEvidence !== undefined) {
          return publicX402Operation(await this.commitTerminal(operation, "failed_settled_without_result"));
        }
        const recoveryAttempt = operation.attempts.find((attempt) => attempt.purpose === "result_recovery");
        if (recoveryAttempt?.phase === "pending") {
          return publicX402Operation(operation);
        }
        if (recoveryAttempt !== undefined) {
          return publicX402Operation(await this.commitTerminal(operation, "failed_settled_without_result"));
        }
        if (verified === undefined) {
          verified = await this.recoverPaymentMaterial(operation);
          if (verified === undefined) return publicX402Operation(operation);
        }
        return await this.sendPaidRequest(operation, "result_recovery", verified, true, deadline);
      }

      // One resend of the byte-identical header after an ambiguous attempt, only while the nonce reads unused at safe.
      const paymentAttemptCount = operation.attempts.filter((attempt) => attempt.purpose === "payment").length;
      if (
        operation.selectedOffer.resolved.assetTransferMethod !== "erc7710" &&
        operation.transactionHint === undefined && operation.settlementResponseObservation === undefined &&
        operation.settlementEvidence === undefined && operation.unusedExpiryEvidence === undefined && operation.resultLink === undefined &&
        unusedAtSafe && paymentAttemptCount === 1 && operation.attempts.length === 1 &&
        operation.state === "effect_unknown"
      ) {
        verified = await this.recoverPaymentMaterial(operation);
        if (verified === undefined) return publicX402Operation(operation);
        return await this.sendPaidRequest(operation, "payment", verified, true, deadline);
      }
      return publicX402Operation(operation);
    }, remaining);
  }

  private async waitForSettlement(
    operationId: string,
    waitSeconds: number,
    deadline: number,
  ): Promise<X402SettlementWaitProjection> {
    let observations = 0;
    while (remainingWaitMs(deadline, this.context.wait.nowMs()) >= 1) {
      const current = await this.operations.required(operationId);
      if (current.kind !== "x402_fetch" || current.strategy !== "local") throw new ApnError("APN_STATE_CORRUPT", "x402 operation changed strategy during settlement wait.");
      if (current.record.terminal) return waitOutcome("completed", waitSeconds, observations);
      if (!isPostExposureWaitState(current.record)) {
        // An authorization APN never sent and the chain shows no settlement of (an expired one waits for FINALIZED to prove
        // it unused, QA 0.5.67): there is nothing to wait for, so the operation answers as a plain resume does.
        if (current.record.state === "authorized_not_sent" && current.record.settlementEvidence === undefined &&
          !current.record.attempts.some((attempt) => attempt.purpose === "payment")) return waitOutcome("not_exposed", waitSeconds, observations);
        throw new ApnError("APN_OPERATION_BLOCKED", "x402 operation has no proven post-exposure state to observe.");
      }
      await this.reconcileOnly(current.record, deadline);
      observations += 1;
      const observed = await this.operations.required(operationId);
      if (observed.kind !== "x402_fetch" || observed.strategy !== "local") throw new ApnError("APN_STATE_CORRUPT", "x402 operation changed strategy during settlement wait.");
      if (observed.record.terminal) return waitOutcome("completed", waitSeconds, observations);
      const remaining = remainingWaitMs(deadline, this.context.wait.nowMs());
      if (remaining <= 0) break;
      const result = await this.context.wait.wait(Math.min(5_000, Math.max(1, Math.floor(remaining))));
      if (result === "interrupted") return waitOutcome("interrupted", waitSeconds, observations);
    }
    return waitOutcome("timeout", waitSeconds, observations);
  }

  private async reconcileOnly(operation: X402OperationRecord, deadline: number): Promise<void> {
    const lockWaitMs = remainingWaitMs(deadline, this.context.wait.nowMs());
    if (lockWaitMs < 1) return;
    try { await this.withOperationLock(operation, async (current) => {
      if (current.terminal) return publicX402Operation(current);
      const receiptRecovered = await this.recoverOrphanReceipt(current);
      if (receiptRecovered !== null) return publicX402Operation(receiptRecovered);
      let next = await this.recoverOrphanResult(current);
      next = await this.finishReconciledEvidence(next);
      if (next.terminal) return publicX402Operation(next);
      const remaining = remainingWaitMs(deadline, this.context.wait.nowMs());
      if (remaining < 1) return publicX402Operation(next);
      const x402Rpc = boundedX402ReadPort(requireX402Rpc(this.context, x402AssetOf(next)), Math.min(20_000, remaining), x402AssetOf(next));
      try {
        next = (await reconcileX402Method(x402Rpc, this.context.clock, {
          persist: async (value) => await this.context.state.writeX402Operation(value),
        }, next)).operation;
        next = await this.finishReconciledEvidence(next);
      } catch (error) {
        if (!(error instanceof ApnError) || error.code !== "APN_RPC_AMBIGUOUS") throw error;
      }
      return publicX402Operation(next);
    }, lockWaitMs); }
    catch (error) {
      if (!isCode(error, "APN_STATE_BUSY")) throw error;
    }
  }

}
