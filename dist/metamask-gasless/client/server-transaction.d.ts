import type { Hex } from "../../model.js";
import { type MetaMaskGaslessFailureReason } from "../reasons.js";
import { type SubmitCheck } from "./submit-diagnostic.js";
import type { MetaMaskJobTx } from "./job-tx.js";
/**
 * One MetaMask server-wallet TRANSACTION request whose id APN names itself (a native transfer's USDC `transfer`, a
 * gasless revoke's `disableDelegation`). `tx` is the request's wire `tx`, built from the `--payload` APN used to hand
 * `mm wallet send-transaction` (metamask-server-transaction.ts): `from` is the sending server wallet, which must be the
 * signed-in session's selected wallet, and `chainId` the request's chain. `projectHash` is the plain SHA-256 of the
 * session project the request must be sent in, or null where any project that holds `from` may send it (the revoke).
 * `expiresAt` is the instant from which the POST never leaves: the network policy checks it right before the bytes go
 * (the native transfer's consent deadline; the revoke's send bound). It is not part of the request.
 */
export interface MetaMaskServerTransactionTx {
    readonly from: `0x${string}`;
    readonly to: `0x${string}`;
    readonly chainId: number;
    readonly data: Hex;
    readonly value: "0x0";
    readonly nonce: number;
    readonly gasLimit: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
}
export interface MetaMaskServerTransactionInput {
    readonly requestId: string;
    readonly projectHash: string | null;
    readonly tx: MetaMaskServerTransactionTx;
    readonly intent: string;
    readonly expiresAt: string;
}
/**
 * The server's answer to the one POST, as bound fields only: this request id, its job status token, a transaction hash
 * when the answer has one, and for `AWAITING_MFA` the owner-facing approval window (`approval.expiresAt` in its exact
 * form) and how the owner confirms (the session's own `authMethod`, as `mm` itself reads it). `responseHash` is the
 * SHA-256 of the answer's bytes. No approval detail, link, signature or other provider text leaves the helper.
 */
export interface MetaMaskServerTransactionAnswer {
    readonly requestId: string;
    readonly status: string;
    readonly txHash: Hex | null;
    readonly mfa: MetaMaskApprovalWindow | null;
    readonly responseHash: string;
}
export declare function serverTransactionInput(value: unknown): MetaMaskServerTransactionInput;
/**
 * The exact JSON the SDK's `EvmServerAdapter.submitTransaction` (fox-sdk 2.7.0, `RemoteSigningClient`) POSTs for this
 * request: `{ requestId, namespace: "evm", chainId, tx, txIntent }`, in that key order, with no `method`, `encoding`,
 * `bridgeQuoteId` or `signedTransaction`. The helper's network policy admits these bytes and no others.
 */
export declare function serverTransactionBody(input: MetaMaskServerTransactionInput): string;
/** The tx the helper hands the SDK, in `preparedToRemoteTx`'s field order, whatever order the input named its fields in. */
export declare function serverTransactionTx(input: MetaMaskServerTransactionInput): MetaMaskServerTransactionTx;
/** Which answer check refused, with the job status token and the `tx` facts, for the submit's closed diagnostic. */
export interface ServerTransactionProgress {
    check: SubmitCheck | undefined;
    providerStatus: string | null;
    tx: MetaMaskJobTx | undefined;
}
/**
 * The SDK's answer to the POST, checked as the gasless submit checks its own (client/service.ts): this request id, kind
 * transaction, a status token, `tx.from` the sender and `tx.chainId` its chain (a number), and a hash, when there is
 * one, of 32 lowercase bytes. An absent or null hash is no hash. Any other answer refuses with its check.
 */
export declare function serverTransactionAnswer(value: unknown, input: MetaMaskServerTransactionInput, responseHash: string | undefined, sessionAuthMethod: unknown, seen: ServerTransactionProgress): MetaMaskServerTransactionAnswer;
/**
 * The helper's answer as the parent accepts it, for the very request it was sent: exactly these fields, this request id
 * (another names another request: identity conflict), and an MFA window only for AWAITING_MFA.
 */
export declare function serverTransactionResult(value: unknown, input: MetaMaskServerTransactionInput): MetaMaskServerTransactionAnswer;
/** The owner-facing approval window of a request MetaMask holds for MFA: when it closes and how the owner confirms. */
export interface MetaMaskApprovalWindow {
    readonly expiresAt: string | null;
    readonly authMethod: string | null;
}
/**
 * For `AWAITING_MFA` only: the job's `approval.expiresAt` (as `mm` reads it from the job status it polls) in its exact
 * ISO form, and the signed-in session's `authMethod` (as `mm` reads `session.load()?.authMethod`); a value in any other
 * form is null, never guessed (metaMaskMfaNotice's rule). No other approval field leaves the helper.
 */
export declare function approvalWindow(status: string, approval: unknown, sessionAuthMethod: unknown): MetaMaskApprovalWindow | null;
/** The parent's check of a window the helper returned: present exactly for AWAITING_MFA, each field exact or null. */
export declare function assertApprovalWindow(value: unknown, status: string, reason: MetaMaskGaslessFailureReason): void;
