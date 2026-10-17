import { gaszipProviderFlags, inspectGaszipNativeDelivery, type GaszipProviderFailure } from "./gaszip-native-delivery.js";
import { getAddress, type Hex } from "viem";
import { ApnError } from "../errors.js";
import { hashObject } from "../canonical.js";

/**
 * GasZip direct deposit (deposit to sender): Base native ETH to the payer's own native balance on the destination chain.
 * One route, keyed by destination chain; the table holds protocol data only. It never grants LI.FI GasZip execution.
 */
export interface GaszipDirectRoute {
  /** Error prefix, effect-binding lane and CLI group (`apn <lane> funding ...`). */
  readonly lane: "mega" | "sei";
  readonly kind: "mega_gaszip" | "sei_gaszip";
  readonly schemaVersion: "apn.mega-gaszip-operation.v1" | "apn.sei-gaszip-operation.v1";
  readonly sourceChain: 8453;
  readonly destinationChain: 4326 | 1329;
  readonly destinationName: string;
  readonly destinationAsset: string;
  /** GasZip short chain id; the calldata is `0x01 || short` (deposit to the sender). */
  readonly short: 514 | 246;
  readonly target: string;
  readonly data: Hex;
  readonly mechanism: Readonly<{ provider: "gaszip"; reference: string }>;
  readonly destinationRpcVariable: "APN_MEGA_RPC_URL" | "APN_SEI_RPC_URL";
  /** The prepared operation also holds the payer's destination account (as each route has since it shipped). */
  readonly holdsDestinationAccount: boolean;
}
const TARGET = getAddress("0x391E7C679d29bD940d63be94AD22A25d25b5A604");
export const GASZIP_DIRECT_ROUTES = Object.freeze({
  mega: Object.freeze({ lane: "mega", kind: "mega_gaszip", schemaVersion: "apn.mega-gaszip-operation.v1", sourceChain: 8453, destinationChain: 4326,
    destinationName: "Mega", destinationAsset: "ETH", short: 514, target: TARGET, data: "0x010202",
    mechanism: Object.freeze({ provider: "gaszip", reference: "v2-direct-base-mega-self-010202.1" }), destinationRpcVariable: "APN_MEGA_RPC_URL",
    holdsDestinationAccount: false }),
  sei: Object.freeze({ lane: "sei", kind: "sei_gaszip", schemaVersion: "apn.sei-gaszip-operation.v1", sourceChain: 8453, destinationChain: 1329,
    destinationName: "Sei", destinationAsset: "SEI", short: 246, target: TARGET, data: "0x0100f6",
    mechanism: Object.freeze({ provider: "gaszip", reference: "v2-direct-base-sei-self-0100f6.1" }), destinationRpcVariable: "APN_SEI_RPC_URL",
    holdsDestinationAccount: true }),
} as const satisfies Readonly<Record<string, GaszipDirectRoute>>);

/** Strict parsers that refuse with the route's own `<lane>_gaszip_<reason>`. */
export interface GaszipCodec {
  fail(reason: string): never;
  object(v: unknown): Record<string, unknown>;
  uint(v: unknown): bigint;
  quantity(v: unknown): bigint;
  hash(v: unknown): Hex;
  address(v: unknown): string;
  json(text: string): unknown;
  exact(v: Record<string, unknown>, required: readonly string[], optional?: readonly string[]): void;
}
function codecFor(lane: GaszipDirectRoute["lane"]): GaszipCodec {
  const fail = (reason: string): never => { throw new ApnError("APN_OPERATION_BLOCKED", `${lane}_gaszip_${reason}`, { reason: `${lane}_gaszip_${reason}` }); };
  return {
    fail,
    object: (v) => { if (v === null || typeof v !== "object" || Array.isArray(v)) fail("object"); return v as Record<string, unknown>; },
    uint: (v) => { if (typeof v !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(v)) fail("exact_uint"); return BigInt(v as string); },
    quantity: (v) => { if (typeof v !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(v)) fail("rpc_quantity"); return BigInt(v as string); },
    hash: (v) => { if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(v)) fail("hash"); return (v as string).toLowerCase() as Hex; },
    address: (v) => { if (typeof v !== "string") fail("address"); try { return getAddress(v as string); } catch { return fail("address"); } },
    // Parse integer lexemes without Number rounding. Unsafe numeric inputs supplied without their source are refused.
    json: (text) => {
      try {
        return JSON.parse(text, ((_key: string, value: unknown, context?: { source?: string }) => {
          if (typeof value !== "number") return value;
          if (context?.source !== undefined && /^(?:0|[1-9][0-9]*)$/u.test(context.source)) return context.source;
          if (!Number.isFinite(value) || !Number.isSafeInteger(value) && Number.isInteger(value)) fail("unsafe_json_number");
          return value;
        }) as (key: string, value: unknown) => unknown);
      } catch { return fail("json"); }
    },
    // Required provider fields must be present; fields GasZip adds later are ignored (the chain proves every effect itself).
    exact: (v, required) => { if (required.some((k) => !Object.hasOwn(v, k))) fail("schema"); },
  };
}
const CODECS: Readonly<Record<GaszipDirectRoute["lane"], GaszipCodec>> = { mega: codecFor("mega"), sei: codecFor("sei") };
export function gaszipCodec(route: Pick<GaszipDirectRoute, "lane">): GaszipCodec { return CODECS[route.lane]; }

