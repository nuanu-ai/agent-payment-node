import { type CircleDestinationChain } from "./catalog.js";
import type { CircleReceiptProof } from "./protocol.js";
interface ProvenRoute {
    readonly destinationChain: CircleDestinationChain;
    readonly source: Pick<CircleReceiptProof, "transactionHash" | "finalityTag"> | null;
    readonly attestation: {
        readonly feeExecutedAtomic: string;
    } | null;
    readonly destination: Pick<CircleReceiptProof, "transactionHash" | "finalityTag"> & {
        readonly amountAtomic: string;
    } | null;
    readonly externalFulfillment?: {
        readonly netAtomic: string;
        readonly issuerFeeAtomic: string;
        readonly destinationReceipt: Pick<CircleReceiptProof, "transactionHash" | "finalityTag">;
    };
}
/**
 * The USDC a route actually moved, each fact taken from the canonical receipt that proved it: the burn's DepositForBurn
 * (source gross), and the mint's net Transfer to the beneficiary and issuer fee mint (bound to the attested message by
 * the destination proof), whether APN or someone else relayed the mint. A fact no receipt has proven yet is null; the
 * caps keep their own names beside it (`amount_atomic`, `minimum_output_atomic`, `maximum_issuer_fee_atomic`).
 */
export declare function circleActualEconomics(op: ProvenRoute, grossAtomic: string): {
    asset: {
        symbol: string;
        decimals: number;
        source_chain: string;
        source_token: `0x${string}`;
        destination_chain: string;
        destination_token: `0x${string}`;
    };
    actual_source_gross_atomic: string | null;
    source_burn_transaction_hash: `0x${string}` | null;
    source_burn_finality: "safe" | "included" | "finalized" | null;
    actual_destination_net_atomic: string | null;
    actual_issuer_fee_atomic: string | null;
    destination_mint: "external" | "owned" | null;
    destination_mint_transaction_hash: `0x${string}` | null;
    destination_mint_finality: "safe" | "included" | "finalized" | null;
};
export {};
