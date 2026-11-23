/** Relay ERC-20 token routes: the Binance-Peg USDT and USDC of BNB Smart Chain to and from the USDC and USDT of Ethereum,
 * Polygon, Base and Arbitrum. Protocol data only, keyed by the policy mechanism reference; payer, recipient, profile and
 * amounts are per-operation inputs bound into the signed order.
 *
 * Evidence (2026-11-23): Relay GET /chains lists every token below as a solver currency of its chain and names the same
 * protocol v2 depository on all five chains; keyless quote/v2 quoted all 32 BNB pairs with one shape (an exact approve of
 * the source token to the depository, then depositErc20, a solver-signed order on the Base hub that pays the destination
 * token directly, no destination calls or order fees); decimals() and symbol() were read from each contract over public
 * RPC. Amounts are atomic in their own token: the source amount in source decimals, the minimum output in destination
 * decimals. Some tokens are destinations only: Base USDT and the Polygon and Arbitrum USDT0 deployments, because the frozen
 * allowlist dataset cannot admit them on the bridge rail; Base USDC, because an OP Stack transaction also pays an L1 data
 * fee and an operator fee outside the frozen gas x max-fee envelope this lane bounds by the caller's ceilings (the native
 * Base lane bounds them with its own simulation, which this lane does not have). */
import { getAddress } from "viem";
import { BINANCE_PEG_POLICY_ASSETS } from "../binance-peg-policy-assets.js";
import { ETHEREUM_DEPOSITORY } from "./quote.js";
/** The Relay protocol v2 depository named for chains 1, 56, 137, 8453 and 42161 by GET /chains on 2026-11-23. */
export const RELAY_TOKEN_DEPOSITORY = ETHEREUM_DEPOSITORY;
/** The block tag each chain's public RPCs answer for a consensus-safe checkpoint (Polygon answers only `finalized`). */
export const RELAY_TOKEN_SAFE_TAG = { 1: "safe", 56: "safe", 137: "finalized", 8453: "safe", 42161: "safe" };
const row = (chainId, relayChain, alias, address, decimals, source) => Object.freeze({ chainId, relayChain, alias, address: getAddress(address), decimals, source });
export const RELAY_TOKENS = Object.freeze([
    row(1, "ethereum", "usdc", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6, true),
    row(1, "ethereum", "usdt", "0xdac17f958d2ee523a2206206994597c13d831ec7", 6, true),
    row(56, "bnb", "usdt", "0x55d398326f99059ff775485246999027b3197955", 18, true),
    row(56, "bnb", "usdc", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", 18, true),
    row(137, "polygon", "usdc", "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", 6, true),
    row(137, "polygon", "usdt", "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", 6, false),
    row(8453, "base", "usdc", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 6, false),
    row(8453, "base", "usdt", "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", 6, false),
    row(42161, "arbitrum", "usdc", "0xaf88d065e77c8cc2239327c5edb3a432268e5831", 6, true),
    row(42161, "arbitrum", "usdt", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", 6, false),
]);
// The BNB rows are the reviewed supplement's own identities and decimals; a disagreement is a build defect.
for (const token of RELAY_TOKENS.filter(entry => entry.chainId === 56)) {
    const reviewed = BINANCE_PEG_POLICY_ASSETS.find(asset => asset.identifier === token.address);
    if (reviewed === undefined || reviewed.decimals !== token.decimals || reviewed.symbol.toLowerCase() !== token.alias)
        throw new Error("Relay token routes disagree with the reviewed Binance-Peg supplement.");
}
const routes = {};
for (const bnb of RELAY_TOKENS.filter(token => token.chainId === 56)) {
    for (const peer of RELAY_TOKENS.filter(token => token.chainId !== 56)) {
        for (const [source, destination] of [[bnb, peer], [peer, bnb]]) {
            if (!source.source)
                continue;
            const reference = `${source.relayChain}-${source.alias}-${destination.relayChain}-${destination.alias}-v1`;
            routes[reference] = Object.freeze({ reference, source, destination });
        }
    }
}
const ROUTES = Object.freeze(routes);
export function relayTokenRoutes() { return Object.values(ROUTES); }
/** The route a new prepare uses, chosen by the caller's chains and token aliases, or null when none is listed. */
export function relayTokenRouteFor(sourceChainId, sourceAlias, destinationChainId, destinationAlias) {
    return Object.values(ROUTES).find(route => route.source.chainId === sourceChainId && route.source.alias === sourceAlias &&
        route.destination.chainId === destinationChainId && route.destination.alias === destinationAlias) ?? null;
}
/** The route a saved quote names; an unknown reference is null and its operation is corrupt. */
export function relayTokenRouteByReference(reference) {
    return typeof reference === "string" && Object.prototype.hasOwnProperty.call(ROUTES, reference) ? ROUTES[reference] : null;
}
//# sourceMappingURL=token-routes.js.map