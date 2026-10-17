/** Routes the public Relay surface (manifest v2) to the unchanged internal request of each route. `relay prepare` picks
 * its route from the source chain, asset and destination chain; `relay execute` and `relay observe` take it from the
 * saved operation. Internal requests keep their exact v1 shapes, so saved prepare request hashes, services, journals,
 * consent screens and RPC budgets are what they were. */
import { randomUUID } from "node:crypto";
import type { BoundCommand } from "../command-binder.js";
import type { CommandRequest, OutputEnvelope } from "../commands.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { failureEnvelope } from "../output.js";
import { RelayUnsignedOperationRepository, type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { StateStore } from "../state.js";
import { ArbitrumSourceEffectJournalRepository } from "./arbitrum-source-effect-journal.js";
import { relayNativeRouteFor } from "./native-routes.js";

type Options = Readonly<Record<string, string>>;
type RelayRouteRequest = Extract<CommandRequest, { readonly command: "relay.route" }>;
const ROUTE_OPTIONS = ["--max-approval-network-fee-wei", "--payer", "--max-provider-fee-atomic", "--quote-file"] as const;
/** Source chain and asset of each route family; destinations are checked by the family itself. */
const FAMILIES = { "eip155:1/usdc": "ethereum-usdc", "eip155:56/native": "native", "eip155:8453/native": "native",
  "eip155:42161/usdc": "arbitrum-usdc" } as const;
const SOURCE_RPC = { 1: "ethereum", 56: "bnb", 8453: "base", 42161: "arbitrum" } as const;
const DESTINATION_RPC = { 1: "ethereum", 56: "bnb", 137: "polygon", 143: "monad", 4326: "megaeth", 8453: "base" } as const;

function routeUnknown(): never {
  throw new ApnError("APN_INVALID_INPUT", "Relay has no route for this source chain, asset and destination chain.", {
    reason: "relay_route_unknown", nextActions: ["apn help relay prepare"] });
}

/** Binds `relay prepare` to the internal prepare request of its route; route-only options are required or refused. */
export function bindRelayPrepare(o: Options): CommandRequest {
  const source = o["--source-chain"]!, destination = o["--destination-chain"]!;
  const family = (FAMILIES as Readonly<Record<string, string>>)[`${source}/${o["--asset"]}`];
  const uses = family === "ethereum-usdc" ? ["--max-approval-network-fee-wei"] : family === "arbitrum-usdc" ? [...ROUTE_OPTIONS] : [];
  if (family === undefined || (family === "ethereum-usdc" && destination !== "eip155:56" && destination !== "eip155:8453") ||
    (family === "arbitrum-usdc" && destination !== "eip155:1") ||
    (family === "native" && relayNativeRouteFor(Number(source.slice(7)), Number(destination.slice(7))) === null)) routeUnknown();
  for (const name of ROUTE_OPTIONS) {
    if (uses.includes(name) !== (o[name] !== undefined)) {
      throw new ApnError("APN_INVALID_INPUT", `${name} is ${uses.includes(name) ? "required" : "not accepted"} on this Relay route.`,
        { reason: "relay_route_option" });
    }
  }
  const common = { profile: o["--profile"]!, recipient: o["--recipient"]!, amountAtomic: o["--amount-atomic"]!,
    minOutputAtomic: o["--min-output-atomic"]!, maxDepositNetworkFeeWei: o["--max-deposit-network-fee-wei"]! };
  if (family === "native") return { command: "relay.native.prepare", ...common, sourceChain: source, destinationChain: destination,
    idempotencyKey: o["--idempotency-key"]! };
  if (family === "ethereum-usdc") return { command: destination === "eip155:8453" ? "relay.base.prepare" : "relay.prepare", ...common,
    maxApprovalNetworkFeeWei: o["--max-approval-network-fee-wei"]!, idempotencyKey: o["--idempotency-key"]! };
  return { command: "relay.arbitrum.prepare", ...common, owner: o["--payer"]!, maxProviderFeeAtomic: o["--max-provider-fee-atomic"]!,
    maxApprovalNetworkFeeWei: o["--max-approval-network-fee-wei"]!, quoteFile: o["--quote-file"]!, idempotencyKey: o["--idempotency-key"]! };
}

/** Runs `relay execute` or `relay observe` as the internal command of the saved route and names the next step. */
export async function executeRelayRoute(bound: BoundCommand, stateRoot: string,
  run: (internal: BoundCommand) => Promise<OutputEnvelope>): Promise<OutputEnvelope> {
  const request = bound.request as RelayRouteRequest;
  let resolved: BoundCommand, op: RelayUnsignedOperation;
  try {
    // Caller URLs are checked as public credential-free HTTPS before any saved state is read, as the route runtimes do.
    for (const url of [bound.rpcUrl, bound.destinationRpcUrl]) if (url !== undefined) parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "RPC endpoint");
    ({ resolved, op } = await resolveRelayRoute(bound, stateRoot));
  }
  catch (error) { return failureEnvelope(`relay.${request.action}`, randomUUID(), error); }
  const attempt = async (internal: BoundCommand) => {
    try { return await run(internal); } catch (error) { return failureEnvelope(internal.request.command, randomUUID(), error); }
  };
  let envelope = await attempt(resolved);
  // An allowance check that finds no sufficient allowance saves nothing, so the approval follows in the same call.
  if (resolved.request.command === "relay.arbitrum.approval-check" && envelope.ok && stateOf(envelope) === "approval_required") {
    envelope = await attempt({ ...resolved, request: { ...resolved.request, command: "relay.arbitrum.approval-execute" } as CommandRequest });
  }
  return envelope.ok && envelope.next_actions.length === 0 ? { ...envelope, next_actions: nextActions(request, op, envelope, bound.rpcUrl) } : envelope;
}

