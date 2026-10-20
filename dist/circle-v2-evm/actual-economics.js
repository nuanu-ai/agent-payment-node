import { CIRCLE_SOURCE_TOKEN, circleRoute } from "./catalog.js";
/**
 * The USDC a route actually moved, each fact taken from the canonical receipt that proved it: the burn's DepositForBurn
 * (source gross), and the mint's net Transfer to the beneficiary and issuer fee mint (bound to the attested message by
 * the destination proof), whether APN or someone else relayed the mint. A fact no receipt has proven yet is null; the
 * caps keep their own names beside it (`amount_atomic`, `minimum_output_atomic`, `maximum_issuer_fee_atomic`).
 */
export function circleActualEconomics(op, grossAtomic) {
    const route = circleRoute(op.destinationChain), external = op.externalFulfillment;
    const credit = op.destination !== null && op.attestation !== null
        ? { mint: "owned", net: op.destination.amountAtomic, fee: op.attestation.feeExecutedAtomic, receipt: op.destination }
        : external === undefined ? null : { mint: "external", net: external.netAtomic, fee: external.issuerFeeAtomic, receipt: external.destinationReceipt };
    return {
        asset: { symbol: "USDC", decimals: 6, source_chain: "eip155:42161", source_token: CIRCLE_SOURCE_TOKEN,
            destination_chain: `eip155:${route.chainId}`, destination_token: route.token },
        actual_source_gross_atomic: op.source === null ? null : grossAtomic,
        source_burn_transaction_hash: op.source?.transactionHash ?? null, source_burn_finality: op.source?.finalityTag ?? null,
        actual_destination_net_atomic: credit?.net ?? null, actual_issuer_fee_atomic: credit?.fee ?? null,
        destination_mint: credit?.mint ?? null, destination_mint_transaction_hash: credit?.receipt.transactionHash ?? null,
        destination_mint_finality: credit?.receipt.finalityTag ?? null,
    };
}
//# sourceMappingURL=actual-economics.js.map