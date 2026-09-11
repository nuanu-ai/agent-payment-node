import type { StateStore } from "../state.js";
import type { BridgeOwner, BridgeProviderBinding } from "./model.js";
export declare function bridgeOwner(state: StateStore, profileInput: string): Promise<{
    owner: BridgeOwner;
    providerBinding: BridgeProviderBinding;
}>;
export declare function assertBridgeOwner(state: StateStore, expected: {
    readonly owner: BridgeOwner;
    readonly providerBinding: BridgeProviderBinding;
}): Promise<BridgeOwner>;