export async function resolveRelayRoute(bound: BoundCommand, stateRoot: string): Promise<{ readonly resolved: BoundCommand; readonly op: RelayUnsignedOperation }> {
  const request = bound.request as RelayRouteRequest, state = new StateStore(stateRoot);
  const profileHash = state.profileHash(request.profile);
  const op = await new RelayUnsignedOperationRepository(stateRoot).loadOperation(profileHash, request.operationId);
  if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay operation was not found for this profile.");
  const target = { profile: request.profile, operationId: request.operationId };
  if (request.action === "execute") {
    if (op.arbitrumDraft !== undefined) {
      const approval = (await new ArbitrumSourceEffectJournalRepository(stateRoot).load(profileHash, op.operationId))?.effects[0].phase ?? "pending";
      const step = approval === "pending" ? "approval-check" : approval === "confirmed" || approval === "approval_skipped" ? "deposit-dispatch" : "approval-execute";
      return { op, resolved: { request: { command: `relay.arbitrum.${step}`, ...target }, rpcUrl: bound.rpcUrl! } };
    }
    return { op, resolved: { request: { command: op.nativeQuote !== undefined ? "relay.native.execute" : "relay.execute", ...target }, rpcUrl: bound.rpcUrl! } };
  }
  const destination = bound.destinationRpcUrl;
  if (op.arbitrumDraft !== undefined) {
    return { op, resolved: { request: { command: "relay.arbitrum.observe", ...target }, rpcUrl: bound.rpcUrl!,
      ...(destination === undefined ? {} : { ethereumRpcUrl: destination }) } };
  }
  if (destination === undefined) {
    throw new ApnError("APN_INVALID_INPUT", "--destination-rpc-url is required to observe this Relay route.",
      { reason: "relay_destination_rpc_required" });
  }
  if (op.nativeQuote === undefined && op.destinationChainId === 8453) {
    return { op, resolved: { request: { command: "relay.base.observe", ...target }, rpcUrl: destination, ethereumRpcUrl: bound.rpcUrl! } };
  }
  return { op, resolved: { request: { command: "relay.observe", ...target }, rpcUrl: bound.rpcUrl!, bnbRpcUrl: destination } };
}

/** The next public command after a successful step, with the RPC the caller already gave; unknown URLs stay named slots. */
function nextActions(request: RelayRouteRequest, op: RelayUnsignedOperation, envelope: OutputEnvelope, rpcUrl: string | undefined): readonly string[] {
  if (request.action !== "execute") return [];
  const base = `--profile ${request.profile} --operation ${request.operationId} --rpc-url ${rpcUrl ?? `<${rpcName(SOURCE_RPC, op.sourceChainId)}-rpc>`}`;
  if (envelope.command === "relay.arbitrum.approval-check") return stateOf(envelope) === "approval_skipped" ? [`apn relay execute ${base}`] : [];
  const destination = envelope.command === "relay.arbitrum.approval-execute" ? ""
    : ` --destination-rpc-url <${rpcName(DESTINATION_RPC, op.destinationChainId)}-rpc>`;
  return [`apn relay observe ${base}${destination}`];
}

function rpcName(names: Readonly<Record<number, string>>, chainId: number): string { return names[chainId] ?? `eip155-${chainId}`; }

function stateOf(envelope: OutputEnvelope): unknown {
  return envelope.data !== null && typeof envelope.data === "object" ? (envelope.data as { readonly state?: unknown }).state : undefined;
}
