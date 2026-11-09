import { type ChainPolicy } from "./chain-policy.js";
import type { ChainAccount, ChainAssetAlias } from "./direct-rail-ports.js";
import { type ProfilePolicyBinding, type ProfilePolicyRecord } from "./profile-policy.js";
/**
 * The global file's `walletPolicies` row for this binding's x402 network and asset, sealed for this profile and wallet,
 * or null when the server's policy has no such row (the payment is then refused as without a policy).
 * Row: `{ chain: "eip155:<id>" | "solana:<genesis>", asset, maxBalanceAtomic, maxX402AmountAtomic, maxBalanceNativeWei?, x402Payees? }`.
 */
export declare function globalWalletPolicy(path: string, binding: ProfilePolicyBinding): Promise<ProfilePolicyRecord | null>;
/**
 * The global file's `chainPolicies` row for this Solana or TRON account and asset alias, or null.
 * Row: `{ rail: "solana" | "tron", asset: "sol" | "usdc" | "usdt" | "trx", maximumPerTransfer, dailyLimit, maximumFee }` in decimal units.
 */
export declare function globalChainPolicy(path: string, account: ChainAccount, alias: ChainAssetAlias): Promise<ChainPolicy | null>;
