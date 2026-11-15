import { isPlainRecord } from "../../canonical.js";
import type { Hex } from "../../model.js";
import { mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";
import { mmCanonicalAddress, mmExact, mmHash, mmHex, mmUuid } from "../validation.js";
import { jobTx } from "./job-tx.js";
import { submitToken, type SubmitCheck } from "./submit-diagnostic.js";
import type { MetaMaskJobTx } from "./job-tx.js";

/**
 * One MetaMask server-wallet TRANSACTION request whose id APN names itself (a native transfer's USDC `transfer`, a
 * gasless revoke's `disableDelegation`). `tx` is the request's wire `tx`, built from the `--payload` APN used to hand
 * `mm wallet send-transaction` (metamask-server-transaction.ts): `from` is the sending server wallet, which must be the
 * signed-in session's selected wallet, and `chainId` the request's chain. `projectHash` is the plain SHA-256 of the
 * session project the request must be sent in, or null where any project that holds `from` may send it (the revoke).
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
  readonly mfa: { readonly expiresAt: string | null; readonly authMethod: string | null } | null;
  readonly responseHash: string;
}

const INPUT: MetaMaskGaslessFailureReason = "mm_gasless_input", ANSWER: MetaMaskGaslessFailureReason = "mm_gasless_submit_unknown";
/** `0x` and the lowest-case hex digits of a quantity with no leading zero, as `mm` writes `0x${value.toString(16)}`. */
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const INTENT = /^[\x21-\x7e](?:[\x20-\x7e]{0,510}[\x21-\x7e])?$/u;
const TX_KEYS = ["from", "to", "chainId", "data", "value", "nonce", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"] as const;

export function serverTransactionInput(value: unknown): MetaMaskServerTransactionInput {
  const i = mmExact(value, ["requestId", "projectHash", "tx", "intent"], INPUT);
  // A canonical v4 UUID only, as the SDK itself would generate one.
  mmUuid(i.requestId, INPUT);
  if (i.projectHash !== null) mmHash(i.projectHash, INPUT);
  if (typeof i.intent !== "string" || !INTENT.test(i.intent)) mmFail(INPUT);
  const t = mmExact(i.tx, TX_KEYS, INPUT);
  mmCanonicalAddress(t.from, INPUT); mmCanonicalAddress(t.to, INPUT); mmHex(t.data, undefined, INPUT);
  if (!Number.isSafeInteger(t.chainId) || Number(t.chainId) < 1 || t.value !== "0x0" ||
    !Number.isSafeInteger(t.nonce) || Number(t.nonce) < 0 ||
    [t.gasLimit, t.maxFeePerGas, t.maxPriorityFeePerGas].some(item => typeof item !== "string" || !QUANTITY.test(item))) mmFail(INPUT);
  return i as unknown as MetaMaskServerTransactionInput;
}

/**
 * The exact JSON the SDK's `EvmServerAdapter.submitTransaction` (fox-sdk 2.7.0, `RemoteSigningClient`) POSTs for this
 * request: `{ requestId, namespace: "evm", chainId, tx, txIntent }`, in that key order, with no `method`, `encoding`,
 * `bridgeQuoteId` or `signedTransaction`. The helper's network policy admits these bytes and no others.
 */
export function serverTransactionBody(input: MetaMaskServerTransactionInput): string {
  return JSON.stringify({ requestId: input.requestId, namespace: "evm", chainId: input.tx.chainId, tx: serverTransactionTx(input), txIntent: input.intent });
}
/** The tx the helper hands the SDK, in `preparedToRemoteTx`'s field order, whatever order the input named its fields in. */
export function serverTransactionTx(input: MetaMaskServerTransactionInput): MetaMaskServerTransactionTx {
  const t = input.tx;
  return { from: t.from, to: t.to, chainId: t.chainId, data: t.data, value: t.value, nonce: t.nonce, gasLimit: t.gasLimit,
    maxFeePerGas: t.maxFeePerGas, maxPriorityFeePerGas: t.maxPriorityFeePerGas };
}

/** Which answer check refused, with the job status token and the `tx` facts, for the submit's closed diagnostic. */
export interface ServerTransactionProgress { check: SubmitCheck | undefined; providerStatus: string | null; tx: MetaMaskJobTx | undefined }

/**
 * The SDK's answer to the POST, checked as the gasless submit checks its own (client/service.ts): this request id, kind
 * transaction, a status token, `tx.from` the sender and `tx.chainId` its chain (a number), and a hash, when there is
 * one, of 32 lowercase bytes. An absent or null hash is no hash. Any other answer refuses with its check.
 */
export function serverTransactionAnswer(value: unknown, input: MetaMaskServerTransactionInput, responseHash: string | undefined,
  sessionAuthMethod: unknown, seen: ServerTransactionProgress): MetaMaskServerTransactionAnswer {
  const refuse = (check: SubmitCheck): never => { seen.check = check; return mmFail(ANSWER); };
  if (!isPlainRecord(value) || responseHash === undefined) return refuse("response_body");
  if (value.requestId !== input.requestId) return refuse("response_request_id");
  if (value.kind !== "transaction") return refuse("response_kind");
  const status = submitToken(value.status);
  if (status === null) { seen.providerStatus = null; return refuse("response_status"); }
  if (!isPlainRecord(value.tx) || String(value.tx.from).toLowerCase() !== input.tx.from || value.tx.chainId !== input.tx.chainId) {
    seen.tx = jobTx(value.tx, { binding: { address: input.tx.from }, request: { chainId: input.tx.chainId } }); seen.providerStatus = status;
    return refuse("response_tx");
  }
  if (value.txHash !== undefined && value.txHash !== null) seen.check = "response_hash";
  const txHash = value.txHash === undefined || value.txHash === null ? null : mmHex(value.txHash, 32, ANSWER);
  seen.check = undefined;
  const approval = isPlainRecord(value.approval) ? value.approval : {};
  const mfa = status === "AWAITING_MFA" ? { expiresAt: exactInstant(approval.expiresAt), authMethod: authMethodToken(sessionAuthMethod) } : null;
  return { requestId: input.requestId, status, txHash, mfa, responseHash };
}

/** The helper's answer as the parent accepts it: exactly these fields, a v4 id, and an MFA window only for AWAITING_MFA. */
export function serverTransactionResult(value: unknown): MetaMaskServerTransactionAnswer {
  const r = mmExact(value, ["requestId", "status", "txHash", "mfa", "responseHash"], ANSWER);
  mmUuid(r.requestId, ANSWER); mmHash(r.responseHash, ANSWER);
  const status = submitToken(r.status);
  if (status === null || (r.txHash !== null && mmHex(r.txHash, 32, ANSWER) !== r.txHash)) mmFail(ANSWER);
  if (status !== "AWAITING_MFA" ? r.mfa !== null : !isPlainRecord(r.mfa)) mmFail(ANSWER);
  if (r.mfa !== null) {
    const m = mmExact(r.mfa, ["expiresAt", "authMethod"], ANSWER);
    if (m.expiresAt !== exactInstant(m.expiresAt) || m.authMethod !== authMethodToken(m.authMethod)) mmFail(ANSWER);
  }
  return r as unknown as MetaMaskServerTransactionAnswer;
}

/** An instant in its exact ISO form, or null: a value in any other form is never guessed (metaMaskMfaNotice's rule). */
function exactInstant(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
}
function authMethodToken(value: unknown): string | null {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/u.test(value) ? value : null;
}
