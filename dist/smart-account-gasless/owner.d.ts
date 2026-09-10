import type { StateStore } from "../state.js";
import { type SmartAccountGaslessBinding, type SmartAccountGaslessProfileIdentity } from "./model.js";
export declare function smartAccountGaslessOwner(state: StateStore, input: string, expected?: SmartAccountGaslessBinding): Promise<SmartAccountGaslessProfileIdentity>;
export declare function assertSmartAccountGaslessBinding(value: unknown, owner: SmartAccountGaslessProfileIdentity): SmartAccountGaslessBinding;
