import type { Cleanup85CancellationPort, Cleanup85CancellationProof, Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { BridgeHttps } from "../lifi/https.js";
import { type TtyTransferApprovalOptions } from "../tty-approval.js";
import { type CircleOperationV1 } from "./operation-model.js";
export interface Cleanup85RecoveryDependencies {
    readonly cancellation: Cleanup85CancellationPort;
    /** Read-only independent native operation/material/claims/reservation/actual1+fee verifier. */
    readonly verifyCancellationAccounting: (state: StateStore, request: Cleanup85CancellationRequest, proof: Cleanup85CancellationProof) => Promise<void>;
}
/** Finite normal controller; money commands require the independently installed B/C backend.
 * No Circle lock is held across B.execute/inspect. Persisted proofs are never dispatch authority. */
export declare class Cleanup85RecoveryRuntime {
    private readonly state;
    private readonly env;
    private readonly now;
    private readonly tty;
    private readonly https;
    private readonly dependencies?;
    private readonly repo;
    private readonly usage;
    private readonly custody;
    constructor(state: StateStore, wrapping: WrappingSecretPort, env: Readonly<Record<string, string | undefined>>, now: () => number, tty: TtyTransferApprovalOptions, https: Pick<BridgeHttps, "request">, dependencies?: Cleanup85RecoveryDependencies | undefined);
    private remotes;
    publicStatus(id: string): Promise<{
        cleanup86?: {
            intentHash: string;
            envelopeHash: string;
            effect: import("./cleanup86-store.js").Cleanup86Effect | null;
            signClaimed: boolean;
            sendClaimed: boolean;
            materialMetadata: {
                transactionHash: import("viem").Hex;
                materialHash: string;
            } | null;
            firstPublicFailure: unknown;
        };
        recoveryBinding: string;
        windowEndsAt: string | null;
    } | null>;
    private backend;
    private frame;
    cancel(id: string): Promise<import("../circle-cleanup85-cancellation-contract.js").Cleanup85CancellationStatus>;
    approve86(id: string): Promise<CircleOperationV1>;
    observe(id: string): Promise<CircleOperationV1>;
    private verifyCancellation;
    private financialFrame;
    private financialGuard;
    private locked;
}
