import type { ClockPort, IdPort, NativePort, NativeRequest, RpcPort } from "./ports.js";
import type { StateStore } from "./state.js";
export interface CoreDependencies {
    readonly state: StateStore;
    readonly native?: NativePort;
    readonly rpc?: RpcPort;
    readonly clock?: ClockPort;
    readonly ids?: IdPort;
}
export declare class RuntimeContext {
    readonly state: StateStore;
    readonly native?: NativePort;
    readonly rpc?: RpcPort;
    readonly clock: ClockPort;
    readonly ids: IdPort;
    private initialized;
    constructor(dependencies: CoreDependencies);
    ready(): Promise<void>;
    requireNative(): NativePort;
    requireRpc(): RpcPort;
    nativeRequest(operation: NativeRequest["operation"], payload: Readonly<Record<string, unknown>>): NativeRequest;
}
