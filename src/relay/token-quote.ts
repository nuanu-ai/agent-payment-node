/** Unsigned Relay ERC-20 token-route quotes (the Binance-Peg BNB routes of token-routes.ts) for any payer and recipient.
 * Nothing in this module signs or sends a transaction. Each side's amount is atomic in its own token's decimals. */
import { getOrderId } from "./order-id.js";
import { decodeFunctionData, encodeFunctionData, parseAbi, recoverMessageAddress } from "viem";
import type { Hex } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { RELAY_MAX_DEADLINE_SECONDS, RELAY_SOLVER, postRelayQuote, relayStatusLocator, type RelayStatusLocator } from "./quote.js";
import { RELAY_TOKEN_DEPOSITORY, relayTokenRouteByReference, type RelayTokenChainId, type RelayTokenRoute } from "./token-routes.js";

const CHAINS = { ethereum: "ethereum-vm", bnb: "ethereum-vm", polygon: "ethereum-vm", base: "ethereum-vm", arbitrum: "ethereum-vm" } as const;
const DEPOSIT_ABI = parseAbi(["function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]);
const APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u, UINT = /^(0|[1-9][0-9]*)$/u, BYTES32 = /^0x[0-9a-fA-F]{64}$/u, HEX = /^0x(?:[0-9a-fA-F]{2})+$/u;
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
/** A provider answer APN cannot decode or trust; saved-quote callers refuse with their own reason. */
const fail = (reason: string): never => {
  throw new ApnError("APN_PROVIDER_PROTOCOL", `Relay token quote rejected: ${reason}`, { reason: "relay_token_quote_invalid", check: reason });
};
const record = (value: unknown, reason: string): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail(reason);
const list = (value: unknown, reason: string): unknown[] => Array.isArray(value) ? value : fail(reason);
const string = (value: unknown, reason: string): string => typeof value === "string" ? value : fail(reason);
const address = (value: unknown, reason: string): string => { const s = string(value, reason); return ADDRESS.test(s) ? s : fail(reason); };
const amount = (value: unknown, reason: string): bigint => { const s = string(value, reason); return UINT.test(s) ? BigInt(s) : fail(reason); };
const bytes32 = (value: unknown, reason: string): string => { const s = string(value, reason); return BYTES32.test(s) ? s.toLowerCase() : fail(reason); };
const one = (value: unknown, reason: string): Record<string, unknown> => { const a = list(value, reason); return a.length === 1 ? record(a[0], reason) : fail(reason); };
function keys(value: Record<string, unknown>, allowed: readonly string[], reason: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(reason);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const locator = (requestId: unknown, endpoint?: unknown): RelayStatusLocator => {
  try { return relayStatusLocator(requestId, endpoint); } catch { return fail("status locator"); }
};

export interface RelayTokenQuoteIntent {
  readonly routeReference: string;
  readonly payer: string;
  readonly recipient: string;
  /** Source token atomic units (its own decimals). */
  readonly amountAtomic: string;
  /** Destination token atomic units (its own decimals). */
  readonly minimumOutputAtomic: string;
  readonly nowSeconds: number;
}
export interface RelayTokenTransaction {
  readonly from: string; readonly to: string; readonly data: string; readonly value: "0"; readonly chainId: RelayTokenChainId;
  readonly gas: string; readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string; readonly maximumNetworkFeeWei: string;
}
type Refund = Readonly<{ chainId: string; recipient: string; currency: string; minimumAmount: "0"; deadline: number; extraData: string }>;
export interface ValidatedRelayTokenQuote {
  readonly schemaVersion: "apn.relay-token-quote.v1";
  readonly routeReference: string;
  readonly quoteDigest: string;
  readonly statusLocator: RelayStatusLocator;
  readonly orderId: string; readonly orderSignature: string; readonly solver: string;
  readonly payer: string; readonly recipient: string; readonly sourceRefundRecipient: string;
  readonly sourceToken: string; readonly sourceDecimals: number;
  readonly destinationToken: string; readonly destinationDecimals: number;
  readonly principalAtomic: string;
  readonly orderData: Readonly<{ version: "v1"; solverChainId: "base"; solver: string; salt: string;
    inputs: readonly Readonly<{ payment: Readonly<{ chainId: string; currency: string; amount: string; weight: "1" }>; refunds: readonly Refund[] }>[];
    output: Readonly<{ chainId: string; payments: readonly Readonly<{ recipient: string; currency: string; minimumAmount: string; expectedAmount: string }>[];
      calls: readonly []; deadline: number; extraData: string }>;
    fees: readonly [] }>;
  readonly paymentDetails: Readonly<{ chainId: string; depository: string; currency: string; amount: string }>;
  readonly minimumOutputAtomic: string;
  readonly deadline: number;
  readonly approval: RelayTokenTransaction;
  readonly deposit: RelayTokenTransaction;
}

/** The protocol row a quote names; an unknown reference is an invalid quote. */
export function relayTokenQuoteRoute(reference: string): RelayTokenRoute { return relayTokenRouteByReference(reference) ?? fail("route reference"); }

export function relayTokenQuoteRequest(intent: RelayTokenQuoteIntent): Record<string, unknown> {
  const route = relayTokenQuoteRoute(intent.routeReference);
  address(intent.payer, "payer"); address(intent.recipient, "recipient");
  if (amount(intent.amountAtomic, "amount") <= 0n || amount(intent.minimumOutputAtomic, "minimum output") <= 0n) fail("intent amounts");
  return { user: intent.payer, originChainId: route.source.chainId, destinationChainId: route.destination.chainId,
    originCurrency: route.source.address, destinationCurrency: route.destination.address, amount: intent.amountAtomic,
    tradeType: "EXACT_INPUT", recipient: intent.recipient, refundTo: intent.payer, includeProtocolData: true,
    usePermit: false, useDepositAddress: false };
}

/** One transaction step: exact id, source chain, payer, zero value, and gas within the 500k bound (the fee bound is the
 * caller's ceiling; Arbitrum quotes a zero priority fee and BNB Smart Chain one equal to the max fee). */
function transaction(value: unknown, id: "approve" | "deposit", route: RelayTokenRoute, payer: string): RelayTokenTransaction {
  const step = record(value, "step");
  keys(step, ["id", "action", "description", "kind", "items", "requestId", "depositAddress"], "step extension");
  if (step.id !== id || step.kind !== "transaction" || (step.depositAddress !== undefined && step.depositAddress !== "")) fail("step action");
  const item = one(step.items, "step items");
  keys(item, ["status", "data", "check"], "step item extension");
  if (item.status !== "incomplete") fail("step item action");
  const tx = record(item.data, "transaction");
  keys(tx, ["from", "to", "data", "value", "chainId", "gas", "maxFeePerGas", "maxPriorityFeePerGas"], "transaction extension");
  if (!same(address(tx.from, "transaction from"), payer) || tx.chainId !== route.source.chainId ||
    amount(tx.value, "transaction value") !== 0n || !HEX.test(string(tx.data, "transaction data"))) fail("transaction envelope");
  const gas = amount(tx.gas, "gas"), maxFee = amount(tx.maxFeePerGas, "max fee"), priority = amount(tx.maxPriorityFeePerGas, "priority fee");
  if (gas === 0n || gas > 500_000n || maxFee === 0n || priority > maxFee) fail("gas limits");
  return { from: address(tx.from, "transaction from").toLowerCase(), to: address(tx.to, "transaction to").toLowerCase(),
    data: string(tx.data, "transaction data").toLowerCase(), value: "0", chainId: route.source.chainId, gas: gas.toString(),
    maxFeePerGas: maxFee.toString(), maxPriorityFeePerGas: priority.toString(), maximumNetworkFeeWei: (gas * maxFee).toString() };
}

function statusLocatorOf(quote: Record<string, unknown>, steps: unknown[]): RelayStatusLocator {
  const ids: unknown[] = quote.requestId === undefined ? [] : [quote.requestId], endpoints: string[] = [];
  for (const value of steps) {
    const step = record(value, "step"), item = one(step.items, "step items");
    if (step.requestId !== undefined) ids.push(step.requestId);
    if (item.check === undefined) continue;
    const check = record(item.check, "step check"); keys(check, ["endpoint", "method"], "step check extension");
    if (check.method !== "GET") fail("step check method");
    const endpoint = string(check.endpoint, "status endpoint");
    let url: URL; try { url = new URL(endpoint, "https://api.relay.link"); } catch { return fail("status endpoint"); }
    ids.push(url.searchParams.get("requestId")); endpoints.push(endpoint);
  }
  if (ids.length === 0) fail("request id");
  const found = locator(ids[0]);
  for (const id of ids) if (locator(id).requestId !== found.requestId) fail("conflicting request ids");
  for (const endpoint of endpoints) locator(found.requestId, endpoint);
  return found;
}

function assertCalldata(route: RelayTokenRoute, payer: string, principal: bigint, orderId: string,
  approval: RelayTokenTransaction, deposit: RelayTokenTransaction): void {
  if (!same(approval.to, route.source.address) || !same(deposit.to, RELAY_TOKEN_DEPOSITORY)) fail("transaction target");
  try {
    const approved = decodeFunctionData({ abi: APPROVE_ABI, data: approval.data as Hex });
    if (approved.functionName !== "approve" || !same(approved.args[0], RELAY_TOKEN_DEPOSITORY) || approved.args[1] !== principal ||
      !same(encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [...approved.args] }), approval.data)) fail("approval calldata");
    const deposited = decodeFunctionData({ abi: DEPOSIT_ABI, data: deposit.data as Hex });
    if (deposited.functionName !== "depositErc20" || !same(deposited.args[0], payer) || !same(deposited.args[1], route.source.address) ||
      deposited.args[2] !== principal || !same(deposited.args[3], orderId) ||
      !same(encodeFunctionData({ abi: DEPOSIT_ABI, functionName: "depositErc20", args: [...deposited.args] }), deposit.data)) fail("deposit calldata");
  } catch { fail("call data"); }
}

export async function validateRelayTokenQuote(value: unknown, intent: RelayTokenQuoteIntent): Promise<ValidatedRelayTokenQuote> {
  relayTokenQuoteRequest(intent);
  const route = relayTokenQuoteRoute(intent.routeReference), { source, destination } = route;
  if (!Number.isSafeInteger(intent.nowSeconds) || intent.nowSeconds < 0) fail("clock");
  const quote = record(value, "quote"), steps = list(quote.steps, "steps");
  // Relay leaves the approval out when the payer's allowance to the depository already covers the amount. This route
  // sends its own exact approval from a zero allowance, so an existing allowance is revoked before quoting again.
  if (steps.length === 1 && record(steps[0], "step").id === "deposit") {
    throw new ApnError("APN_OPERATION_BLOCKED", "Relay quoted a deposit without an approval: the payer's token allowance to the Relay depository already covers the amount.",
      { reason: "relay_existing_allowance", chain: `eip155:${source.chainId}`, asset: source.address, spender: RELAY_TOKEN_DEPOSITORY });
  }
  if (steps.length !== 2) fail("unsupported steps");
  const statusLocator = statusLocatorOf(quote, steps);
  const protocol = record(record(quote.protocol, "protocol").v2, "protocol v2");
  if (protocol.hubType !== "onchain") fail("hub type");
  const order = record(protocol.orderData, "order data");
  keys(order, ["version", "solverChainId", "solver", "salt", "inputs", "output", "fees"], "order extension");
  const input = one(order.inputs, "inputs"); keys(input, ["payment", "refunds"], "input extension");
  const payment = record(input.payment, "payment"); keys(payment, ["chainId", "currency", "amount", "weight"], "payment extension");
  const output = record(order.output, "output"); keys(output, ["chainId", "payments", "calls", "deadline", "extraData"], "output extension");
  const payee = one(output.payments, "output payments"); keys(payee, ["recipient", "currency", "minimumAmount", "expectedAmount"], "payee extension");
  const refunds = list(input.refunds, "refunds"), principal = amount(intent.amountAtomic, "intent amount");
  if (refunds.length !== 2 || list(output.calls, "calls").length !== 0 || list(order.fees, "fees").length !== 0) fail("order actions");
  if (order.version !== "v1" || order.solverChainId !== "base" || !same(address(order.solver, "solver"), RELAY_SOLVER) ||
    payment.chainId !== source.relayChain || !same(address(payment.currency, "input currency"), source.address) ||
    amount(payment.amount, "input amount") !== principal || payment.weight !== "1" ||
    output.chainId !== destination.relayChain || !same(address(payee.currency, "output currency"), destination.address) ||
    !same(address(payee.recipient, "recipient"), intent.recipient)) fail("order identity");
  const minimum = amount(payee.minimumAmount, "minimum output"), expected = amount(payee.expectedAmount, "expected output");
  if (minimum === 0n || expected < minimum) fail("output minimum");
  // `fail` does not narrow (an inferred const), so the checked deadline is named a number here.
  const deadline = output.deadline as number;
  if (typeof deadline !== "number" || !Number.isSafeInteger(deadline) || deadline <= intent.nowSeconds + 60 ||
    deadline > intent.nowSeconds + RELAY_MAX_DEADLINE_SECONDS) fail("deadline");
  const expectedRefunds = [{ chain: source.relayChain, recipient: intent.payer, currency: source.address },
    { chain: destination.relayChain, recipient: intent.recipient, currency: destination.address }];
  const projectedRefunds: Refund[] = refunds.map((entry, index) => {
    const refund = record(entry, "refund"), wanted = expectedRefunds[index]!;
    keys(refund, ["chainId", "recipient", "currency", "minimumAmount", "deadline", "extraData"], "refund extension");
    if (refund.chainId !== wanted.chain || !same(address(refund.recipient, "refund recipient"), wanted.recipient) ||
      !same(address(refund.currency, "refund currency"), wanted.currency) || amount(refund.minimumAmount, "refund minimum") !== 0n ||
      refund.deadline !== deadline) fail("refund");
    return { chainId: wanted.chain, recipient: wanted.recipient.toLowerCase(), currency: wanted.currency.toLowerCase(),
      minimumAmount: "0" as const, deadline, extraData: bytes32(refund.extraData, "refund extra data") };
  });
  const orderData: ValidatedRelayTokenQuote["orderData"] = { version: "v1", solverChainId: "base", solver: RELAY_SOLVER,
    salt: bytes32(order.salt, "salt"), inputs: [{ payment: { chainId: source.relayChain, currency: source.address.toLowerCase(),
      amount: principal.toString(), weight: "1" }, refunds: projectedRefunds }],
    output: { chainId: destination.relayChain, payments: [{ recipient: intent.recipient.toLowerCase(), currency: destination.address.toLowerCase(),
      minimumAmount: minimum.toString(), expectedAmount: expected.toString() }], calls: [], deadline, extraData: bytes32(output.extraData, "output extra data") },
    fees: [] };
  // Decimals are the route's own on both sides: a quote that prices either token with other decimals is not this route.
  const details = record(quote.details, "details");
  const currencyIn = record(details.currencyIn, "currency in"), currencyOut = record(details.currencyOut, "currency out");
  const inToken = record(currencyIn.currency, "input token"), outToken = record(currencyOut.currency, "output token");
  if (!same(address(details.sender, "sender"), intent.payer) || !same(address(details.recipient, "recipient"), intent.recipient) ||
    inToken.chainId !== source.chainId || !same(address(inToken.address, "input token"), source.address) ||
    outToken.chainId !== destination.chainId || !same(address(outToken.address, "output token"), destination.address) ||
    amount(currencyIn.amount, "details input") !== principal || amount(currencyOut.minimumAmount, "details minimum") !== minimum) fail("quote details");
  if (inToken.decimals !== source.decimals || outToken.decimals !== destination.decimals) fail("token decimals");
  let orderId: string;
  try { orderId = getOrderId(orderData as unknown as Parameters<typeof getOrderId>[0], CHAINS); }
  catch { return fail("order encoding"); }
  if (!same(string(protocol.orderId, "order id"), orderId)) fail("order id");
  const signature = string(protocol.orderSignature, "order signature");
  if (!/^0x[0-9a-fA-F]{130}$/u.test(signature)) fail("order signature");
  let signer: string;
  try { signer = await recoverMessageAddress({ message: { raw: orderId as Hex }, signature: signature as Hex }); }
  catch { return fail("order signature"); }
  if (!same(signer, RELAY_SOLVER)) fail("order signer");
  const paymentDetails = record(protocol.paymentDetails, "payment details");
  if (paymentDetails.chainId !== source.relayChain || !same(address(paymentDetails.depository, "depository"), RELAY_TOKEN_DEPOSITORY) ||
    !same(address(paymentDetails.currency, "payment currency"), source.address) ||
    amount(paymentDetails.amount, "payment amount") !== principal) fail("payment details");
  const approval = transaction(steps[0], "approve", route, intent.payer), deposit = transaction(steps[1], "deposit", route, intent.payer);
  assertCalldata(route, intent.payer, principal, orderId, approval, deposit);
  // The caller's minimum is compared last, on a quote already proven exact and solver-signed: the quoted output moves with
  // the market, so this is a refusal with both destination-atomic values, not a provider fault.
  const required = amount(intent.minimumOutputAtomic, "required minimum");
  if (minimum < required) throw new ApnError("APN_OPERATION_BLOCKED", "The Relay quote's minimum output is below the requested minimum.",
    { reason: "relay_quote_output_below_minimum", quoted_minimum_output_atomic: minimum.toString(), requested_minimum_output_atomic: required.toString(),
      destination_decimals: destination.decimals });
  const projection = { schemaVersion: "apn.relay-token-quote.v1" as const, routeReference: route.reference, statusLocator,
    orderId: orderId.toLowerCase(), orderSignature: signature.toLowerCase(), solver: RELAY_SOLVER, payer: intent.payer.toLowerCase(),
    recipient: intent.recipient.toLowerCase(), sourceRefundRecipient: intent.payer.toLowerCase(),
    sourceToken: source.address.toLowerCase(), sourceDecimals: source.decimals,
    destinationToken: destination.address.toLowerCase(), destinationDecimals: destination.decimals,
    principalAtomic: principal.toString(), orderData,
    paymentDetails: { chainId: source.relayChain, depository: RELAY_TOKEN_DEPOSITORY, currency: source.address.toLowerCase(), amount: principal.toString() },
    minimumOutputAtomic: minimum.toString(), deadline, approval, deposit };
  return freeze({ ...projection, quoteDigest: hashObject(projection) });
}

/** The saved quote is the exact projection of its route: digest, identities, order id, solver signature and calldata. */
export async function verifySavedRelayTokenQuote(quote: ValidatedRelayTokenQuote): Promise<RelayTokenRoute> {
  const route = relayTokenQuoteRoute(quote.routeReference);
  assertSavedRelayTokenQuote(quote, route);
  let orderId: string, signer: string;
  try {
    orderId = getOrderId(quote.orderData as unknown as Parameters<typeof getOrderId>[0], CHAINS);
    signer = await recoverMessageAddress({ message: { raw: orderId as Hex }, signature: quote.orderSignature as Hex });
  } catch { return fail("saved order authority"); }
  if (!same(orderId, quote.orderId) || !same(signer, RELAY_SOLVER)) fail("saved order authority");
  return route;
}

/** Synchronous binding of a saved quote to its route row (no signature recovery). */
export function assertSavedRelayTokenQuote(quote: ValidatedRelayTokenQuote, route: RelayTokenRoute): void {
  const { quoteDigest, ...projection } = quote, { source, destination } = route;
  const order = quote.orderData, input = order?.inputs?.[0], payee = order?.output?.payments?.[0];
  if (quote.schemaVersion !== "apn.relay-token-quote.v1" || hashObject(projection) !== quoteDigest || quote.routeReference !== route.reference ||
    quote.sourceToken !== source.address.toLowerCase() || quote.sourceDecimals !== source.decimals ||
    quote.destinationToken !== destination.address.toLowerCase() || quote.destinationDecimals !== destination.decimals ||
    !same(quote.solver, RELAY_SOLVER) || !same(order.solver, RELAY_SOLVER) || order.inputs.length !== 1 || input === undefined ||
    input.payment.chainId !== source.relayChain || input.payment.currency !== quote.sourceToken || input.payment.amount !== quote.principalAtomic ||
    input.refunds.length !== 2 || input.refunds[0]!.recipient !== quote.payer || input.refunds[0]!.currency !== quote.sourceToken ||
    input.refunds[1]!.recipient !== quote.recipient || input.refunds[1]!.currency !== quote.destinationToken ||
    order.output.chainId !== destination.relayChain || order.output.payments.length !== 1 || payee === undefined ||
    order.output.calls.length !== 0 || order.fees.length !== 0 || payee.recipient !== quote.recipient ||
    payee.currency !== quote.destinationToken || payee.minimumAmount !== quote.minimumOutputAtomic ||
    order.output.deadline !== quote.deadline || quote.sourceRefundRecipient !== quote.payer ||
    quote.paymentDetails.chainId !== source.relayChain || !same(quote.paymentDetails.depository, RELAY_TOKEN_DEPOSITORY) ||
    quote.paymentDetails.currency !== quote.sourceToken || quote.paymentDetails.amount !== quote.principalAtomic ||
    quote.approval.chainId !== source.chainId || quote.deposit.chainId !== source.chainId ||
    !same(quote.approval.from, quote.payer) || !same(quote.deposit.from, quote.payer) ||
    relayStatusLocator(quote.statusLocator.requestId, quote.statusLocator.endpoint).endpoint !== quote.statusLocator.endpoint) fail("saved route");
  assertCalldata(route, quote.payer, BigInt(quote.principalAtomic), quote.orderId, quote.approval, quote.deposit);
}

/** The read and the one revoke that clear an existing depository allowance; the same prepare then quotes both steps. */
export function withRelayTokenAllowanceActions(error: unknown, profile: string): unknown {
  if (!(error instanceof ApnError) || error.details?.reason !== "relay_existing_allowance") return error;
  const target = `--profile ${profile} --chain ${String(error.details.chain)} --asset ${String(error.details.asset)} --spender ${RELAY_TOKEN_DEPOSITORY}`;
  return new ApnError(error.code, error.message, { ...error.details, nextActions: [`apn wallet allowance status ${target}`,
    `apn wallet allowance revoke ${target} --max-gas-limit <gas-limit> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>`,
    "After the revoke is final, rerun the same apn relay prepare command."] });
}

/** One keyless POST, no API key or retry; a declined, unanswered or unreadable quote is classified by `postRelayQuote`. */
export async function requestRelayTokenQuote(intent: RelayTokenQuoteIntent, fetcher: typeof fetch = fetch,
  now: () => number = () => Math.floor(Date.now() / 1000)): Promise<ValidatedRelayTokenQuote> {
  const body = await postRelayQuote(relayTokenQuoteRequest(intent), fetcher, "relay_token_quote", fail);
  return validateRelayTokenQuote(body, { ...intent, nowSeconds: now() });
}
