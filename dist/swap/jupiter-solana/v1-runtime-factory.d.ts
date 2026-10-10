import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import type { SolanaRpc } from "../../solana/rpc.js";
import { GuardedSwapRuntime } from "../runtime.js";
import { type JupiterV1QuoteRequest } from "./v1-builder.js";
export declare function assertJupiterV1Runtime(runtime: object, root: string): void;
export interface JupiterV1RuntimeOptions {
    readonly state: StateStore;
    readonly clock: ClockPort;
    readonly rpc: SolanaRpc;
    readonly wrappingSecret: WrappingSecretPort;
    readonly foreground: boolean;
    readonly stage: "quote" | "prepare" | "execute" | "observe";
    readonly operationId?: string;
    /** Official read-only API test transport. No injected signer, sender, custody, financial driver or approval actor. */
    readonly providerFetch?: typeof fetch;
}
/** Additive finite V1 lane. Existing V2/Quantum remains separately dormant. */
export declare function createJupiterV1Runtime(options: JupiterV1RuntimeOptions): GuardedSwapRuntime<JupiterV1QuoteRequest>;
