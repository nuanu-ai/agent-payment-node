/** Finite saved Ethereum USDC Relay source routes. Base has an exact owner/recipient binding. */
import { ApnError } from "../errors.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { BASE_NATIVE, ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "./quote.js";
import { RELAY_BASE_ROUTE_REFERENCE, RELAY_ROUTE_REFERENCE } from "./prepare.js";

export const RELAY_BASE_ACCOUNT = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
function blocked(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "Saved Relay source route is not executable.",
    { reason: "saved_source_route_binding" });
}

export function relayExecutionRoute(op: RelayUnsignedOperation): typeof RELAY_ROUTE_REFERENCE | typeof RELAY_BASE_ROUTE_REFERENCE {
  const quote = op.quote;
  if (op.sourceChainId !== 1 || quote === undefined ||
    ![56, 8453].includes(op.destinationChainId)) blocked();
  if (op.destinationChainId === 56) {
    if (quote.routeReference !== undefined || quote.orderData.output.chainId !== "bnb") blocked();
    return RELAY_ROUTE_REFERENCE;
  }
  const order = quote.orderData;
  const input = order.inputs[0];
  const output = order.output;
  const payment = output.payments[0];
  const sourceRefund = input?.refunds[0];
  const destinationRefund = input?.refunds[1];
  if (!/^(0|[1-9][0-9]*)$/u.test(payment?.minimumAmount ?? "") ||
    !/^(0|[1-9][0-9]*)$/u.test(payment?.expectedAmount ?? "") ||
    quote.routeReference !== RELAY_BASE_ROUTE_REFERENCE || !same(op.sourceAccount, RELAY_BASE_ACCOUNT) ||
    !same(op.recipient, RELAY_BASE_ACCOUNT) || !same(quote.payer, op.sourceAccount) ||
    !same(quote.recipient, op.recipient) || !same(quote.sourceRefundRecipient, op.sourceAccount) ||
    order.solverChainId !== "base" || order.inputs.length !== 1 || order.fees.length !== 0 ||
    input?.payment.chainId !== "ethereum" || !same(input.payment.currency, ETHEREUM_USDC) ||
    input.payment.amount !== op.amountAtomic || input.payment.weight !== "1" || input.refunds.length !== 2 ||
    sourceRefund?.chainId !== "ethereum" || !same(sourceRefund.recipient, op.sourceAccount) ||
    !same(sourceRefund.currency, ETHEREUM_USDC) || sourceRefund.minimumAmount !== "0" ||
    destinationRefund?.chainId !== "base" || !same(destinationRefund.recipient, op.recipient) ||
    !same(destinationRefund.currency, BASE_NATIVE) || destinationRefund.minimumAmount !== "0" ||
    output.chainId !== "base" || output.payments.length !== 1 || output.calls.length !== 0 ||
    payment === undefined || !same(payment.recipient, op.recipient) ||
    !same(payment.currency, BASE_NATIVE) || BigInt(payment.minimumAmount) < BigInt(op.minOutputAtomic) ||
    BigInt(payment.expectedAmount) < BigInt(payment.minimumAmount) ||
    quote.paymentDetails.chainId !== "ethereum" || !same(quote.paymentDetails.currency, ETHEREUM_USDC) ||
    !same(quote.paymentDetails.depository, ETHEREUM_DEPOSITORY) ||
    quote.paymentDetails.amount !== op.amountAtomic || !same(quote.approval.to, ETHEREUM_USDC) ||
    !same(quote.deposit.to, ETHEREUM_DEPOSITORY)) blocked();
  return RELAY_BASE_ROUTE_REFERENCE;
}
