import type { PrivateState } from "./private-state.js";
export interface HydratedSdkState {
    readonly session: Record<string, unknown>;
    readonly walletState: Record<string, unknown>;
    readonly writes: () => number;
}
export declare function hydrateSdkState(state: Pick<PrivateState, "sessionEnvelope" | "walletEnvelope">): Promise<HydratedSdkState>;
