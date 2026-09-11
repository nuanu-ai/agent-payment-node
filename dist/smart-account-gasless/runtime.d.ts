import type { SmartAccountPermissionStorePort } from "../encrypted-smart-account-permission-store.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import type { StateStore } from "../state.js";
import type { SmartAccountGaslessDependencies } from "./service.js";
/** Construction is lazy: no profile, file, Keychain, RPC or provider access occurs here. */
export declare function smartAccountGaslessRuntime(input: {
    readonly state: StateStore;
    readonly permissions: SmartAccountPermissionStorePort;
    readonly wrapping: WrappingSecretPort;
    readonly clock: ClockPort;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly foregroundApproval: boolean;
}): SmartAccountGaslessDependencies;
