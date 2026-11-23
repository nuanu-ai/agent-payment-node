/** The ERC-20 source leg of a saved Relay operation that approves and then deposits a token: Ethereum USDC to BNB native
 * or Base ETH, or a token route of token-routes.ts. Approval, deposit, usage hold, source proof and retirement read the
 * source chain, token, depository, envelopes, order and policy pin from here and nowhere else. */
import { getAddress } from "viem";
import type { AssetUsageIdentity } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { relayExecutionRoute } from "./execution-route.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "./quote.js";
import { assertSavedRelayTokenQuote } from "./token-quote.js";
import { RELAY_TOKEN_DEPOSITORY, RELAY_TOKEN_SAFE_TAG, relayTokenRouteByReference, type RelayToken } from "./token-routes.js";

export interface RelayErc20Envelope {
  readonly from: string; readonly to: string; readonly data: string; readonly value: "0"; readonly chainId: number;
  readonly gas: string; readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string; readonly maximumNetworkFeeWei: string;
}
export interface RelayErc20SourceLeg {
  readonly chainId: number;
  readonly chain: string;
  /** EIP-55 source token: the identity of the owner policy row and of the usage hold. */
  readonly token: string;
  readonly depository: string;
  readonly orderId: string;
  readonly approval: RelayErc20Envelope;
  readonly deposit: RelayErc20Envelope;
  /** The chain's consensus-safe block tag for nonce and checkpoint reads. */
  readonly safeTag: "safe" | "finalized";
  /** Token routes send their own exact approval only from a zero allowance (Ethereum USDT refuses nonzero to nonzero). */
  readonly zeroAllowanceRequired: boolean;
  /** The token a token route pays; null for the Ethereum USDC routes, which pay a native coin. */
  readonly destination: RelayToken | null;
}

function blocked(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "Saved Relay source route is not executable.", { reason: "saved_source_route_binding" });
}

/** The relay mechanism pin the owner policy admits; an Ethereum USDC operation is re-proven against its saved route. */
export function relayErc20Reference(op: RelayUnsignedOperation): string {
  return op.tokenQuote === undefined ? relayExecutionRoute(op) : relayTokenSource(op).route.reference;
}

/** The leg's chain, token and envelopes. Ethereum USDC reads its saved quote as before (effect services also re-prove its
 * route with `relayErc20Reference`); a token route is bound to its protocol row and to the operation's own fields here. */
export function relayErc20SourceLeg(op: RelayUnsignedOperation): RelayErc20SourceLeg {
  if (op.tokenQuote === undefined) {
    const saved = op.quote;
    if (saved === undefined) blocked();
    return { chainId: 1, chain: "eip155:1", token: ETHEREUM_USDC, depository: ETHEREUM_DEPOSITORY, orderId: saved.orderId,
      approval: saved.approval, deposit: saved.deposit, safeTag: "safe", zeroAllowanceRequired: false, destination: null };
  }
  const { route, quote } = relayTokenSource(op);
  return { chainId: route.source.chainId, chain: `eip155:${route.source.chainId}`, token: route.source.address,
    depository: RELAY_TOKEN_DEPOSITORY, orderId: quote.orderId, approval: quote.approval,
    deposit: quote.deposit, safeTag: RELAY_TOKEN_SAFE_TAG[route.source.chainId], zeroAllowanceRequired: true, destination: route.destination };
}

function relayTokenSource(op: RelayUnsignedOperation) {
  const quote = op.tokenQuote;
  if (quote === undefined) return blocked();
  const route = relayTokenRouteByReference(quote.routeReference);
  if (route === null || op.quote !== undefined || op.nativeQuote !== undefined || op.arbitrumDraft !== undefined ||
    op.sourceChainId !== route.source.chainId || op.destinationChainId !== route.destination.chainId ||
    quote.payer !== op.sourceAccount.toLowerCase() || quote.recipient !== op.recipient.toLowerCase() ||
    quote.principalAtomic !== op.amountAtomic || quote.minimumOutputAtomic !== op.minOutputAtomic || quote.quoteDigest !== op.quoteDigest) blocked();
  try { assertSavedRelayTokenQuote(quote, route); } catch { blocked(); }
  return { route, quote };
}

/** The source chain, token and depository alone. An operation without a token quote is an Ethereum USDC operation, as
 * before (an early prepared record may carry no quote); a token route is re-bound to its row. */
export function relayErc20SourceToken(op: RelayUnsignedOperation): Readonly<{ chain: string; token: string; depository: string }> {
  if (op.tokenQuote === undefined) return { chain: "eip155:1", token: ETHEREUM_USDC, depository: ETHEREUM_DEPOSITORY };
  const { route } = relayTokenSource(op);
  return { chain: `eip155:${route.source.chainId}`, token: route.source.address, depository: RELAY_TOKEN_DEPOSITORY };
}

/** The principal usage hold of the leg: the payer's checksummed account, the source chain and the source token. */
export function relayErc20UsageIdentity(op: RelayUnsignedOperation): AssetUsageIdentity {
  const source = relayErc20SourceToken(op);
  return { account: getAddress(op.sourceAccount), chain: source.chain, asset: { kind: "token", identifier: source.token } };
}
