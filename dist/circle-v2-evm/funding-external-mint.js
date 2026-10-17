import { ApnError } from "../errors.js";
import { CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { discoverCircleExternalMint } from "./external-discovery.js";
import { circleBlocked, circleCorrupt } from "./operation-model.js";
import { circleHex, circleUint } from "./protocol.js";
/** The issuer message of `op` is used on the destination and no owned mint can land. Adoption proves the burn at the source
 * FINALIZED head, so nothing is scanned before that; then the burn block's own header gives the scan its start time. */
export async function findCircleFundingExternalMint(op, source, destination) {
    if (op.source === null || op.attestation === null)
        circleCorrupt("external_mint_without_source");
    const base = { destination_chain: op.destinationChain, transmitter: CIRCLE_TRANSMITTER, message_nonce: op.attestation.nonce };
    if (op.source.finalityTag !== "finalized")
        return { status: "awaiting_source_finality", ...base, transaction_hash: null, scan: null };
    const header = await source.block(`0x${BigInt(op.source.blockNumberAtomic).toString(16)}`);
    if (circleHex(header.hash, 32) !== op.source.blockHash)
        circleBlocked("source_reorg_holds_required");
    const scan = await discoverCircleExternalMint(destination(), op.attestation.nonce, circleUint(header.timestamp));
    return { status: scan.transactionHash === null ? "not_found" : "found", ...base, transaction_hash: scan.transactionHash,
        scan: { from_block: scan.fromBlock.toString(), to_block: scan.toBlock.toString(), head_block: scan.headBlock.toString(), log_window_blocks: circleRoute(op.destinationChain).logRange,
            log_requests: scan.logReads, header_requests: scan.headerReads } };
}
/** A found external mint is adopted once the command's locks are released, through the same path as
 * `adopt-external-mint` (no signing, no consent). One the destination SAFE head has not reached yet stays found. */
export async function settleCircleFundingExternalMint(op, notice, adopt) {
    if (notice === null || notice.status !== "found" || notice.transaction_hash === null)
        return { operation: op, externalMint: notice };
    try {
        return { operation: await adopt(notice.transaction_hash), externalMint: { ...notice, status: "adopted" } };
    }
    catch (error) {
        if (error instanceof ApnError && error.details?.reason === "external_finality_unresolved")
            return { operation: op, externalMint: { ...notice, status: "found_awaiting_finality" } };
        throw error;
    }
}
//# sourceMappingURL=funding-external-mint.js.map