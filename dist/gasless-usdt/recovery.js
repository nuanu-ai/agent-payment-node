import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { validateUsdtStoredBoundOperation } from "./bound-stored.js";
import { UsdtExecutionJournal } from "./execution-journal.js";
import { USDT_GASLESS } from "./model.js";
import { decodeUsdtPaymasterData } from "./paymaster-data.js";
import { restoreUsdtPlan } from "./restored-plan.js";
import { verifyUsdtReceipt, verifyUsdtRevert } from "./receipt.js";
/** The record's own token, signed paymaster and signed treasury; the EntryPoint its operation hash is bound to. */
export function usdtRecordPins(bound) {
    const b = bound.binding;
    return { token: b.token, paymaster: b.unsignedOperation.paymaster,
        treasury: decodeUsdtPaymasterData(b.paymasterData).treasury, entryPoint: USDT_GASLESS.entryPoint };
}
/** One bounded observation pass. It never signs, sends or retries a provider read. */
export class UsdtRecoveryService {
    journal;
    port;
    now;
    constructor(journal, port, now) {
        this.journal = journal;
        this.port = port;
        this.now = now;
    }
    async observe(value) {
        // Observation only reads the chain for an existing hash, so the saved record is checked against itself (R2).
        const bound = validateUsdtStoredBoundOperation(value);
        const current = await this.journal.load(bound.operationId);
        if (current === null || current.bindingHash !== bound.binding.bindingHash ||
            current.profileHash !== bound.profileHash || current.sender !== bound.binding.plan.request.sender) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Gasless USDT recovery binding does not match.", { rail: "gasless_usdt" });
        }
        if (current.state === "finalized" || current.state === "failed_confirmed_revert" || current.state === "expired_never_landed")
            return current;
        if (current.userOperationHash === null || !["submitting", "submitted_pending", "unknown_finality"].includes(current.state)) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Gasless USDT has no submitted intent to observe.", { rail: "gasless_usdt" });
        }
        const hash = current.userOperationHash, pins = usdtRecordPins(bound);
        let outcome = null;
        let neverLanded = null;
        try {
            let candidate = null, contradicted = false;
            try {
                const locator = await this.port.userOperationReceipt(hash);
                if (locator !== null && locator.userOpHash.toLowerCase() === hash && locator.sender === current.sender &&
                    locator.entryPoint === pins.entryPoint && locator.paymaster === pins.paymaster)
                    candidate = locator.transactionHash;
            }
            catch { /* The bundler locator is only a hint; the canonical EntryPoint scan below does not depend on it. */ }
            if (candidate !== null) {
                const receipt = await this.port.canonicalFinalizedReceipt(candidate);
                // A receipt not yet finalized is pending; a finalized receipt without this operation's event contradicts the hint.
                if (receipt !== null) {
                    outcome = this.proven(bound, current, hash, candidate, receipt, pins);
                    contradicted = outcome === null;
                }
            }
            if (candidate === null || contradicted) {
                const scan = await this.port.scanUserOperation({ userOpHash: hash, sender: current.sender,
                    fromBlock: BigInt(current.safeBlockNumber), fromBlockHash: current.safeBlockHash,
                    validUntil: BigInt(current.paymasterValidUntil), paymaster: pins.paymaster, entryPoint: pins.entryPoint });
                if (scan.status === "found") {
                    const receipt = await this.port.canonicalFinalizedReceipt(scan.transactionHash);
                    if (receipt !== null)
                        outcome = this.proven(bound, current, hash, scan.transactionHash, receipt, pins);
                }
                else if (scan.final)
                    neverLanded = scan;
            }
        }
        catch {
            // Missing, inconsistent, malformed and unavailable observations are never negative proof.
        }
        if (outcome !== null)
            return await this.journal.recordObservedOutcome(bound, outcome, this.now());
        if (neverLanded !== null) {
            const digest = hashObject({ operationId: bound.operationId, result: "expired_never_landed", userOpHash: hash,
                validUntil: current.paymasterValidUntil, fromBlock: current.safeBlockNumber, endBlock: neverLanded.endBlock.toString(),
                endBlockHash: neverLanded.endBlockHash, finalizedBlock: neverLanded.finalizedBlock.toString() });
            return await this.journal.recordNeverLanded(bound, digest, this.now());
        }
        return await this.journal.markUnknownFinality(bound, this.now());
    }
    /** The chain decides: exactly one successful event with the exact debits settles; one failed event is a confirmed revert. */
    proven(bound, current, hash, transactionHash, receipt, pins) {
        if (receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase())
            return null;
        try {
            const settlement = verifyUsdtReceipt(restoreUsdtPlan(bound), hash, receipt, pins);
            return { state: "finalized", settlement, digest: hashObject({ operationId: bound.operationId, result: "finalized", settlement }) };
        }
        catch { /* Not a successful settlement of this operation; a failed event is checked next. */ }
        try {
            verifyUsdtRevert(current.sender, hash, receipt, pins);
            return { state: "failed_confirmed_revert", settlement: null, digest: hashObject({ operationId: bound.operationId,
                    result: "failed_confirmed_revert", transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), userOpHash: hash }) };
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=recovery.js.map