import type { StateStore } from "../state.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessProfileIdentity } from "./model.js";
export declare function metaMaskGaslessOwner(state: StateStore, input: string, expected?: MetaMaskGaslessBinding): Promise<MetaMaskGaslessProfileIdentity>;
