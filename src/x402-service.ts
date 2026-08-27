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

export class X402Service {
  private readonly operations: OperationService;

  constructor(private readonly context: RuntimeContext) {
    this.operations = new OperationService(context.state);
  }

  async prepare(request: X402PrepareRequest): Promise<unknown> {
    const profile = canonicalProfile(request.profile);
    const idempotencyKey = canonicalIdempotencyKey(request.idempotencyKey);
    const capAtomic = positiveCap(request.maxAmountAtomic);
    const endpoint = canonicalPrepareUrl(request.url);
    const canonicalUrl = endpoint.toString();
    await this.context.ready();
    const state = this.context.state;
    const profileHash = state.profileHash(profile);
    const operationId = state.operationId(profile, idempotencyKey);
    const idempotencyHash = state.idempotencyHash(idempotencyKey);
    const requestHash = x402RequestHash({ profile, canonicalUrl, capAtomic });

    return await state.withLocks([
      `profile:${profileHash}`,
      `operation:${operationId}`,
      `operation:idempotency:${idempotencyHash}`,
    ], async () => {
      const existing = await this.operations.resolvePrepare({
        kind: "x402_fetch",
        profileHash,
        operationId,
        idempotencyHash,
        requestHash,
      });
      if (existing !== null) return publicX402Operation(existing.record as X402OperationRecord);
      await this.operations.assertProfileAvailable(profileHash);

      const walletRecord = await state.loadWallet(profileHash);
      if (walletRecord === null) throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
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
    return await this.withOperationLock(found.record, async (current) => {
      if (current.terminal) return publicX402Operation(current);
      if (current.state !== "awaiting_approval") {
        throw new ApnError("APN_OPERATION_BLOCKED", "x402 operation is already authorized; use operation resume.");
      }
      const pending = await this.transition(current, "authorization_material_pending");
      return await this.completeAuthorization(pending, "create");
    });
  }

  async resume(operationIdInput: string): Promise<unknown> {
    const operationId = canonicalOperationId(operationIdInput);
    await this.context.ready();
    const found = await this.operations.required(operationId);
    if (found.kind !== "x402_fetch") throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
    return await this.withOperationLock(found.record, async (current) => {
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

  private async recoverPaymentMaterial(
    operation: X402OperationRecord,
  ): Promise<VerifiedX402PaymentMaterial | undefined> {
    try {
      const verified = await requestX402Authorization(
        this.context.requireNative(),
        x402NativeRequest(this.context.ids.next(), operation, "get"),
        operation,
      );
      if (
        verified.native.signatureHash !== operation.signatureHash ||
        verified.paymentPayloadHash !== operation.paymentPayloadHash ||
        verified.paymentHeaderHash !== operation.paymentHeaderHash
      ) throw new ApnError("APN_STATE_CORRUPT", "Recovered x402 payment material differs from durable hashes.");
      return verified;
    } catch (error) {
      if (isTransientNativeFailure(error) || isNativeExpired(error)) return undefined;
      throw error;
    }
  }

  private authorizationExpired(operation: X402OperationRecord): boolean {
    return BigInt(Math.floor(this.context.clock.now().getTime() / 1000)) >= BigInt(operation.authorization.validBefore);
  }

  private async assertLegacySafeRead(operation: X402OperationRecord): Promise<void> {
    const rpc = this.context.requireRpc();
    const chain = await rpc.assertBaseChain();
    const evidence = await rpc.getX402PrepareEvidence(operation.wallet);
    if (
      evidence.address.toLowerCase() !== operation.wallet || evidence.queriedTag !== "safe" ||
      evidence.rpcOriginHash !== sha256(chain.rpcOrigin) ||
      BigInt(evidence.block.number) < BigInt(operation.preparedBlock.number)
    ) throw new ApnError("APN_RPC_PROTOCOL", "RPC safe read does not bind the frozen x402 payer and exposure range.");
  }

  private async withOperationLock(
    operation: X402OperationRecord,
    callback: (current: X402OperationRecord) => Promise<unknown>,
  ): Promise<unknown> {
    return await this.context.state.withLocks([
      `profile:${operation.profileHash}`,
      `operation:${operation.operationId}`,
    ], async () => {
      const current = await this.context.state.loadX402Operation(operation.profileHash, operation.operationId);
      if (current === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
      return await callback(current);
    });
  }

  private async completeAuthorization(
    operation: X402OperationRecord,
    kind: "create" | "get",
  ): Promise<unknown> {
    if (BigInt(Math.floor(this.context.clock.now().getTime() / 1000)) >= BigInt(operation.authorization.validBefore)) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Frozen x402 authorization validity has expired.");
    }
    try {
      const verified = await requestX402Authorization(
        this.context.requireNative(),
        x402NativeRequest(this.context.ids.next(), operation, kind),
        operation,
      );
      const authorized = await this.transition(operation, "authorized_not_sent", {
        signatureHash: verified.native.signatureHash,
        paymentPayloadHash: verified.paymentPayloadHash,
        paymentHeaderHash: verified.paymentHeaderHash,
      });
      return publicX402Operation(authorized);
    } catch (error) {
      if (kind === "get" && isNativeNotFound(error)) {
        const retryable = await this.transition(operation, "authorization_material_pending");
        return publicX402Operation(retryable);
      }
      if (isTransientNativeFailure(error) || isNativeExpired(error)) return publicX402Operation(operation);
      throw error;
    }
  }

  private async sendPaidRequest(
    operation: X402OperationRecord,
    purpose: "payment" | "result_recovery",
    verified: VerifiedX402PaymentMaterial,
    terminalizeFromExistingEvidence = false,
  ): Promise<unknown> {
    if (operation.attempts.length >= 64) return publicX402Operation(operation);
    try {
      const nowMs = this.context.clock.now().getTime();
      const remainingMs = BigInt(operation.authorization.validBefore) * 1000n - BigInt(nowMs);
      const remainingWholeSeconds = remainingMs / 1000n;
      if (remainingWholeSeconds < 1n) return publicX402Operation(operation);
      const timeoutMs = Number(remainingWholeSeconds > 30n ? 30_000n : remainingWholeSeconds * 1000n);
      const pending = await this.beginPaidAttempt(operation, purpose);
      if (pending.attempts.at(-1)?.purpose !== purpose || pending.attempts.at(-1)?.phase !== "pending") {
        throw new ApnError("APN_STATE_CORRUPT", "Resumed x402 attempt is not the durable pending purpose.");
      }

      let rawResponse;
      try {
        rawResponse = await this.context.requireHttp().get({
          url: operation.resource.canonicalUrl,
          paymentSignature: verified.paymentHeader,
          timeoutMs,
        });
      } catch {
        const observed = await this.finishPaidAttempt(
          pending,
          "ambiguous",
          undefined,
          purpose === "payment" ? "effect_unknown" : "seller_result_recovery_pending",
        );
        return publicX402Operation(
          purpose === "result_recovery" && terminalizeFromExistingEvidence && observed.settlementEvidence !== undefined
            ? await this.commitTerminal(observed, "failed_settled_without_result")
            : observed,
        );
      }

      let paid: PaidHttpResult;
      try {
        paid = observePaidX402Response(rawResponse, {
          attemptNumber: pending.attempts.at(-1)?.attemptNumber ?? "0",
          purpose,
          canonicalUrl: operation.resource.canonicalUrl,
          targetHash: operation.resource.urlHash,
          origin: operation.resource.origin,
        });
      } catch {
        const observed = await this.finishPaidAttempt(
          pending,
          "ambiguous",
          undefined,
          purpose === "payment" ? "effect_unknown" : "seller_result_recovery_pending",
        );
        return publicX402Operation(
          purpose === "result_recovery" && terminalizeFromExistingEvidence && observed.settlementEvidence !== undefined
            ? await this.commitTerminal(observed, "failed_settled_without_result")
            : observed,
        );
      }

      let decoded;
      try {
        if (paid.paymentResponseHeader === undefined) {
          throw new ApnError("APN_X402_SETTLEMENT_INVALID", "Paid response did not contain PAYMENT-RESPONSE.");
        }
        decoded = decodeAndNormalizePaymentResponseHeader(paid.paymentResponseHeader, {
          payer: operation.wallet,
          amountAtomic: operation.amountAtomic,
        });
        if (decoded.paymentResponseHeaderHash !== paid.observation.paymentResponseHeaderHash) {
          throw new ApnError("APN_X402_SETTLEMENT_INVALID", "PAYMENT-RESPONSE hash binding is invalid.");
        }
      } catch {
        const observed = await this.finishPaidAttempt(
          pending,
          "observed",
          paid.observation,
          purpose === "payment" ? "effect_unknown" : "seller_result_recovery_pending",
        );
        return publicX402Operation(
          purpose === "result_recovery" && terminalizeFromExistingEvidence && observed.settlementEvidence !== undefined
            ? await this.commitTerminal(observed, "failed_settled_without_result")
            : observed,
        );
      }

      const response: SettlementResponseObservation = {
        schemaVersion: "apn.x402.settlement-response.v1",
        classification: decoded.classification,
        normalizedCanonicalJson: decoded.normalizedCanonicalJson,
        paymentResponseHeaderHash: decoded.paymentResponseHeaderHash,
        settlementResponseHash: decoded.settlementResponseHash,
        httpAttemptNumber: paid.observation.attemptNumber,
        observedAt: paid.observation.observedAt,
      };
      const hint: TransactionHint = {
        transactionHash: decoded.transactionHash,
        source: "payment_response",
        sourceBindingHash: x402TransactionHintSourceBindingHash("payment_response", decoded.settlementResponseHash),
        observedAt: paid.observation.observedAt,
      };

      const conflictingHint = (
        operation.transactionHint !== undefined && operation.transactionHint.transactionHash !== decoded.transactionHash
      ) || (
        purpose === "result_recovery" && decoded.transactionHash !== operation.settlementEvidence?.transactionHash
      );
      if (conflictingHint) {
        return publicX402Operation(await this.finishPaidAttempt(
          pending,
          "observed",
          paid.observation,
          "effect_unknown",
          operation.settlementResponseObservation === undefined
            ? { settlementResponseObservation: response }
            : {},
        ));
      }

      if (purpose === "result_recovery" && (decoded.classification !== "success" || paid.result === undefined)) {
        const observed = await this.finishPaidAttempt(
          pending,
          "observed",
          paid.observation,
          "seller_result_recovery_pending",
          terminalizeFromExistingEvidence ? { settlementResponseObservation: response, transactionHint: hint } : {},
        );
        return publicX402Operation(!terminalizeFromExistingEvidence || observed.settlementEvidence === undefined
          ? observed
          : await this.commitTerminal(observed, "failed_settled_without_result"));
      }
      const observed = await this.finishPaidAttempt(
        pending,
        "observed",
        paid.observation,
        purpose === "payment" ? "settlement_pending" : "seller_result_recovery_pending",
        { settlementResponseObservation: response, transactionHint: hint },
      );
      if (decoded.classification !== "success" || paid.result === undefined) {
        return publicX402Operation(observed);
      }
      const linked = await this.persistAndLinkResult(observed, paid.result, paid.observation.observedAt);
      return publicX402Operation(terminalizeFromExistingEvidence
        ? await this.finishReconciledEvidence(linked)
        : linked);
    } catch (error) {
      if (isTransientNativeFailure(error) || isNativeExpired(error)) return publicX402Operation(operation);
      throw error;
    }
  }

  private async beginPaidAttempt(
    operation: X402OperationRecord,
    purpose: "payment" | "result_recovery",
  ): Promise<X402OperationRecord> {
    if (purpose === "result_recovery" && operation.attempts.some((attempt) => attempt.purpose === "result_recovery")) {
      throw new ApnError("APN_STATE_CORRUPT", "A second x402 result recovery attempt is forbidden.");
    }
    const at = this.context.clock.now().toISOString();
    const attempt: X402Attempt = {
      attemptNumber: (BigInt(operation.attempts.length) + 1n).toString(),
      purpose,
      phase: "pending",
      requestHeaderHash: operation.paymentHeaderHash as string,
      persistedAt: at,
    };
    return await this.transition(
      operation,
      purpose === "payment" ? "paid_request_pending" : "seller_result_recovery_pending",
      { attempts: [...operation.attempts, attempt] },
    );
  }

  private async finishPaidAttempt(
    operation: X402OperationRecord,
    phase: "observed" | "ambiguous",
    observation?: X402Attempt["observation"],
    state: "settlement_pending" | "effect_unknown" | "seller_result_recovery_pending" = "effect_unknown",
    additions: Partial<Pick<X402OperationRecord, "settlementResponseObservation" | "transactionHint">> = {},
  ): Promise<X402OperationRecord> {
    const last = operation.attempts.at(-1);
    if (last?.phase !== "pending") throw new ApnError("APN_STATE_CORRUPT", "Paid attempt marker is missing.");
    const attempts = operation.attempts.map((attempt, index) => index === operation.attempts.length - 1
      ? { ...attempt, phase, ...(observation === undefined ? {} : { observation }) }
      : attempt) as readonly X402Attempt[];
    return await this.transition(operation, state, { attempts, ...additions });
  }

  private async markInterruptedPaidAttempt(
    operation: X402OperationRecord,
    state: "effect_unknown" | "seller_result_recovery_pending",
  ): Promise<X402OperationRecord> {
    return await this.finishPaidAttempt(operation, "ambiguous", undefined, state);
  }

  private async persistAndLinkResult(
    operation: X402OperationRecord,
    result: NonNullable<PaidHttpResult["result"]>,
    createdAt: string,
  ): Promise<X402OperationRecord> {
    const candidate = sealX402Result({
      schemaVersion: "apn.x402.result.v1",
      operationId: operation.operationId,
      mediaType: result.mediaType,
      bodyEncoding: "utf8",
      bodyText: result.bodyText,
      resultHash: result.resultHash,
      byteLength: result.byteLength,
      responseStatus: "200",
      createdAt,
    });
    const existing = await this.context.state.loadX402RecoveryResult(operation.profileHash, operation.operationId);
    const durable = existing ?? candidate;
    if (existing !== null && canonicalJson(existing) !== canonicalJson(candidate)) {
      throw new ApnError("APN_STATE_CORRUPT", "Recovered x402 result differs from the observed response.");
    }
    if (existing === null) await this.context.state.writeX402Result(operation.profileHash, candidate);
    return await this.transition(operation, operation.state, {
      resultLink: { resultHash: durable.resultHash, resultIntegrityHash: durable.integrityHash },
    });
  }

  private async recoverOrphanResult(operation: X402OperationRecord): Promise<X402OperationRecord> {
    if (operation.resultLink !== undefined) return operation;
    const result = await this.context.state.loadX402RecoveryResult(operation.profileHash, operation.operationId);
    if (result === null) return operation;
    const response = operation.settlementResponseObservation;
    const attemptIndex = Number(response?.httpAttemptNumber ?? "0") - 1;
    const attempt = Number.isSafeInteger(attemptIndex) && attemptIndex >= 0
      ? operation.attempts[attemptIndex]
      : undefined;
    if (
      response?.classification !== "success" || attempt?.phase !== "observed" ||
      attempt.observation?.status !== "200" || attempt.observation.bodyHash !== result.resultHash ||
      attempt.observation.bodyByteLength !== result.byteLength || attempt.observation.mediaType !== result.mediaType
    ) throw new ApnError("APN_STATE_CORRUPT", "Recovered x402 result lacks its designated successful response.");
    return await this.transition(operation, operation.state, {
      resultLink: { resultHash: result.resultHash, resultIntegrityHash: result.integrityHash },
    });
  }

  private async finishReconciledEvidence(operation: X402OperationRecord): Promise<X402OperationRecord> {
    if (operation.unusedExpiryEvidence !== undefined) {
      return await this.commitTerminal(operation, "failed_expired_unused");
    }
    if (operation.settlementEvidence === undefined) return operation;
    if (
      operation.settlementResponseObservation !== undefined &&
      settlementResponseTransaction(operation.settlementResponseObservation) !== operation.settlementEvidence.transactionHash
    ) return operation;
    if (operation.resultLink !== undefined) return await this.commitTerminal(operation, "completed");
    const recoveryAttempt = operation.attempts.find((attempt) => attempt.purpose === "result_recovery");
    if (operation.paymentIdentifier !== undefined && recoveryAttempt === undefined) {
      return operation.state === "seller_result_recovery_pending"
        ? operation
        : await this.transition(operation, "seller_result_recovery_pending");
    }
    if (operation.paymentIdentifier !== undefined && recoveryAttempt?.phase === "pending") return operation;
    return await this.commitTerminal(operation, "failed_settled_without_result");
  }

  private async recoverOrphanReceipt(operation: X402OperationRecord): Promise<X402OperationRecord | null> {
    const receipt = await this.context.state.loadX402RecoveryReceipt(operation.profileHash, operation.operationId);
    if (receipt === null) return null;
    return await this.commitTerminalOperation(operation, receipt.terminalState, receipt.integrityHash, receipt.createdAt);
  }

  private async commitTerminal(
    operation: X402OperationRecord,
    terminalState: X402TerminalState,
  ): Promise<X402OperationRecord> {
    const orphan = await this.context.state.loadX402RecoveryReceipt(operation.profileHash, operation.operationId);
    if (orphan !== null) {
      if (orphan.terminalState !== terminalState) throw new ApnError("APN_STATE_CORRUPT", "Orphan x402 receipt has a conflicting terminal state.");
      return await this.commitTerminalOperation(operation, terminalState, orphan.integrityHash, orphan.createdAt);
    }
    const result = operation.resultLink === undefined
      ? null
      : await this.context.state.loadX402Result(operation.profileHash, operation.operationId);
    if (operation.resultLink !== undefined && result === null) throw new ApnError("APN_STATE_CORRUPT", "Terminal x402 result link is dangling.");
    const at = this.context.clock.now().toISOString();
    const classification = terminalClassification(terminalState);
    const receipt = sealX402Receipt({
      schemaVersion: "apn.x402.receipt.v1",
      kind: "x402_fetch",
      operationId: operation.operationId,
      terminalState,
      reason: classification.reason,
      proofClass: classification.proofClass,
      resource: {
        origin: operation.resource.origin,
        path: operation.resource.path,
        urlHash: operation.resource.urlHash,
      },
      fingerprint: operation.fingerprint,
      offerHash: operation.selectedOffer.offerHash,
      payer: operation.wallet,
      payee: operation.payee,
      amountAtomic: operation.amountAtomic,
      network: operation.network,
      token: operation.token,
      ...(operation.paymentIdentifier === undefined ? {} : { paymentIdentifier: operation.paymentIdentifier.value }),
      ...(operation.settlementResponseObservation === undefined ? {} : {
        settlementResponseHash: operation.settlementResponseObservation.settlementResponseHash,
      }),
      ...(operation.settlementEvidence === undefined ? {} : { settlementEvidence: operation.settlementEvidence }),
      ...(operation.unusedExpiryEvidence === undefined ? {} : { unusedExpiryEvidence: operation.unusedExpiryEvidence }),
      ...(result === null ? {} : {
        result: {
          resultHash: result.resultHash,
          mediaType: result.mediaType,
          byteLength: result.byteLength,
          resultIntegrityHash: result.integrityHash,
        },
      }),
      operationBindingHash: x402OperationBindingHash(operation),
      previousLinkHash: operation.transitions.at(-1)?.hash as string,
      createdAt: at,
    });
    await this.context.state.writeX402Receipt(operation.profileHash, receipt);
    return await this.commitTerminalOperation(operation, terminalState, receipt.integrityHash, at);
  }

  private async commitTerminalOperation(
    operation: X402OperationRecord,
    terminalState: X402TerminalState,
    receiptIntegrityHash: string,
    at: string,
  ): Promise<X402OperationRecord> {
    const classification = terminalClassification(terminalState);
    const { integrityHash: _integrityHash, ...withoutIntegrity } = operation;
    const terminal = sealX402Operation({
      ...withoutIntegrity,
      receiptLink: { receiptIntegrityHash },
      state: terminalState,
      finalityClass: "terminal",
      terminal: true,
      reason: classification.reason,
      proofClass: classification.proofClass,
      nextActions: ["receipt.get"],
      updatedAt: at,
      transitions: appendX402Transition(operation.transitions, {
        at,
        state: terminalState,
        terminal: true,
        reason: classification.reason,
        proofClass: classification.proofClass,
      }),
    });
    await this.context.state.writeX402Operation(terminal);
    return terminal;
  }

  private async transition(
    operation: X402OperationRecord,
    state: X402State,
    additions: Partial<Pick<X402OperationRecord,
      | "signatureHash" | "paymentPayloadHash" | "paymentHeaderHash" | "attempts"
      | "settlementResponseObservation" | "transactionHint" | "authorizationUsedScan"
      | "settlementEvidence" | "unusedExpiryEvidence" | "resultLink" | "receiptLink"
    >> = {},
  ): Promise<X402OperationRecord> {
    const at = this.context.clock.now().toISOString();
    const { integrityHash: _previousIntegrityHash, ...operationWithoutIntegrity } = operation;
    const classification = state === "authorization_material_pending" ? {
        reason: "x402_authorization_material_pending" as const,
        proofClass: "x402_authorization_recovery" as const,
        finalityClass: "pre_effect" as const,
        nextActions: ["operation.resume", "operation.status"] as const,
      } : state === "authorized_not_sent" ? {
        reason: "x402_authorized_not_sent" as const,
        proofClass: "x402_authorization_verified" as const,
        finalityClass: "pre_effect" as const,
        nextActions: ["operation.resume", "operation.status"] as const,
      } : state === "paid_request_pending" ? {
        reason: "x402_paid_request_pending" as const,
        proofClass: "x402_unknown_finality" as const,
        finalityClass: "unknown_finality" as const,
        nextActions: ["operation.resume", "operation.status"] as const,
      } : state === "settlement_pending" ? {
        reason: "x402_settlement_pending" as const,
        proofClass: "x402_unknown_finality" as const,
        finalityClass: "unknown_finality" as const,
        nextActions: ["operation.resume", "operation.status"] as const,
      } : state === "effect_unknown" ? {
        reason: "x402_effect_unknown" as const,
        proofClass: "x402_unknown_finality" as const,
        finalityClass: "unknown_finality" as const,
        nextActions: ["operation.resume", "operation.status"] as const,
      } : state === "seller_result_recovery_pending" ? {
        reason: "x402_seller_result_recovery_pending" as const,
        proofClass: "x402_settlement_verified_result_pending" as const,
        finalityClass: "known_settled" as const,
        nextActions: ["operation.resume", "operation.status"] as const,
      } : undefined;
    if (classification === undefined) throw new ApnError("APN_INTERNAL", "Unsupported x402 transition requested.");
    const next = sealX402Operation({
      ...operationWithoutIntegrity,
      ...additions,
      state,
      finalityClass: classification.finalityClass,
      terminal: false,
      reason: classification.reason,
      proofClass: classification.proofClass,
      nextActions: classification.nextActions,
      updatedAt: at,
      transitions: appendX402Transition(operation.transitions, {
        at,
        state,
        terminal: false,
        reason: classification.reason,
        proofClass: classification.proofClass,
      }),
    });
    await this.context.state.writeX402Operation(next);
    return next;
  }
}

function x402ReadPort(rpc: RpcPort): X402RpcPort | null {
  const value = rpc as Partial<X402RpcPort>;
  return typeof value.getX402Head === "function" && typeof value.getX402Block === "function" &&
    typeof value.getX402Receipt === "function" && typeof value.getX402AuthorizationState === "function" &&
    typeof value.getX402AuthorizationUsedLogs === "function" ? value as X402RpcPort : null;
}

function isRecoverableX402RpcObservationFailure(error: unknown): boolean {
  return error instanceof ApnError && [
    "APN_RPC_AMBIGUOUS",
    "APN_RPC_PROTOCOL",
    "APN_RPC_CONFIG",
    "APN_CHAIN_MISMATCH",
  ].includes(error.code);
}

function terminalClassification(state: X402TerminalState): {
  readonly reason: X402Reason;
  readonly proofClass: X402ProofClass;
} {
  return state === "completed"
    ? { reason: "x402_completed", proofClass: "x402_safe_settlement" }
    : state === "failed_before_effect"
      ? { reason: "x402_failed_before_effect", proofClass: "x402_proven_no_effect" }
      : state === "failed_expired_unused"
        ? { reason: "x402_failed_expired_unused", proofClass: "x402_expired_unused_finalized" }
        : { reason: "x402_failed_settled_without_result", proofClass: "x402_settled_result_unavailable" };
}

function settlementResponseTransaction(response: SettlementResponseObservation): string | undefined {
  try {
    const value = JSON.parse(response.normalizedCanonicalJson) as { readonly transaction?: unknown };
    return typeof value.transaction === "string" ? value.transaction : undefined;
  } catch {
    return undefined;
  }
}
