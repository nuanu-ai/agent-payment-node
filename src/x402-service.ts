import { randomBytes } from "node:crypto";
import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import type { CommandRequest } from "./commands.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { ApnError } from "./errors.js";
import { OperationService } from "./operation-service.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalIdempotencyKey } from "./transfer-policy.js";
import { canonicalOperationId } from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
import {
  assertUnattendedX402Balance,
  effectiveX402Cap,
  policyBinding,
  requireProfilePolicy,
} from "./profile-policy.js";
import { decodeAndNormalizePaymentResponseHeader } from "./x402-codec.js";
import { observePaidX402Response, type PaidHttpResult } from "./x402-http.js";
import type { RpcPort, X402RpcPort } from "./ports.js";
import {
  candidatesWithinCap,
  canonicalPrepareUrl,
  freshChallenge,
  paymentIdentifierState,
  positiveCap,
  selectPrepareOffer,
} from "./x402-policy.js";
import {
  appendX402Transition,
  publicX402Operation,
  sealX402Operation,
  sealX402Receipt,
  sealX402Result,
  x402AuthorizationIntentHash,
  x402Fingerprint,
  x402OperationBindingHash,
  x402RequestHash,
  x402TransactionHintSourceBindingHash,
  type SettlementResponseObservation,
  type TransactionHint,
  type X402Attempt,
  type X402OperationRecord,
  type X402ProofClass,
  type X402Reason,
  type X402State,
  type X402TerminalState,
  type X402SettlementWaitProjection,
} from "./x402-state-integrity.js";
import { X402RpcReconciler } from "./x402-rpc-reconciler.js";
import {
  isNativeNotFound,
  isNativeExpired,
  isTransientNativeFailure,
  requestX402Authorization,
  x402NativeRequest,
  type VerifiedX402PaymentMaterial,
} from "./x402-native.js";

type X402PrepareRequest = Extract<CommandRequest, { readonly command: "x402.fetch.prepare" }>;
type X402ApproveRequest = Extract<CommandRequest, { readonly command: "x402.fetch.approve" }>;
import { X402PaidRequest } from "./x402-paid-request.js";
import {
  assertWaitRpcProvenance,
  boundedX402ReadPort,
  isPostExposureWaitState,
  isRecoverableX402RpcObservationFailure,
  x402ReadPort,
} from "./x402-service-rpc.js";

