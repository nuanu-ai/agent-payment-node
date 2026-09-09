import type { MetaMaskGaslessBinding, MetaMaskGaslessProfileIdentity } from "./model.js";
import { type MetaMaskGaslessFailureReason } from "./reasons.js";
export declare function mmPrivateHash(kind: "project" | "wallet-id" | "wallet-reference" | "request-id", value: string, referenceKind?: "id" | "name" | "address"): string;
export declare function mmProfileIdentity(value: unknown): MetaMaskGaslessProfileIdentity;
/** The supported server service has no opaque wallet id. The legacy field binds its resolved address. */
export declare function mmWalletIdentityHash(address: unknown): string;
export declare function mmBinding(value: unknown, reason?: MetaMaskGaslessFailureReason): MetaMaskGaslessBinding;
export declare function mmAssertProfileBinding(binding: MetaMaskGaslessBinding, expected: MetaMaskGaslessProfileIdentity): void;
export declare function mmAssertSameBinding(current: unknown, expected: MetaMaskGaslessBinding): MetaMaskGaslessBinding;
