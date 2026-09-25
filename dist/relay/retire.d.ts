import { type WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { StateStore } from "../state.js";
export declare class RelayRetireService {
    private readonly state;
    private readonly clock;
    private readonly wrapping;
    constructor(state: StateStore, clock: ClockPort, wrapping?: WrappingSecretPort);
    retire(input: {
        readonly profile: string;
        readonly operationId: string;
    }): Promise<{
        proofClass: "saved_unsigned_quote";
        balanceEvidence: "not_checked";
        allowanceEvidence: "not_checked";
        statusObservable: boolean;
        executionAdmitted: false;
        nextActions: readonly [];
        state: "prepared" | "retired";
        terminal: boolean;
        retiredAt?: string;
        retirementIntegrityHash?: string;
        schemaVersion: "apn.relay-unsigned-operation.v1";
        kind: "relay_unsigned";
        profileHash: string;
        operationId: string;
        idempotencyHash: string;
        requestHash: string;
        sourceChainId: 1 | 56;
        destinationChainId: 56 | 137;
        sourceAccount: string;
        recipient: string;
        quoteDigest: string;
        amountAtomic: string;
        minOutputAtomic: string;
        createdAt: string;
        deadline: string;
        statusLocator?: {
            requestId: string;
            endpoint: string;
        } | undefined;
        quote?: import("./quote.js").ValidatedRelayQuote | undefined;
        nativeQuote?: import("./native-quote.js").ValidatedRelayNativeQuote | undefined;
        policyDigest?: string | undefined;
        policyRevision?: number | undefined;
        approvalNetworkFeeCeilingWei?: string | undefined;
        depositNetworkFeeCeilingWei?: string | undefined;
    }>;
}
