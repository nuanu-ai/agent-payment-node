import type { StateStore } from "../state.js";
import type { GaslessOwner, GaslessProviderBinding } from "./model.js";
export declare function gaslessOwner(state: StateStore, profileInput: string): Promise<{
    owner: GaslessOwner;
    providerBinding: GaslessProviderBinding;
}>;
export declare function assertGaslessOwner(state: StateStore, expected: {
    readonly owner: GaslessOwner;
    readonly providerBinding: GaslessProviderBinding;
}): Promise<GaslessOwner>;
