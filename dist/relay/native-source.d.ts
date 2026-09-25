import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { HttpsBaseRpc } from "../rpc.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
type Rpc = Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">;
type Phase = "pending" | "signing_started" | "sealed" | "submitting" | "confirmed" | "failed" | "failed_before_effect";
export interface RelayNativeSourceJournal {
    readonly schemaVersion: "apn.relay-native-source-journal.v1";
    readonly profileHash: string;
    readonly operationId: string;
    readonly operationIntegrityHash: string;
    readonly quoteDigest: string;
    readonly requestId: string;
    readonly depositEnvelopeHash: string;
    readonly phase: Phase;
    readonly marker: string | null;
    readonly markedAt: string | null;
    readonly transactionHash: string | null;
    readonly observedAt: string | null;
    readonly integrityHash: string;
}
/** Provider locator stays in the durable owner journal, never in CLI or MCP output. */
export declare function publicRelayNativeSourceJournal(journal: RelayNativeSourceJournal): {
    schemaVersion: "apn.relay-native-source-journal.v1";
    profileHash: string;
    operationId: string;
    operationIntegrityHash: string;
    quoteDigest: string;
    depositEnvelopeHash: string;
    phase: Phase;
    marker: string | null;
    markedAt: string | null;
    transactionHash: string | null;
    observedAt: string | null;
    integrityHash: string;
};
export declare class RelayNativeSourceJournalRepository extends SecureStateStore {
    private path;
    load(op: RelayUnsignedOperation): Promise<RelayNativeSourceJournal | null>;
    advance(op: RelayUnsignedOperation, expected: string | null, phase: Phase, hash?: string | null, now?: Date): Promise<RelayNativeSourceJournal>;
}
/** Persist the single dispatch marker before the send. Replays only return the marker. */
export declare function dispatchRelayNativeDepositOnce(op: RelayUnsignedOperation, journal: RelayNativeSourceJournal, store: RelayNativeSourceJournalRepository, send: (raw: Hex) => Promise<string>, raw: Hex, now: Date): Promise<RelayNativeSourceJournal>;
export interface RelayNativeSourcePorts {
    readonly confirm: (summary: {
        operationId: string;
        sourceChainId: 56;
        destinationChainId: 137;
        sourceAccount: string;
        recipient: string;
        amountAtomic: string;
        minOutputAtomic: string;
        deadline: string;
        quoteDigest: string;
        requestId: string;
        depositNetworkFeeCeilingWei: string;
        depository: string;
        valueWei: string;
    }) => Promise<boolean>;
    readonly rpc: Rpc;
}
export declare class RelayNativeSourceRuntime {
    private readonly state;
    private readonly ports;
    private readonly clock;
    private readonly origin?;
    private readonly wallets;
    private readonly permissions;
    private readonly journals;
    private readonly usage;
    constructor(state: StateStore, wrapping: WrappingSecretPort, ports: RelayNativeSourcePorts, clock?: ClockPort, origin?: string | undefined);
    execute(operationId: string): Promise<RelayNativeSourceJournal>;
    private assertLane;
    private owner;
    private usageIdentity;
    private active;
    private admission;
    private funding;
    private custody;
    private observe;
    private run;
    private settleUsage;
    /** The only closure without a chain result: journal has no hash or send marker,
     * and encrypted custody is proven empty under its mutation lock. */
    private closeUnsignedAttempt;
}
export declare function createRelayNativeSourceRuntime(state: StateStore, wrapping: WrappingSecretPort, rpcUrl: string, confirm: RelayNativeSourcePorts["confirm"], clock?: ClockPort, transport?: Rpc): RelayNativeSourceRuntime;
export {};
