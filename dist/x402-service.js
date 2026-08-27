import { randomBytes } from "node:crypto";
import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { ApnError } from "./errors.js";
import { OperationService } from "./operation-service.js";
import { canonicalIdempotencyKey } from "./transfer-policy.js";
import { canonicalOperationId } from "./transfer-policy.js";
import { canonicalProfile } from "./wallet-policy.js";
import { decodeAndNormalizePaymentResponseHeader } from "./x402-codec.js";
import { observePaidX402Response } from "./x402-http.js";
import { candidatesWithinCap, canonicalPrepareUrl, freshChallenge, paymentIdentifierState, positiveCap, selectPrepareOffer, } from "./x402-policy.js";
import { appendX402Transition, publicX402Operation, sealX402Operation, sealX402Result, x402AuthorizationIntentHash, x402Fingerprint, x402RequestHash, x402TransactionHintSourceBindingHash, } from "./x402-state-integrity.js";
import { isNativeNotFound, isNativeExpired, isTransientNativeFailure, requestX402Authorization, x402NativeRequest, } from "./x402-native.js";
export class X402Service {
    context;
    operations;
    constructor(context) {
        this.context = context;
        this.operations = new OperationService(context.state);
    }
    async prepare(request) {
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
            if (existing !== null)
                return publicX402Operation(existing.record);
            await this.operations.assertProfileAvailable(profileHash);
            const walletRecord = await state.loadWallet(profileHash);
            if (walletRecord === null)
                throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
            const wallet = walletRecord.address.toLowerCase();
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
                to: selected.payee.toLowerCase(),
                value: selected.amountAtomic,
                validAfter: "0",
                validBefore: (BigInt(createdAtUnix) + BigInt(selected.maxTimeoutSeconds)).toString(),
                nonce: `0x${randomBytes(32).toString("hex")}`,
                createdAt: createdAtUnix,
            };
            const resource = {
                canonicalUrl,
                origin: endpoint.origin,
                path: endpoint.pathname,
                urlHash: sha256(canonicalUrl),
            };
            const fingerprintInput = {
                kind: "x402_fetch",
                profile,
                operationId,
                resource,
                chainId: "8453",
                network: CHAIN_CAIP2,
                token: BASE_USDC.toLowerCase(),
                capAtomic,
                selectedOffer: selected.selectedOffer,
                wallet,
                ...(paymentIdentifier === undefined ? {} : { paymentIdentifier }),
            };
            const initial = {
                at: createdAt,
                state: "awaiting_approval",
                terminal: false,
                reason: "x402_awaiting_authorization",
                proofClass: "x402_frozen_offer",
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
                token: BASE_USDC.toLowerCase(),
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
    async approve(request) {
        const operationId = canonicalOperationId(request.operationId);
        await this.context.ready();
        const found = await this.operations.required(operationId);
        if (found.kind !== "x402_fetch")
            throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
        return await this.withOperationLock(found.record, async (current) => {
            if (current.terminal)
                return publicX402Operation(current);
            if (current.state !== "awaiting_approval") {
                throw new ApnError("APN_OPERATION_BLOCKED", "x402 operation is already authorized; use operation resume.");
            }
            const pending = await this.transition(current, "authorization_material_pending");
            return await this.completeAuthorization(pending, "create");
        });
    }
    async resume(operationIdInput) {
        const operationId = canonicalOperationId(operationIdInput);
        await this.context.ready();
        const found = await this.operations.required(operationId);
        if (found.kind !== "x402_fetch")
            throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
        return await this.withOperationLock(found.record, async (current) => {
            if (current.terminal)
                return publicX402Operation(current);
            if (current.state === "awaiting_approval") {
                throw new ApnError("APN_OPERATION_BLOCKED", "x402 operation still requires explicit fetch approve.");
            }
            if (current.state === "authorized_not_sent") {
                return await this.sendPaidRequest(current, "payment");
            }
            if (current.state === "paid_request_pending") {
                return publicX402Operation(await this.markInterruptedPaidAttempt(current));
            }
            if (current.state === "settlement_pending" || current.state === "effect_unknown") {
                return publicX402Operation(await this.recoverOrphanResult(current));
            }
            if (current.state === "seller_result_recovery_pending") {
                const recovered = await this.recoverOrphanResult(current);
                if (recovered.resultLink !== undefined || recovered.attempts.some((attempt) => attempt.purpose === "result_recovery")) {
                    return publicX402Operation(recovered);
                }
                return await this.sendPaidRequest(recovered, "result_recovery");
            }
            if (current.state !== "authorization_material_pending") {
                throw new ApnError("APN_OPERATION_BLOCKED", "x402 operation is outside the authorization checkpoint.");
            }
            const pendingCount = current.transitions.filter((transition) => transition.state === "authorization_material_pending").length;
            return await this.completeAuthorization(current, pendingCount === 1 ? "get" : "create");
        });
    }
    async withOperationLock(operation, callback) {
        return await this.context.state.withLocks([
            `profile:${operation.profileHash}`,
            `operation:${operation.operationId}`,
        ], async () => {
            const current = await this.context.state.loadX402Operation(operation.profileHash, operation.operationId);
            if (current === null)
                throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
            return await callback(current);
        });
    }
    async completeAuthorization(operation, kind) {
        if (BigInt(Math.floor(this.context.clock.now().getTime() / 1000)) >= BigInt(operation.authorization.validBefore)) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Frozen x402 authorization validity has expired.");
        }
        try {
            const verified = await requestX402Authorization(this.context.requireNative(), x402NativeRequest(this.context.ids.next(), operation, kind), operation);
            const authorized = await this.transition(operation, "authorized_not_sent", {
                signatureHash: verified.native.signatureHash,
                paymentPayloadHash: verified.paymentPayloadHash,
                paymentHeaderHash: verified.paymentHeaderHash,
            });
            return publicX402Operation(authorized);
        }
        catch (error) {
            if (kind === "get" && isNativeNotFound(error)) {
                const retryable = await this.transition(operation, "authorization_material_pending");
                return publicX402Operation(retryable);
            }
            if (isTransientNativeFailure(error) || isNativeExpired(error))
                return publicX402Operation(operation);
            throw error;
        }
    }
    async sendPaidRequest(operation, purpose) {
        if (operation.attempts.length >= 64)
            return publicX402Operation(operation);
        try {
            const verified = await requestX402Authorization(this.context.requireNative(), x402NativeRequest(this.context.ids.next(), operation, "get"), operation);
            if (verified.native.signatureHash !== operation.signatureHash ||
                verified.paymentPayloadHash !== operation.paymentPayloadHash ||
                verified.paymentHeaderHash !== operation.paymentHeaderHash)
                throw new ApnError("APN_STATE_CORRUPT", "Recovered x402 payment material differs from durable hashes.");
            const nowMs = this.context.clock.now().getTime();
            const remainingMs = BigInt(operation.authorization.validBefore) * 1000n - BigInt(nowMs);
            const remainingWholeSeconds = remainingMs / 1000n;
            if (remainingWholeSeconds < 1n)
                return publicX402Operation(operation);
            const timeoutMs = Number(remainingWholeSeconds > 30n ? 30000n : remainingWholeSeconds * 1000n);
            const pending = await this.beginPaidAttempt(operation, purpose);
            let rawResponse;
            try {
                rawResponse = await this.context.requireHttp().get({
                    url: operation.resource.canonicalUrl,
                    paymentSignature: verified.paymentHeader,
                    timeoutMs,
                });
            }
            catch {
                return publicX402Operation(await this.finishPaidAttempt(pending, "ambiguous", undefined, purpose === "payment" ? "effect_unknown" : "seller_result_recovery_pending"));
            }
            let paid;
            try {
                paid = observePaidX402Response(rawResponse, {
                    attemptNumber: pending.attempts.at(-1)?.attemptNumber ?? "0",
                    purpose,
                    canonicalUrl: operation.resource.canonicalUrl,
                    targetHash: operation.resource.urlHash,
                    origin: operation.resource.origin,
                });
            }
            catch {
                return publicX402Operation(await this.finishPaidAttempt(pending, "ambiguous", undefined, purpose === "payment" ? "effect_unknown" : "seller_result_recovery_pending"));
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
                if (purpose === "result_recovery" &&
                    decoded.transactionHash !== operation.settlementEvidence?.transactionHash)
                    throw new ApnError("APN_X402_RECOVERY_AMBIGUOUS", "Recovered seller response conflicts with proven settlement.");
            }
            catch {
                const observed = await this.finishPaidAttempt(pending, "observed", paid.observation, purpose === "payment" ? "effect_unknown" : "seller_result_recovery_pending");
                return publicX402Operation(observed);
            }
            if (purpose === "result_recovery" && (decoded.classification !== "success" || paid.result === undefined)) {
                const observed = await this.finishPaidAttempt(pending, "observed", paid.observation, "seller_result_recovery_pending");
                return publicX402Operation(observed);
            }
            const response = {
                schemaVersion: "apn.x402.settlement-response.v1",
                classification: decoded.classification,
                normalizedCanonicalJson: decoded.normalizedCanonicalJson,
                paymentResponseHeaderHash: decoded.paymentResponseHeaderHash,
                settlementResponseHash: decoded.settlementResponseHash,
                httpAttemptNumber: paid.observation.attemptNumber,
                observedAt: paid.observation.observedAt,
            };
            const hint = {
                transactionHash: decoded.transactionHash,
                source: "payment_response",
                sourceBindingHash: x402TransactionHintSourceBindingHash("payment_response", decoded.settlementResponseHash),
                observedAt: paid.observation.observedAt,
            };
            const observed = await this.finishPaidAttempt(pending, "observed", paid.observation, purpose === "payment" ? "settlement_pending" : "seller_result_recovery_pending", { settlementResponseObservation: response, transactionHint: hint });
            if (decoded.classification !== "success" || paid.result === undefined) {
                return publicX402Operation(observed);
            }
            return publicX402Operation(await this.persistAndLinkResult(observed, paid.result, paid.observation.observedAt));
        }
        catch (error) {
            if (isTransientNativeFailure(error) || isNativeExpired(error))
                return publicX402Operation(operation);
            throw error;
        }
    }
    async beginPaidAttempt(operation, purpose) {
        const at = this.context.clock.now().toISOString();
        const attempt = {
            attemptNumber: (BigInt(operation.attempts.length) + 1n).toString(),
            purpose,
            phase: "pending",
            requestHeaderHash: operation.paymentHeaderHash,
            persistedAt: at,
        };
        return await this.transition(operation, purpose === "payment" ? "paid_request_pending" : "seller_result_recovery_pending", { attempts: [...operation.attempts, attempt] });
    }
    async finishPaidAttempt(operation, phase, observation, state = "effect_unknown", additions = {}) {
        const last = operation.attempts.at(-1);
        if (last?.phase !== "pending")
            throw new ApnError("APN_STATE_CORRUPT", "Paid attempt marker is missing.");
        const attempts = operation.attempts.map((attempt, index) => index === operation.attempts.length - 1
            ? { ...attempt, phase, ...(observation === undefined ? {} : { observation }) }
            : attempt);
        return await this.transition(operation, state, { attempts, ...additions });
    }
    async markInterruptedPaidAttempt(operation) {
        return await this.finishPaidAttempt(operation, "ambiguous");
    }
    async persistAndLinkResult(operation, result, createdAt) {
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
        if (existing === null)
            await this.context.state.writeX402Result(operation.profileHash, candidate);
        return await this.transition(operation, operation.state, {
            resultLink: { resultHash: durable.resultHash, resultIntegrityHash: durable.integrityHash },
        });
    }
    async recoverOrphanResult(operation) {
        if (operation.resultLink !== undefined)
            return operation;
        const result = await this.context.state.loadX402RecoveryResult(operation.profileHash, operation.operationId);
        if (result === null)
            return operation;
        const response = operation.settlementResponseObservation;
        const attemptIndex = Number(response?.httpAttemptNumber ?? "0") - 1;
        const attempt = Number.isSafeInteger(attemptIndex) && attemptIndex >= 0
            ? operation.attempts[attemptIndex]
            : undefined;
        if (response?.classification !== "success" || attempt?.phase !== "observed" ||
            attempt.observation?.status !== "200" || attempt.observation.bodyHash !== result.resultHash ||
            attempt.observation.bodyByteLength !== result.byteLength || attempt.observation.mediaType !== result.mediaType)
            throw new ApnError("APN_STATE_CORRUPT", "Recovered x402 result lacks its designated successful response.");
        return await this.transition(operation, operation.state, {
            resultLink: { resultHash: result.resultHash, resultIntegrityHash: result.integrityHash },
        });
    }
    async transition(operation, state, additions = {}) {
        const at = this.context.clock.now().toISOString();
        const { integrityHash: _previousIntegrityHash, ...operationWithoutIntegrity } = operation;
        const classification = state === "authorization_material_pending" ? {
            reason: "x402_authorization_material_pending",
            proofClass: "x402_authorization_recovery",
            finalityClass: "pre_effect",
            nextActions: ["operation.resume", "operation.status"],
        } : state === "authorized_not_sent" ? {
            reason: "x402_authorized_not_sent",
            proofClass: "x402_authorization_verified",
            finalityClass: "pre_effect",
            nextActions: ["operation.resume", "operation.status"],
        } : state === "paid_request_pending" ? {
            reason: "x402_paid_request_pending",
            proofClass: "x402_unknown_finality",
            finalityClass: "unknown_finality",
            nextActions: ["operation.resume", "operation.status"],
        } : state === "settlement_pending" ? {
            reason: "x402_settlement_pending",
            proofClass: "x402_unknown_finality",
            finalityClass: "unknown_finality",
            nextActions: ["operation.resume", "operation.status"],
        } : state === "effect_unknown" ? {
            reason: "x402_effect_unknown",
            proofClass: "x402_unknown_finality",
            finalityClass: "unknown_finality",
            nextActions: ["operation.resume", "operation.status"],
        } : state === "seller_result_recovery_pending" ? {
            reason: "x402_seller_result_recovery_pending",
            proofClass: "x402_settlement_verified_result_pending",
            finalityClass: "known_settled",
            nextActions: ["operation.resume", "operation.status"],
        } : undefined;
        if (classification === undefined)
            throw new ApnError("APN_INTERNAL", "Unsupported x402 transition requested.");
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
//# sourceMappingURL=x402-service.js.map