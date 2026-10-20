import { encodeFunctionData, parseAbi } from "viem";
import { exactKeys, hashObject, isPlainRecord, sha256 } from "../../canonical.js";
import { mmQuoteHash } from "../economics.js";
import { MM_MAX_UINT, type MetaMaskGaslessQuote } from "../model.js";
import { mmFail } from "../reasons.js";
import type { ModeContext } from "./network.js";
import type { NativeGasFacts, ReadValidationPredicate, SentinelFeeFacts, TokenFeesKind } from "./read-diagnostic.js";

const transferAbi = parseAbi(["function transfer(address,uint256) returns (bool)"]);

/** Closed facts of one classified Sentinel validation failure, read only from the very error it threw. */
export interface SentinelFailure {
  readonly validationPredicate: ReadValidationPredicate;
  readonly tokenFeesShape?: TokenFeesKind;
  readonly feeFacts?: SentinelFeeFacts & Partial<NativeGasFacts>;
}
export function sentinelFailure(error: unknown): SentinelFailure | undefined {
  if (error === null || typeof error !== "object" || !validationPredicates.has(error)) return undefined;
  const shape = tokenFeesShapes.get(error), facts = feeFacts.get(error);
  return { validationPredicate: validationPredicates.get(error)!, ...(shape === undefined ? {} : { tokenFeesShape: shape }),
    ...(facts === undefined ? {} : { feeFacts: facts }) };
}
/** The one matching token-fee entry of an answer `validateSentinelResponse` already accepted, in USDC atoms. */
export function sentinelQuotedFee(value: Record<string, unknown>, token: string): bigint {
  const transactions = (value.result as Record<string, unknown>).transactions as Record<string, unknown>[];
  const tokenFees = ((transactions.at(-1)!.fees as Record<string, unknown>[])[0]!.tokenFees) as Record<string, unknown>[];
  const entry = tokenFees.find(candidate => String((candidate.token as Record<string, unknown>).address).toLowerCase() === token)!;
  return BigInt(entry.balanceNeededToken as string);
}
const validationPredicates = new WeakMap<object, ReadValidationPredicate>();
const tokenFeesShapes = new WeakMap<object, TokenFeesKind>();
const feeFacts = new WeakMap<object, SentinelFeeFacts & Partial<NativeGasFacts>>();
function sentinelRequire(condition: boolean, predicate: ReadValidationPredicate, shape?: TokenFeesKind,
  facts?: SentinelFeeFacts & Partial<NativeGasFacts>): void {
  if (condition) return;
  // A well-formed answer without a token-fee list is MetaMask's own answer (its SDK reads it as an uncovered
  // transfer plus fee); any other shape stays a provider protocol failure.
  try { mmFail(shape === "missing" || shape === "null" ? "mm_gasless_fee_unquoted" : "mm_gasless_provider_unavailable"); }
  catch (error) {
    if (error !== null && typeof error === "object") {
      validationPredicates.set(error, predicate);
      if (shape !== undefined) tokenFeesShapes.set(error, shape);
      if (facts !== undefined) feeFacts.set(error, facts);
    }
    throw error;
  }
}
export function parseSentinelResponse(body: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(body); } catch { sentinelRequire(false, "response_json"); }
  sentinelRequire(isPlainRecord(value), "response_root");
  return value as Record<string, unknown>;
}
export function validateSentinelResponse(value: Record<string, unknown>, context: ModeContext): void {
  sentinelRequire(context.mode === "quote", "sentinel_mode");
  sentinelRequire(exactKeys(value, ["jsonrpc", "id", "result"]), "sentinel_keys");
  sentinelRequire(value.jsonrpc === "2.0", "sentinel_jsonrpc");
  sentinelRequire(value.id === 10, "sentinel_id");
  sentinelRequire(isPlainRecord(value.result), "sentinel_result");
  const result = value.result as Record<string, unknown>;
  sentinelRequire(Array.isArray(result.transactions), "sentinel_transactions");
  const transactions = result.transactions as unknown[];
  sentinelRequire(transactions.length >= 1 && transactions.length <= 8, "sentinel_transactions_length");
  // The pinned SDK consumes only the last transaction's low tier with the requested fee token.
  const transaction = transactions.at(-1);
  sentinelRequire(isPlainRecord(transaction), "sentinel_last_transaction");
  const tx = transaction as Record<string, unknown>;
  sentinelRequire(Array.isArray(tx.fees), "sentinel_fees");
  const fees = tx.fees as unknown[];
  sentinelRequire(fees.length >= 1 && fees.length <= 8, "sentinel_fees_length");
  sentinelRequire(isPlainRecord(fees[0]), "sentinel_low_tier");
  const fee = fees[0] as Record<string, unknown>;
  if (!Array.isArray(fee.tokenFees)) {
    const present = Object.hasOwn(fee, "tokenFees"), value = fee.tokenFees;
    // Parsed JSON supplies only these closed kinds; no value or arbitrary field is retained.
    const kind = !present ? "missing" : value === null ? "null" : typeof value === "object" ? "object" :
      typeof value === "string" ? "string" : typeof value === "number" ? "number" : "boolean";
    sentinelRequire(false, "sentinel_token_fees", kind, { ...sentinelFeeFacts(result, tx, fee),
      ...(kind === "missing" || kind === "null" ? nativeGasFacts(fee) : {}) });
  }
  const tokenFees = fee.tokenFees as unknown[];
  sentinelRequire(tokenFees.length >= 1 && tokenFees.length <= 32, "sentinel_token_fees_length");
  const matching: Record<string, unknown>[] = [];
  for (const candidate of tokenFees) {
    sentinelRequire(isPlainRecord(candidate), "sentinel_entry");
    const entry = candidate as Record<string, unknown>;
    sentinelRequire(isPlainRecord(entry.token), "sentinel_token");
    const token = entry.token as Record<string, unknown>;
    sentinelRequire(typeof token.address === "string" && /^0x[0-9a-fA-F]{40}$/u.test(token.address), "sentinel_token_address");
    if (context.mode === "quote" && (token.address as string).toLowerCase() === context.input.token) matching.push(entry);
  }
  // Duplicated matching tokens remain ambiguous; no SDK first-match relaxation.
  sentinelRequire(matching.length === 1, "sentinel_token_match");
  const entry = matching[0]!, token = entry.token as Record<string, unknown>;
  sentinelRequire(!entry.error, "sentinel_entry_error");
  sentinelRequire(typeof token.symbol === "string" && token.symbol.length >= 1 && token.symbol.length <= 32, "sentinel_symbol");
  sentinelRequire(token.decimals === 6, "sentinel_decimals");
  sentinelRequire(tokenFeeQuantity(entry.balanceNeededToken), "sentinel_fee_quantity");
  sentinelRequire(typeof entry.feeRecipient === "string" && /^0x[0-9a-fA-F]{40}$/u.test(entry.feeRecipient), "sentinel_fee_recipient");
}
/** Closed kinds only; the provider's own error text and values never leave this function. */
function sentinelFeeFacts(result: Record<string, unknown>, tx: Record<string, unknown>, fee: Record<string, unknown>): SentinelFeeFacts {
  const sponsorship = result.sponsorship, error = fee.error;
  return { sentinelSimulation: !Object.hasOwn(tx, "status") ? "absent" : tx.status === "0x1" ? "succeeded" : tx.status === "0x0" ? "reverted" : "other",
    sentinelFeeError: error === undefined || error === null || error === "" ? "absent" : typeof error === "string" ? "present" : "other",
    sentinelSponsorship: !Object.hasOwn(result, "sponsorship") ? "absent" : !isPlainRecord(sponsorship) ? "other" :
      sponsorship.isSponsored === true ? "sponsored" : sponsorship.isSponsored === false ? "not_sponsored" : "other" };
}
/** Parse only a successful principal simulation from the already validated original request. */
export function captureSponsoredQuote(body: string, request: string, context: Extract<ModeContext, { mode: "quote" }>): MetaMaskGaslessQuote | undefined {
  let value: unknown;
  try { value = JSON.parse(body); } catch { return undefined; }
  if (!isPlainRecord(value) || !exactKeys(value, ["jsonrpc", "id", "result"]) || value.jsonrpc !== "2.0" ||
    value.id !== 10 || !isPlainRecord(value.result)) return undefined;
  const result = value.result;
  if (Object.hasOwn(result, "error") || !isPlainRecord(result.sponsorship) || result.sponsorship.isSponsored !== true ||
    !(result.sponsorship.error === null || result.sponsorship.error === "" || !Object.hasOwn(result.sponsorship, "error")) ||
    !Array.isArray(result.transactions) || result.transactions.length !== 1) return undefined;
  const tx = result.transactions[0];
  if (!isPlainRecord(tx) || tx.status !== "0x1" || Object.hasOwn(tx, "error") || !Array.isArray(tx.fees) ||
    tx.fees.length < 1 || tx.fees.length > 8 || !isPlainRecord(tx.fees[0]) || Object.hasOwn(tx.fees[0], "tokenFees")) return undefined;
  const material = { netAtomic: context.input.netAtomic, feeAtomic: "0", feeRecipient: null, feeMode: "sponsored" as const,
    sponsorshipHash: hashObject({ purpose: "apn.metamask.sponsored-simulation.v1", input: context.input,
      requestHash: hashObject(JSON.parse(request)), responseHash: sha256(body) }),
    executions: [{ target: context.input.token, value: "0", callData: encodeFunctionData({ abi: transferAbi,
      functionName: "transfer", args: [context.input.recipient, BigInt(context.input.netAtomic)] }) }] as const };
  return Object.freeze({ ...material, executions: Object.freeze(material.executions.map(e => Object.freeze(e))) as unknown as typeof material.executions,
    hash: mmQuoteHash(material) });
}
function tokenFeeQuantity(value: unknown): boolean {
  // Sentinel emits hex quantities; the SDK also accepts decimal strings through BigInt.
  return typeof value === "string" && /^(?:0|[1-9][0-9]{0,77}|0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63}))$/u.test(value) &&
    BigInt(value) <= MM_MAX_UINT;
}

