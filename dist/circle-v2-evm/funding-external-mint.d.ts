import type { Address, Hex } from "viem";
import { type CircleDestinationChain } from "./catalog.js";
import { type CircleDiscoveryRpc } from "./external-discovery.js";
import type { CircleRpc } from "./rpc.js";
import type { CircleFundingOperationV2 } from "./funding-operation.js";
/** What a command learned about a mint someone else relayed for this burn. `found` is internal: the command adopts it
 * (`adopted`) or keeps it for the next observation while the destination SAFE head has not reached it. */
export interface CircleExternalMintNotice {
    readonly status: "awaiting_source_finality" | "found" | "found_awaiting_finality" | "not_found" | "adopted";
    readonly destination_chain: CircleDestinationChain;
    readonly transmitter: Address;
    readonly message_nonce: Hex;
    readonly transaction_hash: Hex | null;
    readonly scan: {
        readonly from_block: string;
        readonly to_block: string;
        readonly head_block: string;
        readonly log_window_blocks: number;
        readonly log_requests: number;
        readonly header_requests: number;
    } | null;
}
export interface CircleFundingCommandResult {
    readonly operation: CircleFundingOperationV2;
    readonly externalMint: CircleExternalMintNotice | null;
}
/** The issuer message of `op` is used on the destination and no owned mint can land. Adoption proves the burn at the source
 * FINALIZED head, so nothing is scanned before that; then the burn block's own header gives the scan its start time. */
export declare function findCircleFundingExternalMint(op: CircleFundingOperationV2, source: Pick<CircleRpc, "block">, destination: () => CircleDiscoveryRpc): Promise<CircleExternalMintNotice>;
/** A found external mint is adopted once the command's locks are released, through the same path as
 * `adopt-external-mint` (no signing, no consent). One the destination SAFE head has not reached yet stays found. */
export declare function settleCircleFundingExternalMint(op: CircleFundingOperationV2, notice: CircleExternalMintNotice | null, adopt: (transactionHash: Hex) => Promise<CircleFundingOperationV2>): Promise<CircleFundingCommandResult>;
