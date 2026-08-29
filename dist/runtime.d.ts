import type { ClockPort, HttpPort, IdPort, NativePort, NativeRequest, RpcPort, WaitPort } from "./ports.js";
import type { ProfilePolicyPort } from "./profile-policy.js";
import type { StateStore } from "./state.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { ForegroundAuthenticationPort, ProviderProfileRepositoryPort, ProviderRegistryPort } from "./provider-ports.js";
export interface CoreDependencies {
    readonly state: StateStore;
    readonly native?: NativePort;
    readonly keychainProbe?: Pick<WrappingSecretPort, "load">;
    readonly rpc?: RpcPort;
    readonly http?: HttpPort;
    readonly clock?: ClockPort;
    readonly ids?: IdPort;
    readonly policy?: ProfilePolicyPort;
    readonly wait?: WaitPort;
    readonly profileRepository?: ProviderProfileRepositoryPort;
    readonly providerRegistry?: ProviderRegistryPort;
    readonly foregroundAuthentication?: ForegroundAuthenticationPort;
}
export declare class RuntimeContext {
    readonly state: StateStore;
    readonly native?: NativePort;
    readonly keychainProbe?: Pick<WrappingSecretPort, "load">;
    readonly rpc?: RpcPort;
    readonly http?: HttpPort;
    readonly clock: ClockPort;
    readonly ids: IdPort;
    readonly policy?: ProfilePolicyPort;
    readonly wait: WaitPort;
    readonly profileRepository?: ProviderProfileRepositoryPort;
    readonly providerRegistry?: ProviderRegistryPort;
    readonly foregroundAuthentication?: ForegroundAuthenticationPort;
    private initialized;
    constructor(dependencies: CoreDependencies);
    ready(): Promise<void>;
    requireNative(): NativePort;
    requireKeychainProbe(): Pick<WrappingSecretPort, "load">;
    requireRpc(): RpcPort;
    requireHttp(): HttpPort;
    requirePolicy(): ProfilePolicyPort;
    requireProfileRepository(): ProviderProfileRepositoryPort;
    requireProviderRegistry(): ProviderRegistryPort;
    requireForegroundAuthentication(): ForegroundAuthenticationPort;
    nativeRequest(operation: NativeRequest["operation"], payload: Readonly<Record<string, unknown>>): NativeRequest;
}
