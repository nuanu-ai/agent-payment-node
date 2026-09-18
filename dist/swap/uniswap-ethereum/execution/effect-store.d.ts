import type { WrappingSecretPort } from "../../../macos-keychain.js";
import type { StateStore } from "../../../state.js";
import { SecureStateStore } from "../../../secure-state-store.js";
import { type SwapOperationRecord } from "../../model.js";
import type { UniswapEffectStorePort, UniswapExecutionBinding, UniswapExecutionEffect } from "./types.js";
/** Raw signed bytes exist only inside this authenticated encrypted store. */
export declare class EncryptedUniswapExecutionEffectStore extends SecureStateStore implements UniswapEffectStorePort {
    private readonly state;
    private readonly wrappingSecret;
    constructor(state: StateStore, wrappingSecret: WrappingSecretPort);
    load(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding): Promise<UniswapExecutionEffect | null>;
    seal(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding, effectValue: UniswapExecutionEffect): Promise<UniswapExecutionEffect>;
    markSendStarted(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding, now: Date): Promise<UniswapExecutionEffect>;
    markSendOutcome(operationValue: SwapOperationRecord, bindingValue: UniswapExecutionBinding, phase: "send_accepted" | "send_ambiguous", now: Date): Promise<UniswapExecutionEffect>;
    private transition;
    private loadUnlocked;
    private writeUnlocked;
    private path;
}
export declare function newUniswapExecutionEffect(input: Omit<UniswapExecutionEffect, "schemaVersion" | "integrityHash">): UniswapExecutionEffect;
export declare function validateEffect(value: unknown, operation: SwapOperationRecord, binding: UniswapExecutionBinding): Promise<UniswapExecutionEffect>;
