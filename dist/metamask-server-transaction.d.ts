import type { Address } from "./model.js";
import { type MetaMaskServerTransactionAnswer, type MetaMaskServerTransactionInput, type MetaMaskServerTransactionTx } from "./metamask-gasless/client/server-transaction.js";
import { type MetaMaskSubmitDiagnostic } from "./metamask-gasless/client/submit-diagnostic.js";
import { type MetaMaskGaslessFailureReason } from "./metamask-gasless/reasons.js";
/**
 * The `--payload` APN handed `mm wallet send-transaction` up to 0.5.107, for the native transfer and the gasless revoke
 * alike: every field a `0x` hex string.
 */
export interface MetaMaskCliPayload {
    readonly to: string;
    readonly data: string;
    readonly value: string;
    readonly gas: string;
    readonly nonce: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
}
/**
 * The wire `tx` that `mm wallet send-transaction` (pinned @metamask/agent-wallet 6.1.5) POSTs for this `--payload` on
 * chain `chainId` from the server wallet `from`. mm parses the payload (evmInputs: `to` and `data` as
 * trimmed strings, `value`, `gas` and both fees as BigInt, `nonce` as a safe Number), its wallet client writes each
 * quantity back as `0x${value.toString(16)}` (`prepareViaController`), the transaction controller's normalizer
 * lowercases `from` and `to` (`normalizeTxParameters`), and `preparedToRemoteTx` names the fields `{ from, to, chainId,
 * data, value, nonce (a number), gasLimit (from gas), maxFeePerGas, maxPriorityFeePerGas }`, chainId being the chain's
 * number. mm's preparation reads (EIP-1559 support, a gas estimate or nonce only for absent fields, the native balance)
 * change none of these fields when, as here, every field is given. A payload APN would never write (another key, a
 * non-zero value, a field missing or malformed) refuses: nothing is guessed.
 */
export declare function metaMaskCliPayloadTx(payload: MetaMaskCliPayload, from: Address, chainId: number): MetaMaskServerTransactionTx;
/**
 * The helper's request for `payload` with APN's own request id, checked exactly as the helper will check it. Built
 * before the helper starts, so a malformed one refuses before anything could be sent.
 */
export declare function metaMaskServerTransaction(input: {
    readonly requestId: string;
    readonly projectHash: string | null;
    readonly from: Address;
    readonly chainId: number;
    readonly payload: MetaMaskCliPayload;
    readonly intent: string;
    readonly expiresAt: string;
}): MetaMaskServerTransactionInput;
/** Job statuses of a request MetaMask still works on before it has a transaction hash. */
export declare const MM_REQUEST_PENDING_STATUSES: readonly string[];
/** The statuses `mm` 6.1.5 itself reports as a failed request (cliWalletExecutor): the provider's word, never proof. */
export declare const MM_REQUEST_CLOSED_STATUSES: readonly string[];
/**
 * What one send says. `answered`: the helper's bound fields of the server's answer for this very request (the client
 * accepts no answer for another id, and this send checks it again). `unknown`: the helper failed once it may have
 * started, so the POST may have left; `provider_request_identity_conflict` when the server's answer named another
 * request; `diagnostic` is the submit's closed facts and `helperFailure` the helper's closed refusal reason, when they
 * came. Never a refusal before the send.
 */
export type MetaMaskServerTransactionOutcome = {
    readonly kind: "answered";
    readonly answer: MetaMaskServerTransactionAnswer;
} | {
    readonly kind: "unknown";
    readonly reason: "provider_request_identity_conflict" | "provider_handoff_outcome_unknown";
    readonly diagnostic?: MetaMaskSubmitDiagnostic;
    readonly helperFailure?: MetaMaskGaslessFailureReason;
};
export interface MetaMaskServerTransactionPort {
    submitServerTransaction(transaction: MetaMaskServerTransactionInput, timeoutMs: number): Promise<MetaMaskServerTransactionAnswer>;
}
/** Sends `transaction` once through the sandboxed MetaMask helper; it never throws and never sends again. */
export declare function sendMetaMaskServerTransaction(transaction: MetaMaskServerTransactionInput, timeoutMs: number, client?: MetaMaskServerTransactionPort): Promise<MetaMaskServerTransactionOutcome>;
