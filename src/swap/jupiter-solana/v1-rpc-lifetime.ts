import { exactKeys } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { rpcAtomic, rpcRecord, type SolanaRpcPort } from "../../solana/rpc.js";
import { checkedJupiterV1QuoteRpcLifetime, type JupiterV1QuoteRpcLifetime, type JupiterV1SemanticAccount } from "./v1-material.js";

/** Remaining blocks a freshly frozen quote lifetime must leave at its own fee/height read. */
export const JUPITER_V1_RPC_LIFETIME_WINDOW = Object.freeze({ minimumRemainingBlocks: 100, maximumRemainingBlocks: 151 });

/**
 * Quote construction only, before any saved quote, consent, lease or signature: the configured RPC supplies the frozen
 * blockhash from a bank at least as recent as every account the quote read. The official build's own blockhash is never
 * signed, so no second official build is requested for a fresher one.
 */
export async function readJupiterV1QuoteRpcLifetime(rpc: Pick<SolanaRpcPort, "call" | "originHash">,
  accounts: readonly Pick<JupiterV1SemanticAccount, "slot">[]): Promise<JupiterV1QuoteRpcLifetime> {
  const minimumContextSlot = accounts.reduce((largest, row) => BigInt(row.slot) > largest ? BigInt(row.slot) : largest, 0n);
  if (minimumContextSlot > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApnError("APN_REPREPARE_REQUIRED", "Jupiter quote RPC context cannot be represented safely.");
  const result = rpcRecord(await rpc.call("getLatestBlockhash", [{ commitment: "confirmed", minContextSlot: Number(minimumContextSlot) }]));
  const value = rpcRecord(result.value), context = rpcRecord(result.context);
  if (!exactKeys(result, ["context", "value"]) || !exactKeys(value, ["blockhash", "lastValidBlockHeight"]) ||
      !exactKeys(context, ["slot", ...(Object.hasOwn(context, "apiVersion") ? ["apiVersion"] : [])]) ||
      context.apiVersion !== undefined && (typeof context.apiVersion !== "string" || context.apiVersion.length > 64))
    throw new ApnError("APN_RPC_PROTOCOL", "Jupiter's pre-freeze RPC blockhash response shape is invalid.");
  return checkedJupiterV1QuoteRpcLifetime({ source: "configured_mainnet_rpc_before_quote_freeze", rpcOriginHash: rpc.originHash,
    contextSlot: rpcAtomic(context.slot).toString(), minimumContextSlot: minimumContextSlot.toString(),
    blockhash: value.blockhash, lastValidBlockHeight: rpcAtomic(value.lastValidBlockHeight).toString() });
}

/** The fee/height read that prices the frozen message must leave a bounded, plausible lifetime. */
export function assertJupiterV1RpcLifetimeWindow(lifetime: JupiterV1QuoteRpcLifetime, height: string): void {
  const remaining = BigInt(lifetime.lastValidBlockHeight) - BigInt(height), window = JUPITER_V1_RPC_LIFETIME_WINDOW;
  if (remaining < BigInt(window.minimumRemainingBlocks) || remaining > BigInt(window.maximumRemainingBlocks))
    throw new ApnError("APN_REPREPARE_REQUIRED", "Jupiter's pre-freeze RPC blockhash has an insufficient or excessive lifetime.", {
      remainingBlocks: remaining.toString(), observedBlockHeight: height, lastValidBlockHeight: lifetime.lastValidBlockHeight,
      blockhashContextSlot: lifetime.contextSlot, requiredMinimumContextSlot: lifetime.minimumContextSlot,
      minimumRemainingBlocks: window.minimumRemainingBlocks, maximumRemainingBlocks: window.maximumRemainingBlocks, commitment: "confirmed",
    });
}
