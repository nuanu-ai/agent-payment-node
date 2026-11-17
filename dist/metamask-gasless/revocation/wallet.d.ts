import type { Address, Hex } from "../../model.js";
import { type MetaMaskNativeRequestBinding, type MetaMaskNativeServerRequestAnswer, type MetaMaskNativeServerRequestPort } from "../../metamask-native-request-server-read.js";
import { type MetaMaskProcessRunnerPort } from "../../metamask-process-runner.js";
import { type MetaMaskCliPayload, type MetaMaskServerTransactionPort } from "../../metamask-server-transaction.js";
import type { MetaMaskServerTransactionInput } from "../client/server-transaction.js";
import type { MetaMaskSubmitDiagnostic } from "../client/submit-diagnostic.js";
import { type MetaMaskRevocationReadPort, type MetaMaskRevocationSessionProject } from "./requests.js";
/**
 * What the wallet answered for the one disable request, named in every answer by the hash of APN's own request id
 * (`metaMaskRevocationRequestIdHash`, the hash its seal is filed under). An unknown answer is not proof that nothing was
 * sent; the revoke's next actions say which chain reads must hold before another disable. It names MetaMask's error code from a refusing answer (`providerErrorCode`), the request's job status
 * when MetaMask answered one APN does not treat as live (`providerStatus`), the send's closed facts (`submitDiagnostic`)
 * and the helper's own closed refusal reason (`helperFailure`, an `mm_gasless_*` reason), so its cause can be read later.
 */
export type MetaMaskRevocationSubmission = {
    readonly disposition: "acknowledged";
    readonly transactionHash: Hex;
    readonly requestIdHash: string;
} | {
    readonly disposition: "pending";
    readonly requestIdHash: string;
} | {
    readonly disposition: "unknown";
    readonly reason: string;
    readonly requestIdHash: string;
    readonly transactionHash?: Hex;
    readonly providerStatus?: string;
    readonly providerErrorCode?: string;
    readonly submitDiagnostic?: MetaMaskSubmitDiagnostic;
    readonly helperFailure?: string;
};
/** One disable request, under the id APN named for it (a v4 UUID). */
export interface MetaMaskRevocationSendInput {
    readonly requestId: string;
    readonly chainId: number;
    readonly from: Address;
    readonly payload: MetaMaskCliPayload;
    readonly intent: string;
}
/**
 * The owner's wallet in two steps around the seal of the request id: `check` before it (nothing is sealed when it
 * refuses), `send` after it, of exactly the request `check` built.
 */
export interface MetaMaskRevocationWalletPort {
    /**
     * The selected-wallet check, then the helper's request for `input` built and checked, with its send bound; nothing is
     * sent. The send takes exactly this object, so nothing is built again after the seal.
     */
    check(input: MetaMaskRevocationSendInput): Promise<MetaMaskServerTransactionInput>;
    /** Sends the checked request once under its sealed id; never sends it again. */
    send(request: MetaMaskServerTransactionInput): Promise<MetaMaskRevocationSubmission>;
}
/**
 * The owner's MetaMask server wallet signs and broadcasts the disable after its own Guard policy and MFA. `check` asks
 * the MetaMask Agent Wallet CLI whether its selected wallet is the delegator (a read): a selected wallet that differs
 * refuses before anything is sealed or handed over. `send` sends the request, under the id APN named and sealed, once
 * through the sandboxed MetaMask helper the gasless lane uses (metamask-server-transaction.ts): the very request
 * `mm wallet send-transaction` sent for the same payload and intent, from mm's signed-in session in whichever project
 * holds the server wallet, as before. mm's own local request list does not hold it. For `operation resume` it also
 * reads a sealed request again: the session's project from `mm auth status`, then the request by its id from
 * MetaMask's server through the same helper (the read the native transfer uses).
 */
export declare class MetaMaskSdkRevocationWallet implements MetaMaskRevocationWalletPort, MetaMaskRevocationReadPort {
    private readonly runner;
    private readonly client;
    constructor(runner?: MetaMaskProcessRunnerPort, client?: MetaMaskServerTransactionPort & MetaMaskNativeServerRequestPort);
    check(input: MetaMaskRevocationSendInput): Promise<MetaMaskServerTransactionInput>;
    send(request: MetaMaskServerTransactionInput): Promise<MetaMaskRevocationSubmission>;
    sessionProject(): Promise<MetaMaskRevocationSessionProject>;
    read(requestId: string, projectHash: string, binding: MetaMaskNativeRequestBinding): Promise<MetaMaskNativeServerRequestAnswer>;
}
/**
 * Why the disable never reached the network, when the helper's own closed facts say so: its deadline or clock check right
 * before the bytes would go, its process that never started, the session read (another project or selected wallet,
 * signed out or expired, another `mm` writing its files, files not private to this user, or files that could not be
 * read), the SDK load, the SDK's session restore, or the SDK's server wallet. Any other fact is `undefined`: the request
 * may have left. The disposition stays unknown either way; only the next step differs.
 */
export type MetaMaskRevocationUnsentCause = "deadline" | "clock" | "launch" | "session_binding" | "session_signed_out" | "session_busy" | "session_permissions" | "session_files" | "sdk_load" | "hydrate" | "binding";
export declare function metaMaskRevocationUnsentCause(submission: MetaMaskRevocationSubmission): MetaMaskRevocationUnsentCause | undefined;
