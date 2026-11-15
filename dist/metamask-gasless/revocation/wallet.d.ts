import type { Address, Hex } from "../../model.js";
import { type MetaMaskProcessRunnerPort } from "../../metamask-process-runner.js";
import { type MetaMaskCliPayload, type MetaMaskServerTransactionPort } from "../../metamask-server-transaction.js";
import type { MetaMaskSubmitDiagnostic } from "../client/submit-diagnostic.js";
/**
 * What the wallet answered for the one disable request, named by the hash of APN's own request id in every answer. An
 * unknown answer is not proof that nothing was sent; the revoke's next actions say which chain reads must hold before
 * another disable. It names MetaMask's error code from a refusing answer (`providerErrorCode`), the request's job status
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
export interface MetaMaskRevocationWalletPort {
    send(input: {
        readonly chainId: number;
        readonly from: Address;
        readonly payload: MetaMaskCliPayload;
        readonly intent: string;
    }): Promise<MetaMaskRevocationSubmission>;
}
/**
 * The owner's MetaMask server wallet signs and broadcasts the disable after its own Guard policy and MFA. APN first
 * checks with the MetaMask Agent Wallet CLI that its selected wallet is the delegator (a read): a selected wallet that
 * differs refuses before anything is handed over. APN then names the request id itself and sends the request once
 * through the sandboxed MetaMask helper the gasless lane uses (metamask-server-transaction.ts): the very request
 * `mm wallet send-transaction` sent for the same payload and intent, from mm's signed-in session in whichever project
 * holds the server wallet, as before. mm's own local request list does not hold it.
 */
export declare class MetaMaskSdkRevocationWallet implements MetaMaskRevocationWalletPort {
    private readonly runner;
    private readonly client;
    constructor(runner?: MetaMaskProcessRunnerPort, client?: MetaMaskServerTransactionPort);
    send(input: Parameters<MetaMaskRevocationWalletPort["send"]>[0]): Promise<MetaMaskRevocationSubmission>;
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
/** The provider's request id stays private; its hash names it in output, as it has since 0.5.105. */
export declare function metaMaskRevocationRequestIdHash(requestId: string): string;