export class X402Service extends X402PaidRequest {
  async prepare(request: X402PrepareRequest): Promise<unknown> {
    const profile = canonicalProfile(request.profile);
    const idempotencyKey = canonicalIdempotencyKey(request.idempotencyKey);
    const callerCap = request.maxAmountAtomic === undefined ? undefined : positiveCap(request.maxAmountAtomic);
    const endpoint = canonicalPrepareUrl(request.url);
    const canonicalUrl = endpoint.toString();
    await this.context.ready();
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
      const provisionalRequestHash = x402RequestHash({ profile, canonicalUrl, capAtomic: provisionalCap });
      const existing = await this.operations.resolvePrepare({
        kind: "x402_fetch",
        profileHash,
        operationId,
        idempotencyHash,
        requestHash: provisionalRequestHash,
      });
      if (existing !== null) return publicX402Operation(existing.record as X402OperationRecord);
      await this.operations.assertProfileAvailable(profileHash);

      const walletRecord = await state.loadWallet(profileHash);
      if (walletRecord === null) throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
      const profilePolicy = requireProfilePolicy(
        await this.context.requirePolicy().load(policyBinding(walletRecord)),
      );
      const capAtomic = effectiveX402Cap(profilePolicy, callerCap);
      const requestHash = x402RequestHash({ profile, canonicalUrl, capAtomic });
      const wallet = walletRecord.address.toLowerCase() as `0x${string}`;
      const http = this.context.requireHttp();
      const rpc = this.context.requireRpc();
      const discovered = await freshChallenge(http, canonicalUrl);
      const underCap = candidatesWithinCap(discovered, capAtomic);
      const invocationStartedAtMs = this.context.clock.now().getTime();
      const chain = await rpc.assertBaseChain();
      const evidence = await rpc.getX402PrepareEvidence(wallet);
      const invocationCompletedAtMs = this.context.clock.now().getTime();
      const selected = selectPrepareOffer(discovered, underCap, evidence, wallet, {
        rpcOriginHash: sha256(chain.rpcOrigin),
        invocationStartedAtMs,
        invocationCompletedAtMs,
      });
      assertUnattendedX402Balance(profilePolicy, evidence.usdcAtomic);
      const paymentIdentifier = paymentIdentifierState(discovered.paymentRequired, operationId);
      const resourceCanonicalJson = canonicalJson(discovered.paymentRequired.resource);
      const createdAtDate = new Date(Math.floor(this.context.clock.now().getTime() / 1000) * 1000);
      const createdAt = createdAtDate.toISOString();
      const createdAtUnix = Math.floor(createdAtDate.getTime() / 1000).toString();
      const authorizationBase = {
        from: wallet,
        to: selected.payee.toLowerCase() as `0x${string}`,
        value: selected.amountAtomic,
        validAfter: "0" as const,
        validBefore: (BigInt(createdAtUnix) + BigInt(selected.maxTimeoutSeconds)).toString(),
        nonce: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
        createdAt: createdAtUnix,
      };
      const resource = {
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
        chainId: "8453" as const,
        network: CHAIN_CAIP2,
        token: BASE_USDC.toLowerCase() as `0x${string}`,
        capAtomic,
        selectedOffer: selected.selectedOffer,
        wallet,
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
        chainId: "8453",
        network: CHAIN_CAIP2,
        token: BASE_USDC.toLowerCase() as `0x${string}`,
        wallet,
        payee: authorizationBase.to,
        amountAtomic: selected.amountAtomic,
        capAtomic,
        selectedOffer: selected.selectedOffer,
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
  }

  async approve(request: X402ApproveRequest): Promise<unknown> {
    const operationId = canonicalOperationId(request.operationId);
    await this.context.ready();
    const found = await this.operations.required(operationId);
    if (found.kind !== "x402_fetch") throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
    if (found.record.terminal) return publicX402Operation(found.record);
    return await this.withOperationLock(found.record, async (current) => {
      if (current.terminal) return publicX402Operation(current);
      if (current.state !== "awaiting_approval") {
        throw new ApnError("APN_OPERATION_BLOCKED", "x402 operation is already authorized; use operation resume.");
      }
      const pending = await this.transition(current, "authorization_material_pending");
      return await this.completeAuthorization(pending, "create");
    });
  }

  async resume(
    operationIdInput: string,
    waitSeconds?: number,
  ): Promise<X402SettlementWaitProjection | undefined> {
    const operationId = canonicalOperationId(operationIdInput);
    await this.context.ready();
    const found = await this.operations.required(operationId);
    if (found.kind !== "x402_fetch") throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
    if (waitSeconds !== undefined) {
      if (!Number.isSafeInteger(waitSeconds) || waitSeconds < 1 || waitSeconds > 300) {
        throw new ApnError("APN_INVALID_INPUT", "Settlement wait must be an integer from 1 through 300 seconds.");
      }
      if (["awaiting_approval", "authorization_material_pending"].includes(found.record.state)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Settlement wait requires an authorized or post-exposure x402 operation.");
      }
      const waitRpc = boundedX402ReadPort(
        this.context.requireRpc(),
        Math.min(20_000, waitSeconds * 1_000),
      );
      if (waitRpc === null) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Settlement wait requires the read-only x402 RPC surface.");
      }
      await assertWaitRpcProvenance(waitRpc, found.record);
    }
    if (found.record.terminal) {
      return waitSeconds === undefined ? undefined : {
        outcome: "completed",
        requestedSeconds: waitSeconds.toString(),
        observationCount: "0",
      };
    }
    await this.resumeOnce(found.record);
    if (waitSeconds === undefined) return undefined;
    return await this.waitForSettlement(found.record.operationId, waitSeconds);
  }

  private async resumeOnce(initial: X402OperationRecord): Promise<unknown> {
    if (initial.terminal) return publicX402Operation(initial);
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

      const rpc = this.context.requireRpc();
      const x402Rpc = x402ReadPort(rpc);
      let verified: VerifiedX402PaymentMaterial | undefined;
      let completeZeroScanValidated = false;
      let completeZeroScanRead = false;
      if (x402Rpc !== null) {
        let reconciled;
        try {
          reconciled = await new X402RpcReconciler(x402Rpc, this.context.clock, {
            persist: async (next) => await this.context.state.writeX402Operation(next),
          }).reconcile(operation);
        } catch (error) {
          if (isRecoverableX402RpcObservationFailure(error)) {
            const durable = await this.context.state.loadX402Operation(operation.profileHash, operation.operationId);
            if (durable === null) throw new ApnError("APN_STATE_CORRUPT", "Durable x402 operation disappeared during RPC recovery.");
            return publicX402Operation(durable);
          }
          throw error;
        }
        operation = reconciled.operation;
        completeZeroScanValidated = reconciled.completeZeroScanValidated;
        completeZeroScanRead = reconciled.completeZeroScanRead;
        operation = await this.finishReconciledEvidence(operation);
        if (operation.terminal) return publicX402Operation(operation);
      }

      if (operation.state === "authorized_not_sent") {
        if (x402Rpc !== null) {
          if (!completeZeroScanValidated) return publicX402Operation(operation);
          verified = await this.recoverPaymentMaterial(operation);
          if (verified === undefined) return publicX402Operation(operation);
        } else {
          verified = await this.recoverPaymentMaterial(operation);
          if (verified === undefined) return publicX402Operation(operation);
          await this.assertLegacySafeRead(operation);
        }
        if (verified === undefined) return publicX402Operation(operation);
        return await this.sendPaidRequest(operation, "payment", verified);
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
          if (x402Rpc === null) await this.assertLegacySafeRead(operation);
        }
        return await this.sendPaidRequest(operation, "result_recovery", verified, x402Rpc !== null);
      }

