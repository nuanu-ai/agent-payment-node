import type { Hex } from "../model.js";
import { USDT_GASLESS, usdtFailure, type UsdtTransferPlan, type UsdtTransferRequest } from "./model.js";
import { validateUsdtPaymasterData } from "./paymaster-data.js";
import { planUsdtTransfer, validateUsdtGasPrice, validateUsdtTokenQuote } from "./quote.js";
import { verifyUsdtReceipt, type UsdtChainReceipt, type UsdtSettlement } from "./receipt.js";
import { usdtUserOperation, type UsdtAuthorization, type UsdtUserOperation } from "./userop.js";

/** Read-only sponsor surface. There is deliberately no signing or submission method. */
export interface UsdtSponsorPort {
  tokenQuote(): Promise<unknown>;
  gasPrice(): Promise<unknown>;
  paymasterData(op: UsdtUserOperation): Promise<unknown>;
  receiptLocator(userOpHash: Hex): Promise<Hex | null>;
}
export interface UsdtAccountState {
  readonly usdtBalanceAtomic: bigint; readonly entryPointNonce: bigint; readonly eoaNonce: bigint; readonly delegation: "empty" | "expected";
}
/** Canonical chain reads only: pins, account state and settlement receipt. */
export interface UsdtChainPort {
  verifyPins(): Promise<void>;
  account(sender: UsdtTransferRequest["sender"]): Promise<UsdtAccountState>;
  receiptAt(transactionHash: Hex, finality?: "safe" | "finalized"): Promise<UsdtChainReceipt | null>;
}

export async function quoteUsdtGasless(ports: { sponsor: UsdtSponsorPort; chain: UsdtChainPort }, request: UsdtTransferRequest): Promise<UsdtTransferPlan> {
  await ports.chain.verifyPins();
  const quote = validateUsdtTokenQuote(await ports.sponsor.tokenQuote());
  const { fast } = validateUsdtGasPrice(await ports.sponsor.gasPrice());
  return planUsdtTransfer(request, quote, fast);
}

export function assertUsdtFunding(plan: UsdtTransferPlan, account: UsdtAccountState): void {
  if (account.usdtBalanceAtomic < plan.request.grossAtomic) usdtFailure("APN_INSUFFICIENT_ASSET", "gasless_usdt_balance_below_gross",
    `The sender holds ${account.usdtBalanceAtomic} atomic USDT; the transfer needs ${plan.request.grossAtomic}.`);
}

const ESTIMATE_SIGNATURE = `0x${"fffffffffffffffffffffffffffffff0"}${"0".repeat(32)}7${"a".repeat(63)}1c` as Hex;
const STUB_WORD = `0x${"11".repeat(32)}` as Hex;
function stubAuthorization(nonce: bigint): UsdtAuthorization {
  return { chainId: "0x1", address: USDT_GASLESS.delegate, nonce: `0x${nonce.toString(16)}` as Hex, yParity: "0x0", r: STUB_WORD, s: STUB_WORD };
}

/** Requests and validates sponsor data against the exact unsigned operation. No key or effect is reachable here. */
export async function sponsorUsdtOperation(sponsor: UsdtSponsorPort, plan: UsdtTransferPlan, account: UsdtAccountState, nowSeconds: bigint): Promise<Hex> {
  const authorization = account.delegation === "empty" ? stubAuthorization(account.eoaNonce) : null;
  const draft = usdtUserOperation(plan, { entryPointNonce: account.entryPointNonce, callData: "0x", paymasterData: "0x", signature: ESTIMATE_SIGNATURE, authorization });
  const result = await sponsor.paymasterData(draft);
  validateUsdtPaymasterData(result, plan, nowSeconds);
  return (result as { paymasterData: Hex }).paymasterData.toLowerCase() as Hex;
}

export type UsdtObservation = { readonly state: "pending" } | { readonly state: "completed"; readonly settlement: UsdtSettlement };
export async function observeUsdtGasless(ports: { sponsor: Pick<UsdtSponsorPort, "receiptLocator">; chain: UsdtChainPort }, plan: UsdtTransferPlan, userOpHash: Hex): Promise<UsdtObservation> {
  const locator = await ports.sponsor.receiptLocator(userOpHash);
  if (locator === null) return { state: "pending" };
  const receipt = await ports.chain.receiptAt(locator);
  if (receipt === null) return { state: "pending" };
  return { state: "completed", settlement: verifyUsdtReceipt(plan, userOpHash, receipt) };
}
