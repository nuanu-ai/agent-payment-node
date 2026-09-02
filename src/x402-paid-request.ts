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
import { X402Lifecycle } from "./x402-lifecycle.js";
import { ProviderX402AuthorizationService } from "./provider-x402-authorization.js";

export class X402PaidRequest extends X402Lifecycle {
  protected async recoverPaymentMaterial(
    operation: X402OperationRecord,
  ): Promise<VerifiedX402PaymentMaterial | undefined> {
    if (operation.providerSigner !== undefined) {
      const outcome = await this.providerAuthorization().authorize(operation, "get");
      if (outcome.disposition !== "signed") {
        throw new ApnError("APN_STATE_CORRUPT", "Authorized provider x402 operation lost its signed material.");
      }
      const verified = outcome.material;
      if (
        verified.native.signatureHash !== operation.signatureHash ||
        verified.paymentPayloadHash !== operation.paymentPayloadHash ||
        verified.paymentHeaderHash !== operation.paymentHeaderHash
      ) throw new ApnError("APN_STATE_CORRUPT", "Recovered provider x402 material differs from durable hashes.");
      return verified;
    }
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

  protected authorizationExpired(operation: X402OperationRecord): boolean {
    return BigInt(Math.floor(this.context.clock.now().getTime() / 1000)) >= BigInt(operation.authorization.validBefore);
  }

  protected async assertLegacySafeRead(operation: X402OperationRecord): Promise<void> {
    const rpc = this.context.requireRpc();
    const chain = await rpc.assertBaseChain();
    const evidence = await rpc.getX402PrepareEvidence(operation.wallet);
    if (
      evidence.address.toLowerCase() !== operation.wallet || evidence.queriedTag !== "safe" ||
      evidence.rpcOriginHash !== sha256(chain.rpcOrigin) ||
      BigInt(evidence.block.number) < BigInt(operation.preparedBlock.number)
    ) throw new ApnError("APN_RPC_PROTOCOL", "RPC safe read does not bind the frozen x402 payer and exposure range.");
  }

  protected async withOperationLock(
    operation: X402OperationRecord,
    callback: (current: X402OperationRecord) => Promise<unknown>,
    lockWaitMs?: number,
  ): Promise<unknown> {
    return await this.context.state.withLocks([
      `profile:${operation.profileHash}`,
      `operation:${operation.operationId}`,
    ], async () => {
      const current = await this.context.state.loadX402Operation(operation.profileHash, operation.operationId);
      if (current === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
      return await callback(current);
    }, lockWaitMs === undefined ? {} : { waitMs: lockWaitMs });
  }

  protected async completeAuthorization(
    operation: X402OperationRecord,
    kind: "create" | "get",
  ): Promise<unknown> {
    if (BigInt(Math.floor(this.context.clock.now().getTime() / 1000)) >= BigInt(operation.authorization.validBefore)) {
      if (operation.providerSigner !== undefined) {
        return publicX402Operation(await this.commitTerminal(operation, "failed_before_effect"));
      }
      throw new ApnError("APN_OPERATION_BLOCKED", "Frozen x402 authorization validity has expired.");
    }
    if (operation.providerSigner !== undefined) {
      const outcome = await this.providerAuthorization().authorize(operation, kind);
      if (outcome.disposition === "pending") {
        return publicX402Operation(operation);
      }
      if (outcome.disposition === "rejected" || outcome.disposition === "ambiguous") {
        return publicX402Operation(await this.commitTerminal(operation, "failed_before_effect"));
      }
      const verified = outcome.material;
      const authorized = await this.transition(operation, "authorized_not_sent", {
        signatureHash: verified.native.signatureHash,
        paymentPayloadHash: verified.paymentPayloadHash,
        paymentHeaderHash: verified.paymentHeaderHash,
      });
      return publicX402Operation(authorized);
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

  private providerAuthorization(): ProviderX402AuthorizationService {
    return new ProviderX402AuthorizationService(
      this.context,
      this.context.requireProviderAuthorizationStore(),
    );
  }

  protected async sendPaidRequest(
    operation: X402OperationRecord,
    purpose: "payment" | "result_recovery",
    verified: VerifiedX402PaymentMaterial,
    terminalizeFromExistingEvidence = false,
    callerDeadlineMs?: number,
  ): Promise<unknown> {
    if (operation.attempts.length >= 64) return publicX402Operation(operation);
    try {
      const requestTimeoutMs = (): number | undefined => {
        const nowMs = this.context.clock.now().getTime();
        const remainingMs = BigInt(operation.authorization.validBefore) * 1000n - BigInt(nowMs);
        const remainingWholeSeconds = remainingMs / 1000n;
        if (remainingWholeSeconds < 1n) return undefined;
        const authorizationTimeoutMs = Number(
          remainingWholeSeconds > 30n ? 30_000n : remainingWholeSeconds * 1000n,
        );
        const callerRemainingMs = callerDeadlineMs === undefined
          ? authorizationTimeoutMs
          : Math.floor(callerDeadlineMs - this.context.wait.nowMs());
        return callerRemainingMs < 1 ? undefined : Math.min(authorizationTimeoutMs, callerRemainingMs);
      };
      if (requestTimeoutMs() === undefined) return publicX402Operation(operation);
      const pending = await this.beginPaidAttempt(operation, purpose);
      if (pending.attempts.at(-1)?.purpose !== purpose || pending.attempts.at(-1)?.phase !== "pending") {
        throw new ApnError("APN_STATE_CORRUPT", "Resumed x402 attempt is not the durable pending purpose.");
      }

      let rawResponse;
      try {
        const timeoutMs = requestTimeoutMs();
        if (timeoutMs === undefined) throw new Error("x402 caller or authorization deadline elapsed");
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

}
