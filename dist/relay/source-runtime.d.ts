import type { WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
import { type RelayEffectJournal } from "./effect-journal.js";
export interface RelayExecutionSummary {
    readonly operationId: string;
    readonly sourceChainId: 1;
    readonly destinationChainId: 56;
    readonly sourceAccount: string;
    readonly sourceToken: string;
    readonly amountAtomic: string;
    readonly recipient: string;
    readonly minOutputAtomic: string;
    readonly deadline: string;
    readonly requestId: string;
    readonly quoteDigest: string;
    readonly approvalNetworkFeeCeilingWei: string;
    readonly depositNetworkFeeCeilingWei: string;
}
export interface RelayExecutionAuthorizationPort {
    confirm(summary: RelayExecutionSummary): Promise<boolean>;
}
/** Production constructor uses one explicit public HTTPS Ethereum RPC, with no Relay credential. */
export declare function createRelayEthereumSourceRuntime(state: StateStore, wrappingSecret: WrappingSecretPort, rpcUrl: string, authorization: RelayExecutionAuthorizationPort, clock?: ClockPort): RelayEthereumSourceRuntime;
/** The constructor accepts an injected RPC surface so tests can never reach a network. */
export declare class RelayEthereumSourceRuntime {
    private readonly state;
    private readonly rpc;
    private readonly authorization;
    private readonly clock;
    private readonly wallets;
    private readonly permissions;
    private readonly admissions;
    private readonly usage;
    private readonly approvalCustody;
    private readonly depositCustody;
    private signingNonce;
    constructor(state: StateStore, wrapping: WrappingSecretPort, rpc: Pick<HttpsBaseRpc, "batchCall" | "coinbaseGaslessCall" | "submitRawTransaction">, authorization: RelayExecutionAuthorizationPort, clock?: ClockPort);
    execute(operationId: string): Promise<RelayEffectJournal>;
    private usageIdentity;
    private usageReservationId;
    /** Profile/operation -> encrypted custody -> exact usage bucket. A journal with
     * any marker, or either signed-material slot, forbids cap release. */
    private withNoEffectProof;
    private reconcilePreEffectReservation;
    private assertPrepared;
    private summary;
    private assertReady;
    private assertOwner;
    private activePolicy;
    private publicAccount;
    private dailyUsageExcludingOwn;
    private funding;
    private sign;
    private observeApproval;
    private observeDeposit;
    private observation;
    private updateUsage;
}
