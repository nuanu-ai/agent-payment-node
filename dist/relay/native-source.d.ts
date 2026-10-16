import type { WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
type Rpc = Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">;
export { RelayNativeSourceJournalRepository, dispatchRelayNativeDepositOnce, publicRelayNativeSourceJournal, type RelayNativeSourceJournal } from "./native-source-journal.js";
import { type RelayNativeSourceJournal } from "./native-source-journal.js";
export interface RelayNativeSourcePorts {
    readonly confirm: (summary: {
        operationId: string;
        sourceChainId: 56 | 8453;
        destinationChainId: 137 | 143 | 4326;
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
    #private;
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
    private unsentOutcome;
    /** Only after the journal records the sealed bytes as never landing. */
    private discardCustody;
    /** The only closure without a chain result: journal has no hash or send marker,
     * and encrypted custody is proven empty under its mutation lock. */
    private closeUnsignedAttempt;
}
export declare function createRelayNativeSourceRuntime(state: StateStore, wrapping: WrappingSecretPort, rpcUrl: string, confirm: RelayNativeSourcePorts["confirm"], clock?: ClockPort, transport?: Rpc): RelayNativeSourceRuntime;
