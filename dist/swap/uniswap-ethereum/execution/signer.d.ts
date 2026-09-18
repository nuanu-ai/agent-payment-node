import type { WrappingSecretPort } from "../../../macos-keychain.js";
import type { StateStore } from "../../../state.js";
import { type SwapOperationRecord } from "../../model.js";
import type { UniswapEffectStorePort, UniswapExecutionBinding, UniswapExecutionEffect, UniswapExecutionSignerPort, UniswapOwnerAdmission } from "./types.js";
/** Opens APN's encrypted local EVM wallet only inside the bounded signing call. */
export declare class LocalUniswapEthereumSigner implements UniswapExecutionSignerPort {
    private readonly state;
    private readonly effects;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort, effects: UniswapEffectStorePort);
    sign(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding, admission: UniswapOwnerAdmission, now: Date): Promise<UniswapExecutionEffect>;
}
