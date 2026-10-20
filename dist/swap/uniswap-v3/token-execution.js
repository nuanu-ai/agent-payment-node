import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { abandonedPrincipalCandidate, principalReleaseCandidate, proveSwapNoncesUnusable } from "./token-principal.js";
import { sanitizeUniswapTokenFailureField, swapMarkerNonces, tokenAttempt, transitionUniswapToken, UniswapTokenJournal, validateUniswapTokenOperation } from "./token-operation.js";
export class UniswapTokenExecution {
    journal;
    ports;
    /** Effects broadcast by this invocation: their nonce cannot be finalized past yet, so no never-lands read is spent on them. */
    sentNow = new Set();
    constructor(journal, ports) {
        this.journal = journal;
        this.ports = ports;
    }
    async approve(id) {
        let op = await this.retireExpiredPrepared(await this.required(id));
        if (op.phase !== "prepared")
            blocked("Token swap is not prepared.", "uniswap_token_phase");
        await this.ports.foregroundApprove(op);
        const usage = await this.ports.reserveUsage(op);
        op = await this.persist(transitionUniswapToken(op, "approved", usagePatch(usage), this.ports.now()));
        op = await this.advanceApproval(op);
        return approvalActive(op.phase) ? await this.observeApproval(await this.continueStart(op, "approval")) : op;
    }
    async execute(id) {
        let op = await this.retireExpiredPrepared(await this.syncUsage(await this.required(id)));
        if (op.phase === "abandoned_unknown")
            return await this.releaseAbandoned(op);
        if (["observed", "cleaned", "cleanup_required"].includes(op.phase))
            return op;
        // A dropped marker leaves this command on the recovery budget it reserved: it may close an expired route (no effect),
        // otherwise it stops, and the next execute starts the effect afresh under an effect budget.
        const marked = op.phase;
        op = await this.resumeUnsigned(op, ["approval", "swap"]);
        if (op.phase !== marked && !expired(op, this.ports.now()))
            return op;
        if (expired(op, this.ports.now()) && !approvalActive(op.phase) && !swapActive(op.phase) && !cleanupActive(op.phase)) {
            if (op.phase === "approval_observed" && op.approvalAttempt?.transactionHash != null)
                return await this.retireExpiredApproval(op);
            return await this.cleanupRequired(op, "deadline_expired");
        }
        if (op.phase === "approved")
            op = await this.advanceApproval(op);
        if (approvalActive(op.phase))
            return await this.observeApproval(await this.continueStart(op, "approval"));
        // The signing guard revalidates the swap (allowance, balance, quote floor, simulation, gas, fees) at its own block; a
        // refusal frees the nonce and records why before cleanup becomes required.
        if (op.phase === "approval_observed")
            op = await this.start(op, "swap");
        if (swapActive(op.phase))
            return await this.observeSwap(await this.continueStart(op, "swap"));
        return op;
    }
    async advanceApproval(op) {
        const allowance = await this.ports.currentAllowance(op);
        if (allowance !== "0" && allowance !== op.route.amountIn)
            return await this.cleanupRequired(op, "approval_allowance_drift");
        return allowance === op.route.amountIn ? await this.persist(transitionUniswapToken(op, "approval_observed", {}, this.ports.now())) : await this.start(op, "approval");
    }
    async status(id) {
        const op = await this.retireExpiredPrepared(await this.syncUsage(await this.required(id)));
        if (approvalActive(op.phase))
            return await this.observeApproval(await this.continueStart(op, "approval"));
        if (op.phase === "approval_observed" && expired(op, this.ports.now()) && op.approvalAttempt?.transactionHash != null)
            return await this.retireExpiredApproval(op);
        if (swapActive(op.phase))
            return await this.observeSwap(await this.continueStart(op, "swap"));
        if (cleanupActive(op.phase))
            return await this.observeCleanup(await this.continueStart(op, "cleanup"));
        return op.phase === "cleaned" ? await this.settlePrincipal(op) : op;
    }
    async cleanup(id, fees) {
        let op = await this.syncUsage(await this.required(id));
        if (op.phase === "cleaned")
            return op;
        op = await this.resumeUnsigned(op, ["cleanup"]);
        if (op.phase !== "cleanup_required")
            blocked("Token swap cleanup is not required.", "uniswap_cleanup_phase");
        // The owner's own caps replace the frozen ones for this cleanup only: checked against a fresh fee quote, shown at the
        // consent below (its code binds the new caps), and saved only after it. Nothing raises them automatically.
        const requoted = fees === undefined ? null : requotedCleanup(op, fees, await this.feeQuote(op), this.ports.now());
        await this.ports.foregroundCleanup(requoted ?? op);
        if (requoted !== null)
            op = await this.persist(requoted);
        if (await this.zeroAllowance(op)) {
            // Every attempt is a bound transaction that landed or was retired: the residual allowance is already gone.
            const attempts = [op.approvalAttempt, op.swapAttempt, op.cleanupAttempt].filter((row) => row !== null);
            if ((attempts.length > 0 || (op.retiredEffects ?? []).length > 0) && attempts.every((row) => row.transactionHash !== null)) {
                return await this.settlePrincipal(await this.persist(transitionUniswapToken(op, "cleaned", { cleanupReason: "zero_allowance_after_effect", cleanupEvidence: {
                        schemaVersion: "apn.uniswap-token-zero-allowance-evidence.v1", kind: "zero_allowance_after_effect", observedAllowanceAtomic: "0",
                        observedAt: this.ports.now().toISOString()
                    }, ...usagePatch(await this.ports.currentUsage(op)) }, this.ports.now())));
            }
            await this.assertNoEffect(op);
            op = await this.persist(transitionUniswapToken(op, "cleanup_required", { cleanupReason: "zero_allowance_no_effect",
                cleanupEvidence: cleanupEvidence("current_allowance", this.ports.now()) }, this.ports.now()));
            return await this.cleaned(op);
        }
        // A cleanup refused before signing is back in cleanup_required with its diagnostic: nothing to observe.
        op = await this.start(op, "cleanup");
        return cleanupActive(op.phase) ? await this.observeCleanup(await this.continueStart(op, "cleanup")) : op;
    }
    async start(op, kind) {
        return await this.ports.withAccountLock(op, async () => {
            // The send's slot first: a command without room for it stops here, before a nonce or a marker exists.
            this.ports.reserveSendCapacity?.();
            const nonce = await this.ports.allocateNonce(op, kind), attempt = tokenAttempt(op, kind, nonce, this.ports.now());
            // Nothing signs before the marker is durable: a refused or raced marker hands the reservation back (or keeps a signed one).
            let marked;
            try {
                marked = await this.persist(transitionUniswapToken(op, started(kind), { [`${kind}Attempt`]: attempt }, this.ports.now()));
            }
            catch (error) {
                await this.ports.releaseNonce(op, kind, nonce);
                throw error;
            }
            return await this.finishStart(marked, kind);
        });
    }
    async continueStart(op, kind) {
        const attempt = attemptOf(op, kind);
        if (attempt.transactionHash !== null)
            return op;
        const recovered = await this.ports.recoverSealed?.(op, kind, attempt.nonce) ?? null;
        // Status cannot show that no signed bytes exist: custody saves them in the encrypted wallet before it writes the public
        // sealed effect, and recovery never opens custody (none was sent: a send needs the public effect). The forward command
        // (execute; cleanup for a cleanup) opens custody under the account lock and settles the marker (resumeUnsigned).
        if (recovered === null)
            throw new ApnError("APN_OPERATION_BLOCKED", "Started token effect has no public transaction evidence.", {
                reason: "uniswap_token_public_effect_missing", nextActions: [`apn swap ethereum uniswap-token ${kind === "cleanup" ? "cleanup" : "execute"} --operation ${op.operationId}`]
            });
        // A sealed transaction may or may not have reached the provider. Recovery observes it only.
        const usage = kind === "swap" ? await this.ports.followUsage(op, "unknown_finality") : null;
        return await this.persist(transitionUniswapToken(op, unknown(kind), {
            [`${kind}Attempt`]: { ...attempt, transactionHash: recovered.transactionHash },
            ...(usage === null ? {} : usagePatch(usage)),
        }, this.ports.now()));
    }
    async finishStart(op, kind) {
        const attempt = attemptOf(op, kind);
        if (attempt.transactionHash !== null || op.phase !== started(kind))
            return op;
        const recovered = await this.ports.probeSealed(op, kind, attempt.nonce);
        if (recovered !== null) {
            await this.ports.commitNonce(op, kind, attempt.nonce);
            op = await this.persist(transitionUniswapToken(op, started(kind), { [`${kind}Attempt`]: { ...attempt, transactionHash: recovered.transactionHash } }, this.ports.now()));
            return await this.submit(op, kind);
        }
        try {
            await this.ports.guard(op, kind, attempt.nonce);
        }
        catch (error) {
            const unsigned = await this.ports.releaseNonce(op, kind, attempt.nonce);
            return await this.cleanupRequired(op, kind === "swap" ? "post_approval_revalidation_failed" : `${kind}_pre_sign_failed`, op.accumulatedNativeDebitWei, undefined, diagnostic(error, op.phase), unmarked(op, kind, unsigned));
        }
        let sealed;
        try {
            sealed = await this.ports.seal(op, kind, attempt.nonce);
        }
        catch (error) {
            const durable = await this.ports.probeSealed(op, kind, attempt.nonce);
            if (durable !== null) {
                await this.ports.commitNonce(op, kind, attempt.nonce);
                throw error;
            }
            const unsigned = await this.ports.releaseNonce(op, kind, attempt.nonce);
            return await this.cleanupRequired(op, `${kind}_sign_failed`, op.accumulatedNativeDebitWei, undefined, undefined, unmarked(op, kind, unsigned));
        }
        await this.ports.commitNonce(op, kind, attempt.nonce);
        op = await this.persist(transitionUniswapToken(op, started(kind), { [`${kind}Attempt`]: { ...attempt, transactionHash: sealed.transactionHash } }, this.ports.now()));
        return await this.submit(op, kind);
    }
    async submit(op, kind) {
        this.ports.reserveSendCapacity?.();
        this.sentNow.add(kind);
        let result;
        try {
            result = await this.ports.send(op, kind);
        }
        catch {
            result = "ambiguous";
        }
        const usage = kind === "swap" ? await this.ports.followUsage(op, result === "accepted" ? "submitted" : "unknown_finality") : null;
        return await this.persist(transitionUniswapToken(op, result === "accepted" ? submitted(kind) : unknown(kind), usage === null ? {} : usagePatch(usage), this.ports.now()));
    }
    async observeApproval(op) {
        const hash = op.approvalAttempt?.transactionHash;
        if (hash === null || hash === undefined)
            return op;
        const result = await this.ports.observe(op, "approval", hash);
        if (result === null)
            return await this.retireIfNeverLanded(op, "approval");
        if (result.status === "pending")
            return op;
        const native = debit(op, result.gasDebitWei);
        if (result.status === "reverted" || result.allowanceAtomic !== op.route.amountIn)
            return await this.cleanupRequired(op, "approval_failed_or_mismatch", native);
        op = await this.persist(transitionUniswapToken(op, "approval_observed", { accumulatedNativeDebitWei: native }, this.ports.now()));
        return expired(op, this.ports.now()) ? await this.retireExpiredApproval(op, result) : op;
    }
    async retireExpiredApproval(op, observation) {
        if (op.phase !== "approval_observed" || op.swapAttempt !== null || op.cleanupAttempt !== null || !expired(op, this.ports.now()))
            blocked("Expired approval retirement requires an unsent swap.", "uniswap_token_expired_approval_unsafe");
        const hash = op.approvalAttempt?.transactionHash;
        if (hash == null)
            blocked("Approval evidence is missing.", "uniswap_token_expired_approval_unsafe");
        const result = observation ?? await this.ports.observe(op, "approval", hash);
        if (result === null || result.status === "pending")
            return op;
        if (result.status !== "success" || result.transactionHash !== hash || result.allowanceAtomic !== op.route.amountIn)
            return await this.cleanupRequired(op, "approval_failed_or_mismatch");
        // The approval landed exactly and no swap was ever started. `cleaned` means no residual allowance: one still standing
        // needs the owner's consented revoke (the cleanup command), and the hold is released once that cleanup is observed; an
        // allowance already zero closes now, the hold released with it. Approval gas stays charged either way.
        const now = this.ports.now();
        if (!await this.zeroAllowance(op))
            return await this.cleanupRequired(op, "deadline_expired_after_approval");
        return await this.settlePrincipal(await this.persist(transitionUniswapToken(op, "cleaned", { cleanupReason: "zero_allowance_after_effect",
            cleanupEvidence: { schemaVersion: "apn.uniswap-token-zero-allowance-evidence.v1", kind: "zero_allowance_after_effect", observedAllowanceAtomic: "0",
                observedAt: now.toISOString() } }, now)));
    }
    async observeSwap(op) {
        const hash = op.swapAttempt?.transactionHash;
        if (hash === null || hash === undefined)
            return op;
        const result = await this.ports.observe(op, "swap", hash);
        if (result === null)
            return await this.retireIfNeverLanded(op, "swap");
        if (result.status === "pending")
            return op;
        const nativeDebitWei = debit(op, result.gasDebitWei);
        if (result.status === "reverted") {
            const usage = await this.ports.followUsage(op, "failed_confirmed_revert");
            return await this.cleanupRequired(op, "swap_reverted", nativeDebitWei, usage);
        }
        if (result.allowanceAtomic !== "0" || result.inputDebitAtomic !== op.route.amountIn || BigInt(result.outputCreditAtomic ?? "0") < BigInt(op.route.amountOutMinimum))
            return await this.cleanupRequired(op, "swap_effect_mismatch", nativeDebitWei);
        const receiptBody = { schemaVersion: "apn.uniswap-token-receipt.v1", operationId: op.operationId, approvalGasWei: op.accumulatedNativeDebitWei,
            swapGasWei: result.gasDebitWei, cleanupGasWei: "0", nativeDebitWei, inputDebitAtomic: op.route.amountIn, outputCreditAtomic: result.outputCreditAtomic,
            residualAllowanceAtomic: "0", transactionHash: hash, observedAt: this.ports.now().toISOString() };
        const receipt = { ...receiptBody, receiptHash: domainHash("apn.uniswap-token-receipt.v1", canonicalJson(receiptBody)) };
        const usage = await this.ports.followUsage(op, "finalized");
        return await this.persist(transitionUniswapToken(op, "observed", { accumulatedNativeDebitWei: nativeDebitWei, receipt, ...usagePatch(usage) }, this.ports.now()));
    }
    async observeCleanup(op) {
        const hash = op.cleanupAttempt?.transactionHash;
        if (hash === null || hash === undefined)
            return op;
        const result = await this.ports.observe(op, "cleanup", hash);
        if (result === null)
            return await this.retireIfNeverLanded(op, "cleanup");
        if (result.status === "pending")
            return op;
        // A record a released version left in cleanup_unknown_finality already counted this landed cleanup's gas.
        const native = op.cleanupReason === "cleanup_reverted_or_mismatch" ? op.accumulatedNativeDebitWei : debit(op, result.gasDebitWei);
        if (result.status !== "success" || result.allowanceAtomic !== "0") {
            const reverted = result.status !== "success";
            return await this.rearmCleanup(op, this.retired(op, "cleanup", reverted ? "reverted" : "landed_allowance_nonzero", null), reverted ? "cleanup_reverted" : "cleanup_allowance_nonzero", native);
        }
        return await this.cleaned(op, native);
    }
    /**
     * R4 for a bound attempt the observer cannot find: once the finalized nonce passed it and the node knows neither its
     * transaction nor a receipt, it can never land. An approval that never landed leaves the swap with no effect (cleaned
     * when the allowance is still zero); a swap that never landed releases its hold as unsubmitted and keeps the approval
     * for the owner's cleanup; a cleanup that never landed is re-armed for a fresh, consented one. Nothing is re-signed here.
     */
    async retireIfNeverLanded(op, kind) {
        const attempt = attemptOf(op, kind);
        if (attempt.transactionHash === null || this.ports.neverLands === undefined || this.sentNow.has(kind))
            return op;
        const check = await this.ports.neverLands(op, kind, attempt);
        if (!check.neverLands)
            return op;
        const retired = this.retired(op, kind, "never_landed", check.finalizedNonce.toString()), now = this.ports.now();
        if (kind === "cleanup")
            return await this.rearmCleanup(op, retired, "cleanup_never_landed", op.accumulatedNativeDebitWei);
        if (kind === "swap") {
            const usage = await this.ports.followUsage(op, "released_unsubmitted");
            return await this.persist(transitionUniswapToken(op, "cleanup_required", { swapAttempt: null, retiredEffects: retired, cleanupReason: "swap_never_landed",
                ...usagePatch(usage) }, now));
        }
        const allowance = await this.ports.currentAllowance(op);
        op = await this.persist(transitionUniswapToken(op, "cleanup_required", { approvalAttempt: null, retiredEffects: retired, cleanupReason: "approval_never_landed" }, now));
        if (allowance !== "0" || effectHash(op))
            return op;
        op = await this.persist(transitionUniswapToken(op, "cleanup_required", { cleanupReason: "zero_allowance_no_effect",
            cleanupEvidence: cleanupEvidence("current_allowance", now) }, now));
        return await this.cleaned(op);
    }
    /** The cleanup slot is freed for a new round; a landed cleanup's gas is counted and the cap grows by one more cleanup. */
    async rearmCleanup(op, retiredEffects, reason, native) {
        const needed = BigInt(native) + BigInt(op.cleanupGas.gasLimit) * BigInt(op.cleanupGas.maxFeePerGas);
        return await this.persist(transitionUniswapToken(op, "cleanup_required", { cleanupAttempt: null, retiredEffects, cleanupReason: reason,
            accumulatedNativeDebitWei: native, maximumNativeDebitWei: needed > BigInt(op.maximumNativeDebitWei) ? needed.toString() : op.maximumNativeDebitWei }, this.ports.now()));
    }
    retired(op, kind, reason, finalizedNonceAtomic) {
        return [...op.retiredEffects ?? [], { kind, attempt: attemptOf(op, kind), reason, finalizedNonceAtomic, observedAt: this.ports.now().toISOString() }];
    }
    async cleaned(op, native = op.accumulatedNativeDebitWei) {
        const noEffect = !effectHash(op);
        if (noEffect && (op.cleanupEvidence ?? null) === null)
            corrupt("No-effect cleanup evidence is missing.");
        // A swap marker custody freed is proven on chain before its hold is released (settlePrincipal), even with no effect.
        const usage = noEffect && op.freedSwapMarkers === undefined ? await this.ports.followUsage(op, "failed_before_effect") : await this.ports.currentUsage(op);
        return await this.settlePrincipal(await this.persist(transitionUniswapToken(op, "cleaned", { accumulatedNativeDebitWei: native,
            ...(noEffect ? { cleanupReason: "zero_allowance_no_effect" } : {}), ...usagePatch(usage) }, this.ports.now())));
    }
    /**
     * A cleaned swap still holding its principal although no swap of it can land (R4 exit 2): no swap marker is left (never
     * signed), or its hashless marker's nonce is consumed in the finalized chain by its own landed cleanup. A marker custody
     * freed (no signed bytes, a local answer) is also proven on chain: its nonce held by a landed cleanup, or unused past the
     * deadline. The proof is saved first, then the hold is released; gas, attempts and history stay. Without it the hold stays.
     */
    async settlePrincipal(op) {
        if (op.phase !== "cleaned" || op.usageState !== "reserved")
            return op;
        if (op.principalRelease === undefined) {
            const candidate = principalReleaseCandidate(op);
            if (candidate === null)
                return op;
            const freed = swapMarkerNonces(op, null), chainProof = freed.length === 0 ? undefined : await proveSwapNoncesUnusable(op, freed, this.ports);
            if (chainProof === null)
                return op;
            const proven = chainProof === undefined ? {} : { chainProof }, now = this.ports.now();
            if (candidate.kind === "swap_never_signed")
                op = await this.persist(transitionUniswapToken(op, "cleaned", { principalRelease: {
                        schemaVersion: "apn.uniswap-token-principal-release.v1", kind: "swap_never_signed", ...proven, observedAt: now.toISOString()
                    } }, now));
            else {
                const proof = await this.ports.swapNonceConsumed?.(op, candidate.cleanup) ?? null;
                if (proof === null)
                    return op;
                op = await this.persist(transitionUniswapToken(op, "cleaned", { principalRelease: { schemaVersion: "apn.uniswap-token-principal-release.v1",
                        kind: "swap_nonce_consumed_by_cleanup", swapNonce: candidate.swap.nonce, cleanupTransactionHash: candidate.cleanup.transactionHash,
                        cleanupBlockNumber: proof.blockNumber, cleanupBlockHash: proof.blockHash, finalizedBlockNumber: proof.finalizedBlockNumber,
                        finalizedNonce: proof.finalizedNonce, ...proven, observedAt: now.toISOString() } }, now));
            }
        }
        return await this.persist(transitionUniswapToken(op, "cleaned", usagePatch(await this.ports.followUsage(op, "failed_before_effect")), this.ports.now()));
    }
    /**
     * A started attempt with no hash and no public sealed effect (a refusal or crash between its marker and signing): the
     * forward command opens custody under the account lock. Custody holding no signed bytes frees the nonce and proves the
     * attempt never signed (R4 exit 2), so its marker is dropped and the operation is where it was before the attempt (execute
     * then only closes an expired route; cleanup goes on to its consented cleanup). Signed bytes found are journaled with their
     * nonce committed, and recovery only observes them. Nothing is signed or sent here.
     */
    async resumeUnsigned(op, kinds) {
        const kind = kinds.find((candidate) => op.phase === started(candidate));
        if (kind === undefined)
            return op;
        const attempt = attemptOf(op, kind);
        if (attempt.transactionHash !== null || await this.ports.recoverSealed?.(op, kind, attempt.nonce) != null)
            return op;
        return await this.ports.withAccountLock(op, async () => {
            const current = await this.required(op.operationId);
            if (current.integrityHash !== op.integrityHash || !await this.ports.releaseNonce(current, kind, attempt.nonce))
                return current;
            return await this.persist(transitionUniswapToken(current, kind === "approval" ? "approved" : kind === "swap" ? "approval_observed" : "cleanup_required", unmarked(current, kind, true), this.ports.now()));
        });
    }
    /**
     * The owner's abandon keeps the principal held only while an effect of the swap could still land. With no swap marker, or
     * a hashless one whose custody (opened under the account lock) holds no signed bytes and so frees its nonce, nothing of
     * the principal can move. Custody's answer is local, so every swap marker's nonce (this one and any custody freed) is
     * also proven on the finalized chain first, as for a cleaned swap; without that the hold stays. The proof is saved, then
     * the hold released. Gas, attempts, the marker and the terminal phase stay; signed bytes (found now or committed earlier)
     * change nothing. Nothing is signed or sent here.
     */
    async releaseAbandoned(op) {
        const candidate = abandonedPrincipalCandidate(op);
        if (candidate === null)
            return op;
        const swap = candidate.swap;
        if (swap !== null && await this.ports.recoverSealed?.(op, "swap", swap.nonce) != null)
            return op;
        const nonces = swapMarkerNonces(op, swap), chainProof = nonces.length === 0 ? undefined : await proveSwapNoncesUnusable(op, nonces, this.ports);
        if (chainProof === null)
            return op;
        op = await this.ports.withAccountLock(op, async () => {
            const current = await this.required(op.operationId);
            if (current.integrityHash !== op.integrityHash || swap !== null && !await this.ports.releaseNonce(current, "swap", swap.nonce))
                return current;
            const now = this.ports.now();
            return await this.persist(transitionUniswapToken(current, "abandoned_unknown", { principalRelease: { schemaVersion: "apn.uniswap-token-principal-release.v1",
                    kind: "swap_never_signed", ...(swap === null ? {} : { swapNonce: swap.nonce, swapMarkerHash: swap.markerHash }),
                    ...(chainProof === undefined ? {} : { chainProof }), observedAt: now.toISOString() } }, now));
        });
        if (op.principalRelease === undefined || op.usageState !== "reserved")
            return op;
        return await this.persist(transitionUniswapToken(op, "abandoned_unknown", usagePatch(await this.ports.followUsage(op, "failed_before_effect")), this.ports.now()));
    }
    async cleanupRequired(op, reason, native = op.accumulatedNativeDebitWei, usage, preSignFailure, unmarkedAttempt = {}) {
        return await this.persist(transitionUniswapToken(op, "cleanup_required", { cleanupReason: reason, accumulatedNativeDebitWei: native,
            ...(usage === undefined ? {} : usagePatch(usage)), ...(preSignFailure === undefined ? {} : { preSignFailure }), ...unmarkedAttempt }, this.ports.now()));
    }
    async retireExpiredPrepared(op) {
        if (op.phase !== "prepared" || !expired(op, this.ports.now()))
            return op;
        if (op.approvalAttempt !== null || op.swapAttempt !== null || op.cleanupAttempt !== null ||
            op.usageReservationId !== null || op.usageState !== null || op.accumulatedNativeDebitWei !== "0")
            blocked("Expired prepared token operation has effects requiring review.", "uniswap_token_expired_prepared_unsafe");
        await this.assertNoEffect(op);
        if (await this.ports.currentAllowance(op) !== "0")
            blocked("Expired prepared token operation has a residual allowance.", "uniswap_token_expired_prepared_allowance");
        return await this.persist(transitionUniswapToken(op, "cleaned", { cleanupReason: "zero_allowance_no_effect",
            cleanupEvidence: cleanupEvidence("current_allowance", this.ports.now()) }, this.ports.now()));
    }
    async syncUsage(op) {
        if (op.usageReservationId === null)
            return op;
        // A recorded release whose ledger step did not complete (records of the earlier expired-approval exit, or principalRelease).
        if (op.phase === "cleaned" && (op.cleanupEvidence?.kind === "expired_approval_no_swap" || op.principalRelease !== undefined) ||
            op.phase === "abandoned_unknown" && op.principalRelease !== undefined) {
            const current = await this.ports.currentUsage(op);
            if (current.state === "reserved") {
                const released = await this.ports.followUsage(op, "failed_before_effect");
                return await this.persist(transitionUniswapToken(op, op.phase, usagePatch(released), this.ports.now()));
            }
        }
        const usage = await this.ports.currentUsage(op);
        if (op.usageState !== usage.state || op.usageReservationId !== usage.reservationId)
            op = await this.persist(transitionUniswapToken(op, op.phase, usagePatch(usage), this.ports.now()));
        if (op.phase === "cleanup_required" && op.usageState === "failed_before_effect" && !effectHash(op)) {
            await this.assertNoEffect(op);
            return await this.persist(transitionUniswapToken(op, "cleaned", { cleanupReason: "zero_allowance_no_effect", accumulatedNativeDebitWei: "0",
                cleanupEvidence: op.cleanupEvidence ?? cleanupEvidence("legacy_usage_reconciliation", this.ports.now()) }, this.ports.now()));
        }
        return op;
    }
    async assertNoEffect(op) {
        if (effectHash(op))
            blocked("A durable token effect forbids no-effect cleanup.", "uniswap_cleanup_effect_exists");
        for (const [kind, attempt] of [["approval", op.approvalAttempt], ["swap", op.swapAttempt], ["cleanup", op.cleanupAttempt]])
            if (attempt !== null) {
                const effect = await this.ports.recoverSealed?.(op, kind, attempt.nonce) ?? null;
                if (effect !== null)
                    blocked("A durable token effect forbids no-effect cleanup.", "uniswap_cleanup_effect_exists");
                blocked("A started token effect cannot prove no-effect cleanup.", "uniswap_token_public_effect_missing");
            }
    }
    /**
     * "No residual allowance" (the cleaned decision): a zero latest read, confirmed once an approval landed at a head one node
     * shows including it, pinned by hash, since a node behind the approval reads the zero from before it. A nonzero read needs
     * no pin: the cleanup it leads to is re-read by the signing guard at its own block. Only a zero costs the second read.
     */
    async zeroAllowance(op) {
        if (await this.ports.currentAllowance(op) !== "0")
            return false;
        const landed = op.approvalAttempt?.transactionHash ?? null;
        return landed === null || await this.ports.currentAllowance(op, landed) === "0";
    }
    async feeQuote(op) {
        if (this.ports.cleanupFeeQuote === undefined)
            blocked("A fresh fee quote is unavailable.", "uniswap_token_cleanup_fee_quote_unavailable");
        return await this.ports.cleanupFeeQuote(op);
    }
    async required(id) { const op = await this.journal.load(id); if (op === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Uniswap token operation was not found."); return op; }
    async persist(op) { return await this.journal.save(validateUniswapTokenOperation(op)); }
}
function attemptOf(op, kind) { const v = kind === "approval" ? op.approvalAttempt : kind === "swap" ? op.swapAttempt : op.cleanupAttempt; if (v === null)
    throw new ApnError("APN_STATE_CORRUPT", "Uniswap token attempt is missing."); return v; }
function started(kind) { return kind === "approval" ? "approval_submission_started" : kind === "swap" ? "submission_started" : "cleanup_submission_started"; }
function submitted(kind) { return kind === "approval" ? "approval_submitted" : kind === "swap" ? "submitted" : "cleanup_submitted"; }
function unknown(kind) { return kind === "approval" ? "approval_unknown_finality" : kind === "swap" ? "unknown_finality" : "cleanup_unknown_finality"; }
function approvalActive(p) { return ["approval_submission_started", "approval_submitted", "approval_unknown_finality"].includes(p); }
function swapActive(p) { return ["submission_started", "submitted", "unknown_finality"].includes(p); }
function cleanupActive(p) { return ["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(p); }
function expired(op, now) { return now.getTime() >= op.route.deadline * 1000; }
function usagePatch(value) { return { usageReservationId: value.reservationId, usageState: value.state }; }
function debit(op, added) { const total = BigInt(op.accumulatedNativeDebitWei) + BigInt(added); if (total > BigInt(op.maximumNativeDebitWei))
    blocked("Native debit exceeded the approved budget.", "uniswap_native_debit_exceeded"); return total.toString(); }
function effectHash(op) { return [op.approvalAttempt, op.swapAttempt, op.cleanupAttempt].some((row) => row?.transactionHash !== null && row?.transactionHash !== undefined); }
function cleanupEvidence(source, now) {
    return { schemaVersion: "apn.uniswap-token-cleanup-evidence.v1",
        kind: "zero_allowance_no_effect", source, observedAllowanceAtomic: "0", observedAt: now.toISOString() };
}
function diagnostic(error, phase) {
    const e = error instanceof ApnError ? error : null;
    return { code: sanitizeUniswapTokenFailureField("code", e?.code),
        reason: sanitizeUniswapTokenFailureField("reason", e?.details?.reason ?? e?.details?.transportReason),
        rpcMethod: sanitizeUniswapTokenFailureField("rpcMethod", e?.details?.rpcMethod),
        endpointRole: sanitizeUniswapTokenFailureField("endpointRole", e?.details?.endpointRole), phase };
}
/**
 * R4 exit 2 "never signed": the refusal came before signing, inside the account lock, and custody then showed no signed bytes
 * while it freed the nonce. The marker of that attempt is dropped so the zero-allowance cleanup can prove no effect; an attempt
 * custody may hold signed bytes for keeps its marker (its exit stays proof or the owner's abandon). A dropped swap marker is
 * kept in `freedSwapMarkers`: custody's answer is local, so a principal release also proves its nonce on chain.
 */
function unmarked(op, kind, unsigned) {
    if (!unsigned)
        return {};
    return kind === "swap" ? { swapAttempt: null, freedSwapMarkers: [...op.freedSwapMarkers ?? [], attemptOf(op, "swap")] } : { [`${kind}Attempt`]: null };
}
/** The record for one consented cleanup re-quote; refused when the caps miss the quote or a cleanup marker holds the slot. */
export function requotedCleanup(op, fees, quote, now) {
    if (op.phase !== "cleanup_required" || op.cleanupAttempt !== null)
        blocked("A cleanup re-quote needs a free cleanup slot.", "uniswap_token_cleanup_requote_slot");
    const maxFee = BigInt(fees.maxFeePerGas), priority = BigInt(fees.maxPriorityFeePerGas), base = BigInt(quote.baseFeePerGasWei), market = BigInt(quote.priorityFeePerGasWei), minimum = base * 2n + market;
    // The signing guard's own rule: the priority cap covers the market tip and the max fee covers twice the base fee plus it.
    if (priority > maxFee || priority < market || maxFee < minimum)
        throw new ApnError("APN_OPERATION_BLOCKED", "The cleanup fee caps are below the fresh fee quote.", { reason: "uniswap_token_cleanup_fee_quote", blockNumber: quote.blockNumber, baseFeePerGasWei: quote.baseFeePerGasWei,
            priorityFeePerGasWei: quote.priorityFeePerGasWei, minimumMaxFeePerGasWei: minimum.toString() });
    const gas = { gasLimit: op.cleanupGas.gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
    const cleanupMax = BigInt(gas.gasLimit) * maxFee, envelopeMax = (g) => BigInt(g.gasLimit) * BigInt(g.maxFeePerGas);
    const cap = [BigInt(op.maximumNativeDebitWei), BigInt(op.accumulatedNativeDebitWei) + cleanupMax, envelopeMax(op.approvalGas) + envelopeMax(op.swapGas) + cleanupMax]
        .reduce((a, b) => a > b ? a : b);
    return transitionUniswapToken(op, "cleanup_required", { cleanupGas: gas, maximumNativeDebitWei: cap.toString(), cleanupFeeQuote: {
            schemaVersion: "apn.uniswap-token-cleanup-fee-quote.v1", ...quote, previousCleanupGas: op.cleanupGas,
            previousMaximumNativeDebitWei: op.maximumNativeDebitWei, quotedAt: now.toISOString()
        } }, now);
}
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-execution.js.map