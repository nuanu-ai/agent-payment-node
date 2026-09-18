import type { Hex } from "../model.js";
import { USDT_GASLESS, usdtFailure, type UsdtTransferPlan, type UsdtTransferRequest } from "./model.js";
import { validateUsdtPaymasterData } from "./paymaster-data.js";
import { planUsdtTransfer, validateUsdtGasPrice, validateUsdtTokenQuote } from "./quote.js";
import { verifyUsdtReceipt, type UsdtChainReceipt, type UsdtSettlement } from "./receipt.js";
import { usdtUserOperation, usdtUserOperationHash, type UsdtAuthorization, type UsdtUserOperation } from "./userop.js";

/** Structurally valid, recoverable and never the owner's: the sponsor simulates with it and the account rejects it. */
export const USDT_ESTIMATE_SIGNATURE =
  `0x${"fffffffffffffffffffffffffffffff0"}${"0".repeat(32)}7${"a".repeat(63)}1c` as Hex;
const STUB_AUTHORIZATION_WORD = `0x${"11".repeat(32)}` as Hex;

/** Keyless public bundler and paymaster (one endpoint). `send` is called at most once per operation, ever. */
export interface UsdtSponsorPort {
  tokenQuote(): Promise<unknown>;
  gasPrice(): Promise<unknown>;
  paymasterData(op: UsdtUserOperation): Promise<unknown>;
  send(op: UsdtUserOperation): Promise<unknown>;
}
export interface UsdtAccountState {
  readonly usdtBalanceAtomic: bigint; readonly entryPointNonce: bigint; readonly eoaNonce: bigint; readonly delegation: "empty" | "expected";
}
/** Canonical chain reads only: pins, account state and the settlement receipt. */
export interface UsdtChainPort {
  /** Code hashes of token, EntryPoint, delegate and paymaster; USDT unpaused with zero transfer fee. Throws on drift. */
  verifyPins(): Promise<void>;
  account(sender: UsdtTransferRequest["sender"]): Promise<UsdtAccountState>;
  receiptFor(userOpHash: Hex): Promise<UsdtChainReceipt | null>;
}
/** The local key. Only `approveAndSend` reaches it, after the sponsor data is validated. */
export interface UsdtSignerPort {
  authorize(nonce: bigint): Promise<UsdtAuthorization>;
  signUserOperation(userOpHash: Hex): Promise<Hex>;
}
/** Durable operation journal. `markSending` must be on disk before the one send. */
export interface UsdtJournalPort {
  markSending(userOpHash: Hex): Promise<void>;
  markSent(userOpHash: Hex, bundlerResult: "accepted" | "unacknowledged"): Promise<void>;
}

/** Prepare: the exact token quote and fee plan. Reads the sponsor and pins only; no key, no signature. */
export async function quoteUsdtGasless(ports: { sponsor: UsdtSponsorPort; chain: UsdtChainPort },
  request: UsdtTransferRequest): Promise<UsdtTransferPlan> {
  await ports.chain.verifyPins();
  const quote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
  const { fast } = validateUsdtGasPrice(await ports.sponsor.gasPrice());
  return planUsdtTransfer(request, quote, fast);
}

/** Economic check after the quote: the sender must hold the gross, because N + A can reach N + F. */
export function assertUsdtFunding(plan: UsdtTransferPlan, account: UsdtAccountState): void {
  if (account.usdtBalanceAtomic < plan.request.grossAtomic) {
    usdtFailure("APN_INSUFFICIENT_ASSET", "gasless_usdt_balance_below_gross",
      `The sender holds ${account.usdtBalanceAtomic} atomic USDT; the transfer needs ${plan.request.grossAtomic}.`);
  }
}

/**
 * The sponsor's signed payload for this exact operation, requested with a structural signature. On a first use the
 * authorization is a stub with the account's real nonce; the sponsor signs over the delegate, not the tuple. This is the
 * last step before any signature and is what the read-only rehearsal runs.
 */
export async function sponsorUsdtOperation(sponsor: UsdtSponsorPort, plan: UsdtTransferPlan, account: UsdtAccountState,
  nowSeconds: bigint): Promise<Hex> {
  const stub = account.delegation === "empty" ? stubAuthorization(account.eoaNonce) : null;
  const draft = usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, paymasterData: "0x",
    signature: USDT_ESTIMATE_SIGNATURE, authorization: stub });
  const result = await sponsor.paymasterData(draft);
  validateUsdtPaymasterData(result, plan, nowSeconds);
  return (result as { paymasterData: Hex }).paymasterData.toLowerCase() as Hex;
}

export type UsdtSendOutcome =
  | { readonly state: "sent"; readonly userOpHash: Hex }
  | { readonly state: "send_unacknowledged"; readonly userOpHash: Hex };

/**
 * After the foreground approval and the allowlist reservation: fresh account state, sponsor data, then the signatures,
 * then the durable marker, then exactly one send. A failed marker write sends nothing; a lost send response is recorded
 * as unacknowledged and is only ever observed, never retried.
 */
export async function approveAndSendUsdtGasless(ports: { sponsor: UsdtSponsorPort; chain: UsdtChainPort; signer: UsdtSignerPort;
  journal: UsdtJournalPort }, plan: UsdtTransferPlan, nowSeconds: bigint): Promise<UsdtSendOutcome> {
  await ports.chain.verifyPins();
  const account = await ports.chain.account(plan.request.sender);
  assertUsdtFunding(plan, account);
  const paymasterData = await sponsorUsdtOperation(ports.sponsor, plan, account, nowSeconds);
  const authorization = account.delegation === "empty" ? await ports.signer.authorize(account.eoaNonce) : null;
  if (authorization !== null && BigInt(authorization.nonce) !== account.eoaNonce) {
    usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_authorization_nonce");
  }
  const unsigned = usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, paymasterData,
    signature: USDT_ESTIMATE_SIGNATURE, authorization });
  const userOpHash = usdtUserOperationHash(unsigned);
  const signature = await ports.signer.signUserOperation(userOpHash);
  const op = { ...unsigned, signature };
  await ports.journal.markSending(userOpHash);
  let answer: unknown;
  try { answer = await ports.sponsor.send(op); }
  catch {
    await ports.journal.markSent(userOpHash, "unacknowledged");
    return { state: "send_unacknowledged", userOpHash };
  }
  if (typeof answer !== "string" || answer.toLowerCase() !== userOpHash.toLowerCase()) {
    await ports.journal.markSent(userOpHash, "unacknowledged");
    return { state: "send_unacknowledged", userOpHash };
  }
  await ports.journal.markSent(userOpHash, "accepted");
  return { state: "sent", userOpHash };
}

export type UsdtObservation =
  | { readonly state: "pending" }
  | { readonly state: "completed"; readonly settlement: UsdtSettlement };

/** Status observes only: one canonical receipt read and its proof. It never signs, discloses or sends. */
export async function observeUsdtGasless(chain: UsdtChainPort, plan: UsdtTransferPlan, userOpHash: Hex): Promise<UsdtObservation> {
  const receipt = await chain.receiptFor(userOpHash);
  if (receipt === null) return { state: "pending" };
  return { state: "completed", settlement: verifyUsdtReceipt(plan, userOpHash, receipt) };
}

function stubAuthorization(nonce: bigint): UsdtAuthorization {
  return { chainId: "0x1", address: USDT_GASLESS.delegate, nonce: `0x${nonce.toString(16)}` as Hex, yParity: "0x0",
    r: STUB_AUTHORIZATION_WORD, s: STUB_AUTHORIZATION_WORD };
}
