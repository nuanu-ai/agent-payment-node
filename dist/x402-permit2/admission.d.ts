import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { type Permit2AssetResolver } from "./registry.js";
/**
 * The offers the owner's active allowlist policy admits for Permit2: an EVM chain row naming the offer's network, a token
 * row naming its contract with the x402 rail on and exactly the `x402-exact-permit2` mechanism pin. Symbol, decimals and
 * network name come from that row; the EIP-2612 domain only from the seller's name/version hint (a sponsored permit
 * needs it, as the seller's facilitator verifies against it), and the read port proves it on chain before use.
 */
export declare function admittedPermit2Assets(active: ActiveAssetPolicy): Permit2AssetResolver;
