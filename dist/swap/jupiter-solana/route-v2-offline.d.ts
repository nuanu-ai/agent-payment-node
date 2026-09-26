import type { JupiterRawInstruction } from "./codec.js";
/** Expected identities are supplied by an independent caller, never inferred from the instruction. */
export interface RouteV2FixedAccounts {
    readonly userTransferAuthority: string;
    readonly userSourceTokenAccount: string;
    readonly userDestinationTokenAccount: string;
    readonly sourceMint: string;
    readonly destinationMint: string;
    readonly sourceTokenProgram: string;
    readonly destinationTokenProgram: string;
    readonly destinationTokenAccount: string | null;
    readonly eventAuthority: string;
}
export interface OfflineRouteV2 {
    readonly signable: false;
    readonly inAmount: string;
    readonly quotedOutAmount: string;
    readonly slippageBps: number;
    readonly platformFeeBps: number;
    readonly positiveSlippageBps: number;
    readonly routePlan: readonly {
        readonly swap: "Quantum";
        readonly side: 0 | 1;
        readonly bps: number;
        readonly inputIndex: number;
        readonly outputIndex: number;
    }[];
    readonly remainingAccountCount: number;
}
/** Offline decode of the captured Quantum route_v2 variant. Remaining account roles are unknown. */
export declare function decodeQuantumRouteV2Offline(instruction: JupiterRawInstruction, expected: RouteV2FixedAccounts): OfflineRouteV2;