      const scanStatus = operation.authorizationUsedScan?.status;
      const paymentAttemptCount = operation.attempts.filter((attempt) => attempt.purpose === "payment").length;
      if (
        operation.transactionHint === undefined && operation.settlementResponseObservation === undefined &&
        operation.settlementEvidence === undefined && operation.resultLink === undefined &&
        scanStatus === "complete" && operation.authorizationUsedScan?.candidates.length === 0 &&
        completeZeroScanValidated && completeZeroScanRead && paymentAttemptCount === 1 && operation.attempts.length === 1 &&
        operation.state === "effect_unknown" && x402Rpc !== null
      ) {
        verified = await this.recoverPaymentMaterial(operation);
        if (verified === undefined) return publicX402Operation(operation);
        return await this.sendPaidRequest(operation, "payment", verified, true);
      }
      return publicX402Operation(operation);
    });
  }

  private async waitForSettlement(
    operationId: string,
    waitSeconds: number,
  ): Promise<X402SettlementWaitProjection> {
    const deadline = this.context.wait.nowMs() + waitSeconds * 1000;
    let observations = 0;
    while (this.context.wait.nowMs() < deadline) {
      const current = await this.operations.required(operationId);
      if (current.kind !== "x402_fetch") throw new ApnError("APN_STATE_CORRUPT", "x402 operation changed kind during settlement wait.");
      if (current.record.terminal) {
        return {
          outcome: "completed",
          requestedSeconds: waitSeconds.toString(),
          observationCount: observations.toString(),
        };
      }
      if (!isPostExposureWaitState(current.record)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "x402 operation has no proven post-exposure state to observe.");
      }
      await this.reconcileOnly(current.record, deadline);
      observations += 1;
      const observed = await this.operations.required(operationId);
      if (observed.kind !== "x402_fetch") throw new ApnError("APN_STATE_CORRUPT", "x402 operation changed kind during settlement wait.");
      if (observed.record.terminal) {
        return {
          outcome: "completed",
          requestedSeconds: waitSeconds.toString(),
          observationCount: observations.toString(),
        };
      }
      const remaining = deadline - this.context.wait.nowMs();
      if (remaining <= 0) break;
      const result = await this.context.wait.wait(Math.min(5_000, Math.max(1, Math.floor(remaining))));
      if (result === "interrupted") {
        return {
          outcome: "interrupted",
          requestedSeconds: waitSeconds.toString(),
          observationCount: observations.toString(),
        };
      }
    }
    return {
      outcome: "timeout",
      requestedSeconds: waitSeconds.toString(),
      observationCount: observations.toString(),
    };
  }

  private async reconcileOnly(operation: X402OperationRecord, deadline: number): Promise<void> {
    await this.withOperationLock(operation, async (current) => {
      if (current.terminal) return publicX402Operation(current);
      const receiptRecovered = await this.recoverOrphanReceipt(current);
      if (receiptRecovered !== null) return publicX402Operation(receiptRecovered);
      let next = await this.recoverOrphanResult(current);
      next = await this.finishReconciledEvidence(next);
      if (next.terminal) return publicX402Operation(next);
      const remaining = Math.floor(deadline - this.context.wait.nowMs());
      if (remaining < 1) return publicX402Operation(next);
      const x402Rpc = boundedX402ReadPort(this.context.requireRpc(), Math.min(20_000, remaining));
      if (x402Rpc === null) throw new ApnError("APN_OPERATION_BLOCKED", "Settlement wait requires the read-only x402 RPC surface.");
      try {
        const reconciled = await new X402RpcReconciler(x402Rpc, this.context.clock, {
          persist: async (value) => await this.context.state.writeX402Operation(value),
        }).reconcile(next);
        next = await this.finishReconciledEvidence(reconciled.operation);
      } catch (error) {
        if (!(error instanceof ApnError) || error.code !== "APN_RPC_AMBIGUOUS") throw error;
      }
      return publicX402Operation(next);
    });
  }

}