export interface GaszipFundingQuote { readonly digest: string; readonly expiresAt: string; readonly expectedAtomic: string; readonly body: unknown }
export function inspectGaszipFundingQuote(route: GaszipDirectRoute, value: unknown, now: number): GaszipFundingQuote {
  const c = gaszipCodec(route), v = c.object(value); c.exact(v, ["calldata", "expires", "quotes"], ["contractDepositTxn"]);
  if (v.calldata !== route.data || !Array.isArray(v.quotes) || v.quotes.length !== 1) c.fail("quote_lane");
  const q = c.object((v.quotes as unknown[])[0]); c.exact(q, ["chain", "expected", "gas", "speed", "usd"], ["decimals", "expectedNative"]);
  if (c.uint(q.chain) !== BigInt(route.destinationChain) || (q.decimals !== undefined && c.uint(q.decimals) !== 18n) ||
    (q.expectedNative !== undefined && c.uint(q.expectedNative) !== c.uint(q.expected)) ||
    typeof q.speed !== "number" && typeof q.speed !== "string" || typeof q.usd !== "number" && typeof q.usd !== "string") c.fail("quote_output");
  c.uint(q.gas); const expires = c.uint(v.expires);
  if (expires > BigInt(Number.MAX_SAFE_INTEGER) || Number(expires) * 1000 - now < 30_000 || Number(expires) * 1000 - now > 90_000) c.fail("quote_expiry");
  return { digest: hashObject(value), expiresAt: new Date(Number(expires) * 1000).toISOString(), expectedAtomic: c.uint(q.expected).toString(), body: value };
}
export interface GaszipCorrelatedDelivery { readonly hash: Hex; readonly amount: string; readonly signer: string; readonly nonce: string; readonly providerDigest: string; readonly grossNative?: true }
/** Provider mapping authorizes observation only; both effects must be independently proved by their chain RPC. */
export function inspectGaszipDelivery(route: GaszipDirectRoute, value: unknown, sourceHash: Hex, owner: string, amount: string,
  sourceBlock?: string): GaszipCorrelatedDelivery | GaszipProviderFailure | null {
  const c = gaszipCodec(route), v = c.object(value); c.exact(v, ["deposit", "txs"]); const d = c.object(v.deposit);
  if (Object.hasOwn(d, "seen")) return inspectGaszipNativeDelivery(value, sourceHash, owner, amount, sourceBlock, route.destinationChain, route.short, 0n, c);
  c.exact(d, ["block", "chain", "hash", "log", "sender", "shorts", "status", "time", "to", "usd", "value"]);
  if (c.hash(d.hash) !== sourceHash || c.uint(d.chain) !== 8453n || c.address(d.sender) !== owner || c.uint(d.value) !== c.uint(amount) ||
    c.address(d.to) !== owner || !Array.isArray(d.shorts) || d.shorts.length !== 1 || c.uint(d.shorts[0]) !== BigInt(route.short)) c.fail("deposit_binding");
  if (sourceBlock !== undefined && c.uint(d.block).toString() !== sourceBlock) c.fail("deposit_block_binding");
  if (!["SEEN", "PENDING", "CONFIRMED", "PRIORITY", "CANCELLED"].includes(String(d.status))) c.fail("deposit_status");
  if (d.status === "CANCELLED") return { providerFailure: "provider_cancelled", providerDigest: hashObject(value) };
  if (d.status !== "CONFIRMED") return null;
  if (!Array.isArray(v.txs) || v.txs.length > 8) c.fail("delivery_count");
  const rows = (v.txs as unknown[]).map(c.object), failed = rows.map((t) => gaszipProviderFlags(t, c.fail)).find((x) => x !== null);
  if (failed !== undefined) return { providerFailure: failed, providerDigest: hashObject(value) };
  if (rows.some((t) => c.uint(t.chain) !== BigInt(route.destinationChain))) c.fail("unexpected_outbound_chain");
  if (rows.length === 0) return null; if (rows.length !== 1) c.fail("delivery_ambiguous");
  const t = rows[0]!; c.exact(t, ["chain", "hash", "nonce", "refund", "cancelled", "signer", "status", "time", "to", "usd", "value"]);
  if (c.address(t.to) !== owner) c.fail("delivery_binding");
  if (!["SEEN", "PENDING", "CONFIRMED", "PRIORITY", "CANCELLED"].includes(String(t.status))) c.fail("outbound_status");
  if (t.status === "CANCELLED") return { providerFailure: "provider_cancelled", providerDigest: hashObject(value) };
  if (t.status !== "CONFIRMED") return null;
  // The owner's floor is applied after the payout is proved on chain; a lower payout is a terminal destination failure.
  return { hash: c.hash(t.hash), amount: c.uint(t.value).toString(), signer: c.address(t.signer), nonce: c.uint(t.nonce).toString(), providerDigest: hashObject(value) };
}