/**
 * The low fee tier's own native gas terms, kept only when they prove a native shortfall in proven units: the tier's
 * `balanceNeeded` equals `gas x maxFeePerGas` exactly (gas units times wei per gas, so wei) and exceeds `currentBalance`,
 * which the same tier compares in the same unit. QA 0.5.52 captured Ethereum `error: "Not enough funds"` with 70997 gas x
 * 2161967598 wei = 153493213555206 wei needed against 20000000000000 wei held. Anything else proves no cause.
 */
function nativeGasFacts(fee: Record<string, unknown>): NativeGasFacts | undefined {
  const gas = hexQuantity(fee.gas), price = hexQuantity(fee.maxFeePerGas);
  const needed = hexQuantity(fee.balanceNeeded), current = hexQuantity(fee.currentBalance);
  if (gas === undefined || price === undefined || needed === undefined || current === undefined ||
    typeof fee.error !== "string" || fee.error === "" || gas === 0n || price === 0n || needed !== gas * price || current >= needed) return undefined;
  return { nativeGasUnits: gas.toString(), nativeMaxFeePerGasWei: price.toString(),
    nativeRequiredWei: needed.toString(), nativeCurrentWei: current.toString() };
}
function hexQuantity(value: unknown): bigint | undefined {
  return typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(value) ? BigInt(value) : undefined;
}
