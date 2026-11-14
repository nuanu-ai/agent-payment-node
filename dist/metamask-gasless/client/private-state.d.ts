import type { MetaMaskGaslessBinding, MetaMaskGaslessProfileIdentity } from "../model.js";
export interface PrivateState {
    readonly sessionEnvelope: Readonly<Record<string, unknown>>;
    readonly walletEnvelope: Readonly<Record<string, unknown>>;
    readonly session: Readonly<Record<string, unknown>>;
    readonly walletState: Readonly<Record<string, unknown>>;
    readonly token: string;
    readonly projectId: string;
    readonly address: `0x${string}`;
    readonly binding: MetaMaskGaslessBinding;
    readonly generationHash: string;
}
type Expected = MetaMaskGaslessProfileIdentity | MetaMaskGaslessBinding;
/** mm's signed-in session and wallet state, read and validated as `readPrivateState` reads them, before any wallet binding. */
export type PrivateSession = Pick<PrivateState, "sessionEnvelope" | "walletEnvelope" | "session" | "walletState" | "token" | "projectId" | "generationHash">;
export declare function readPrivateSession(homeDirectory: string, now: Date): Promise<PrivateSession>;
export declare function readPrivateState(homeDirectory: string, expected: Expected, now: Date): Promise<PrivateState>;
export {};
