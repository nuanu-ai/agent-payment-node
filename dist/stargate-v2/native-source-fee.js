/** The native Stargate send's actual Ethereum network fee, read from its own canonical receipt, never from the gas envelope. */
import { ApnError } from "../errors.js";
import { seal } from "./native-record.js";
/** The receipt's gas used and effective gas price, when the RPC returned both. */
export function withSourceFee(source, receipt) {
    return receipt.gasUsedAtomic === undefined || receipt.effectiveGasPriceAtomic === undefined ? source
        : { ...source, gasUsedAtomic: receipt.gasUsedAtomic, effectiveGasPriceAtomic: receipt.effectiveGasPriceAtomic };
}
/**
 * An observed record written before the fee was kept reads its own source receipt once at the source finality tag and
 * adds the two numbers; the receipt must be the same transaction in the same block. Nothing else of the record changes.
 */
export async function recordObservedSourceFee(operation, ports, journal) {
    const source = operation.sourceReceipt;
    if (operation.phase !== "observed" || source === undefined || source.gasUsedAtomic !== undefined)
        return operation;
    const receipt = await ports.waitSourceReceipt(source.transactionHash, source.finality);
    if (receipt === null)
        return operation;
    if (receipt.status !== "success" || receipt.transactionHash !== source.transactionHash || receipt.blockHash !== source.blockHash ||
        receipt.blockNumberAtomic !== source.blockNumberAtomic) {
        throw new ApnError("APN_RPC_PROTOCOL", "The Stargate source receipt is not the observed one.", { reason: "source_receipt_changed" });
    }
    const enriched = withSourceFee(source, receipt);
    if (enriched === source)
        return operation;
    const next = seal({ ...operation, sourceReceipt: enriched });
    await journal.save(next);
    return next;
}
//# sourceMappingURL=native-source-fee.js.map