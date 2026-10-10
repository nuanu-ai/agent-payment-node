import { ApnError } from "./errors.js";
import { publicProviderX402Operation } from "./provider-x402-model.js";
import { publicX402Operation } from "./x402-state-integrity.js";
import { projectPublicX402Receipt, projectPublicX402Result } from "./x402-public-artifacts.js";
/** Pure projections: durable reads and admission remain in OperationService. */
export function providerX402Outcome(operation, receipt, options) {
    return {
        proofClass: operation.proofClass,
        data: options.exposeSellerResult && operation.state === "completed" && operation.sellerResult !== undefined
            ? projectPublicX402Result({ variant: "normalized_provider_json", result: operation.sellerResult })
            : null,
        operation: publicProviderX402Operation(operation, options.settlementWait),
        receipt: receipt === null ? null : projectPublicX402Receipt({
            variant: "normalized_provider_json", operation, receipt,
        }),
        nextActions: operation.nextActions,
    };
}
export function localX402Outcome(operation, result, receipt, options) {
    let data = null;
    if (options.exposeSellerResult && operation.state === "completed") {
        if (result === null)
            throw new ApnError("APN_STATE_CORRUPT", "Completed x402 operation has no public result.");
        data = projectPublicX402Result({ variant: "local", result });
    }
    return {
        proofClass: operation.proofClass,
        data,
        operation: publicX402Operation(operation, result ?? undefined, options.settlementWait),
        receipt: receipt === null ? null : projectPublicX402Receipt({ variant: "local", receipt }),
        nextActions: operation.nextActions,
    };
}
export function x402ReceiptOutcome(input) {
    return {
        proofClass: input.receipt.proofClass,
        data: null,
        operation: null,
        receipt: projectPublicX402Receipt(input),
        nextActions: [],
    };
}
//# sourceMappingURL=operation-x402-outcome.js.map