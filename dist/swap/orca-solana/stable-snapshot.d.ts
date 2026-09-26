import { SolanaRpc, type SolanaRpcPort } from "../../solana/rpc.js";
import { type OrcaProgramPinVerifier } from "./pins.js";
export interface OrcaStableSnapshotRequest {
    readonly owner: string;
    readonly amountAtomic: string;
    readonly slippageBps: number;
    readonly maximumPriceImpactBps: number;
    readonly computeUnitLimit: number;
    readonly computeUnitPriceMicroLamports: string;
    readonly createUsdtAta: boolean;
    readonly maximumAtaRentLamports?: string;
    readonly maximumTotalFeeLamports: string;
}
/**
 * Read-only entry. The transport must have a fresh invocation cap and persistent 750 ms provider pacing.
 * Pinned program bytes are checked by the production verifier. Returned preview remains non-signable:
 * RPC observation is not approval, simulation, or authority to send.
 */
export declare function readOrcaStableSnapshotAndPrepare(rpc: SolanaRpc, request: OrcaStableSnapshotRequest): Promise<{
    source: "rpc_observed_non_signing";
    rpcOriginHash: string;
    slot: string;
    quote: {
        readonly chain: string;
        readonly pool: string;
        readonly program: string;
        readonly sourceMint: string;
        readonly destinationMint: string;
        readonly vaultA: string;
        readonly vaultB: string;
        readonly direction: string;
        readonly slot: string;
        readonly amountInAtomic: string;
        readonly expectedOutputAtomic: string;
        readonly minimumOutputAtomic: string;
        readonly tickCurrentIndex: number;
        readonly tickArrayStarts: readonly number[];
        readonly slippageBps: number;
        readonly signed: boolean;
        readonly broadcast: boolean;
    };
    preview: import("./stable-prepare.js").OrcaStableUnsignedPreview;
    signed: false;
    broadcast: false;
}>;
/** Lower-level read for deterministic fixtures. Only the entry above supplies production pin verification. */
export declare function readOrcaStableSnapshotCore(rpc: SolanaRpcPort, request: OrcaStableSnapshotRequest, verifyPins: OrcaProgramPinVerifier): Promise<{
    source: "rpc_observed_non_signing";
    rpcOriginHash: string;
    slot: string;
    quote: {
        readonly chain: string;
        readonly pool: string;
        readonly program: string;
        readonly sourceMint: string;
        readonly destinationMint: string;
        readonly vaultA: string;
        readonly vaultB: string;
        readonly direction: string;
        readonly slot: string;
        readonly amountInAtomic: string;
        readonly expectedOutputAtomic: string;
        readonly minimumOutputAtomic: string;
        readonly tickCurrentIndex: number;
        readonly tickArrayStarts: readonly number[];
        readonly slippageBps: number;
        readonly signed: boolean;
        readonly broadcast: boolean;
    };
    preview: import("./stable-prepare.js").OrcaStableUnsignedPreview;
    signed: false;
    broadcast: false;
}>;
