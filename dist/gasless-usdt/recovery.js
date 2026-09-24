import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { validateUsdtBoundOperation } from "./bound-operation.js";
import { UsdtExecutionJournal } from "./execution-journal.js";
import { USDT_GASLESS, USDT_GASLESS_GAS } from "./model.js";
import { verifyUsdtReceipt, verifyUsdtRevert } from "./receipt.js";
function plan(bound) {
    const p = bound.binding.plan;
    return { ...p, request: { ...p.request, grossAtomic: BigInt(p.request.grossAtomic),
            maxFeeAtomic: BigInt(p.request.maxFeeAtomic), minReceivedAtomic: BigInt(p.request.minReceivedAtomic) },
        feeCapAtomic: BigInt(p.feeCapAtomic), netAtomic: BigInt(p.netAtomic), quotedFeeAtomic: BigInt(p.quotedFeeAtomic),
        quote: { ...p.quote, postOpGas: BigInt(p.quote.postOpGas), exchangeRate: BigInt(p.quote.exchangeRate),
            exchangeRateNativeToUsd: BigInt(p.quote.exchangeRateNativeToUsd) },
        price: { ...p.price, maxFeePerGas: BigInt(p.price.maxFeePerGas), maxPriorityFeePerGas: BigInt(p.price.maxPriorityFeePerGas) },
        gas: USDT_GASLESS_GAS,
    };
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
        const bound = validateUsdtBoundOperation(value);
        const current = await this.journal.load(bound.operationId);
        if (current === null || current.bindingHash !== bound.binding.bindingHash ||
            current.profileHash !== bound.profileHash || current.sender !== bound.binding.plan.request.sender) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Gasless USDT recovery binding does not match.", { rail: "gasless_usdt" });
        }
        if (current.state === "finalized" || current.state === "failed_confirmed_revert")
            return current;
        if (current.userOperationHash === null || !["submitting", "submitted_pending", "unknown_finality"].includes(current.state)) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Gasless USDT has no submitted intent to observe.", { rail: "gasless_usdt" });
        }
        const hash = current.userOperationHash;
        let outcome = null;
        try {
            const locator = await this.port.userOperationReceipt(hash);
            if (locator !== null && locator.userOpHash.toLowerCase() === hash &&
                locator.sender === current.sender && locator.entryPoint === USDT_GASLESS.entryPoint &&
                locator.paymaster === USDT_GASLESS.paymaster) {
                const receipt = await this.port.canonicalFinalizedReceipt(locator.transactionHash);
                if (receipt !== null && receipt.transactionHash.toLowerCase() === locator.transactionHash.toLowerCase()) {
                    if (locator.success) {
                        const settlement = verifyUsdtReceipt(plan(bound), hash, receipt);
                        outcome = { state: "finalized", settlement,
                            digest: hashObject({ operationId: bound.operationId, result: "finalized", settlement }) };
                    }
                    else {
                        verifyUsdtRevert(current.sender, hash, receipt);
                        outcome = { state: "failed_confirmed_revert", settlement: null,
                            digest: hashObject({ operationId: bound.operationId, result: "failed_confirmed_revert",
                                transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber.toString(), userOpHash: hash }) };
                    }
                }
            }
        }
        catch {
            // Missing, inconsistent, malformed and unavailable observations are never negative proof.
        }
        if (outcome === null)
            return await this.journal.markUnknownFinality(bound, this.now());
        return await this.journal.recordObservedOutcome(bound, outcome, this.now());
    }
}
//# sourceMappingURL=recovery.js.map