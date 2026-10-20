import type { WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
import { type PostEffectReadFailure } from "../post-effect-read-failure.js";
type Rpc = Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">;
export { RelayNativeSourceJournalRepository, dispatchRelayNativeDepositOnce, publicRelayNativeSourceJournal, type RelayNativeSourceJournal } from "./native-source-journal.js";
import { type RelayNativeSourceJournal } from "./native-source-journal.js";
/** The journal; `observationFailure` only when this call dispatched the deposit and a later read or check failed. */
export type RelayNativeExecuteResult = RelayNativeSourceJournal & {
    readonly observationFailure?: PostEffectReadFailure;
};
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
    /** `profile` is the caller's explicit profile; the operation is found only under its hash (OWNR 4.1). */
    execute(profile: string, operationId: string): Promise<RelayNativeExecuteResult>;
    private assertLane;
    private owner;
    private usageIdentity;
    private active;
    /** Owner admission at every gate (prepare-of-execute, reservation, signing, first send): owner, policy, caps, mechanism
     * and the owner's optional recipient pin (OD-1). */
    private admission;
    /** Chain and head, then the balance pinned to the head hash (EIP-1898 requireCanonical) and the pending nonce; Base
     * adds its exact simulation and OP fee reads at that height. No header is re-read around pinned reads (P2). */
    private funding;
    private observe;
    private run;
    private settleUsage;
    private unsentOutcome;
}
export declare function createRelayNativeSourceRuntime(state: StateStore, wrapping: WrappingSecretPort, rpcUrl: string, confirm: RelayNativeSourcePorts["confirm"], clock?: ClockPort, transport?: Rpc): RelayNativeSourceRuntime;
