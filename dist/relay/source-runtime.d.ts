import type { WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
import { type RelayEffectJournal } from "./effect-journal.js";
/** BRDG-22: the deposit may follow the approval once the approval's receipt is canonical with this many blocks on
 * top; its nonce comes after the approval's, so it can never execute without it, and its own success still needs
 * finality. A reverted approval is recorded only once final. */
export declare const RELAY_APPROVAL_CONFIRMATIONS = 2n;
/** Bounded in-run wait for a just-sent approval to reach that depth, so one confirmed run usually sends both legs. */
export interface RelayApprovalInclusionWait {
    readonly polls: number;
    readonly delayMs: number;
}
export declare const RELAY_APPROVAL_INCLUSION_WAIT: RelayApprovalInclusionWait;
export interface RelayExecutionSummary {
    readonly operationId: string;
    readonly sourceChainId: 1;
    readonly destinationChainId: 56 | 8453;
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
export declare function createRelayEthereumSourceRuntime(state: StateStore, wrappingSecret: WrappingSecretPort, rpcUrl: string, authorization: RelayExecutionAuthorizationPort, clock?: ClockPort, transport?: Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">, approvalWait?: RelayApprovalInclusionWait): RelayEthereumSourceRuntime;
/** The constructor accepts an injected RPC surface so tests can never reach a network. */
export declare class RelayEthereumSourceRuntime {
    private readonly state;
    private readonly transport;
    private readonly authorization;
    private readonly clock;
    private readonly pacedOrigin?;
    private readonly approvalWait;
    private readonly wallets;
    private readonly permissions;
    private readonly admissions;
    private readonly usage;
    private readonly approvalCustody;
    private readonly depositCustody;
    private readonly rpcScope;
    private signingNonce;
    /** One chain-id check per execute invocation (P2); approvals proven in this invocation are not re-read. */
    private chainVerified;
    private readonly provenApprovals;
    constructor(state: StateStore, wrapping: WrappingSecretPort, transport: Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">, authorization: RelayExecutionAuthorizationPort, clock?: ClockPort, pacedOrigin?: string | undefined, approvalWait?: RelayApprovalInclusionWait);
    private get rpc();
    execute(operationId: string): Promise<RelayEffectJournal>;
    private executeScoped;
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
    /** Prepends eth_chainId to the first read batch of an invocation and checks it (P2: once per invocation). */
    private read;
    /** Two POSTs: the latest head, then balance, token balance and allowance pinned to its hash (EIP-1898,
     * requireCanonical), the pending nonce and the tip. The pinned reads need no header re-read (P2). */
    private funding;
    private sign;
    private observeApproval;
    private observeDeposit;
    /** Two POSTs: transaction, receipt and the latest and finalized heads, then the canonical block at the receipt
     * height. Heads read with the receipt and before that block make a header recheck redundant (P2). `included`
     * needs RELAY_APPROVAL_CONFIRMATIONS blocks on top; `finalized` needs the finalized head. */
    private observation;
    private updateUsage;
}
