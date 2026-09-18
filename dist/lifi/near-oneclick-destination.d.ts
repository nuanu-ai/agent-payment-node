import { type SolanaRpcPort } from "../solana/rpc.js";
import { type TronRpcPort } from "../tron/rpc.js";
import type { OneClickLane } from "./near-oneclick-lanes.js";
/**
 * Independent destination-chain evidence for one 1Click operation. The provider only names candidate transaction
 * IDs; every credit below is read from solidified TRON or finalized Solana state. Attribution to this deposit rests on
 * the provider naming the hash, the exact recipient and the quote window, so sourceCorrelation stays explicit.
 */
export interface OneClickDestinationProof {
    readonly status: "finalized" | "pending" | "unproven" | "awaiting_provider_destination_hash";
    readonly reason: string;
    readonly proofClass: "tron_solidified_trx_transfer" | "tron_solidified_usdt_transfer" | "solana_finalized_sol_balance_delta";
    readonly recipient: string;
    readonly asset: string;
    readonly creditedAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly transactions: readonly {
        readonly id: string;
        readonly creditedAtomic: string;
        readonly block: string;
        readonly blockTime: string;
    }[];
    readonly pendingTransactions: readonly string[];
    readonly sourceCorrelation: "provider_named_destination_hash";
}
export interface OneClickDestinationInput {
    readonly lane: OneClickLane;
    readonly recipient: string;
    readonly minimumOutputAtomic: string;
    /** Destination credits in blocks older than the quote request are never attributed to this operation. */
    readonly notBeforeMs: number;
    readonly hashes: readonly string[];
    readonly tron: () => TronRpcPort;
    readonly solana: () => SolanaRpcPort;
}
/** Parse the provider's destination hash list from a /v0/status body. Absence means nothing to verify yet. */
export declare function oneClickDestinationHashes(lane: OneClickLane, statusBody: Readonly<Record<string, unknown>>): readonly string[];
export declare function proveOneClickDestination(input: OneClickDestinationInput): Promise<OneClickDestinationProof>;
