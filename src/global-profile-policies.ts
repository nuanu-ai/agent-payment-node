import { getAddress } from "viem";
import { readGlobalPolicyDocument } from "./allowlist-global-policy.js";
import { chainAsset, chainDecimal, sealChainPolicy, SOLANA_GENESIS, validateChainPolicy, type ChainPolicy } from "./chain-policy.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import type { ChainAccount, ChainAssetAlias } from "./direct-rail-ports.js";
import { ApnError } from "./errors.js";
import {
  canonicalPolicyInput,
  PROFILE_POLICY_VERSION,
  sealProfilePolicy,
  validateProfilePolicy,
  type ProfilePolicyBinding,
  type ProfilePolicyRecord,
} from "./profile-policy.js";
import { TRON_GENESIS } from "./tron/constants.js";

/**
 * The global file's `walletPolicies` row for this binding's x402 network and asset, sealed for this profile and wallet,
 * or null when the server's policy has no such row (the payment is then refused as without a policy).
 * Row: `{ chain: "eip155:<id>" | "solana:<genesis>", asset, maxBalanceAtomic, maxX402AmountAtomic, maxBalanceNativeWei?, x402Payees? }`.
 */
export async function globalWalletPolicy(path: string, binding: ProfilePolicyBinding): Promise<ProfilePolicyRecord | null> {
  const file = await readGlobalPolicyDocument(path);
  const row = (file.walletPolicies ?? []).find((candidate) => walletRowMatches(candidate, binding));
  if (row === undefined) return null;
  const input = canonicalPolicyInput({
    maxBalanceUsdcAtomic: field(row.maxBalanceAtomic, "maxBalanceAtomic"),
    maxX402AmountAtomic: field(row.maxX402AmountAtomic, "maxX402AmountAtomic"),
    ...(row.maxBalanceNativeWei === undefined ? {} : { maxBalanceEthWei: field(row.maxBalanceNativeWei, "maxBalanceNativeWei") }),
    ...(row.x402Payees === undefined ? {} : { x402Payees: payees(row.x402Payees) }),
  }, binding);
  const { x402Payees, ...caps } = input;
  return validateProfilePolicy(sealProfilePolicy({
    schemaVersion: PROFILE_POLICY_VERSION, ...binding, ...caps,
    ...(x402Payees === undefined || x402Payees === null ? {} : { x402Payees: x402Payees as NonNullable<ProfilePolicyRecord["x402Payees"]> }),
    approvedAt: file.effectiveAt, updatedAt: file.effectiveAt,
  }), binding);
}

/**
 * The global file's `chainPolicies` row for this Solana or TRON account and asset alias, or null.
 * Row: `{ rail: "solana" | "tron", asset: "sol" | "usdc" | "usdt" | "trx", maximumPerTransfer, dailyLimit, maximumFee }` in decimal units.
 */
export async function globalChainPolicy(path: string, account: ChainAccount, alias: ChainAssetAlias): Promise<ChainPolicy | null> {
  const file = await readGlobalPolicyDocument(path);
  const row = (file.chainPolicies ?? []).find((candidate) => candidate.rail === account.rail && candidate.asset === alias);
  if (row === undefined) return null;
  const asset = chainAsset(account.rail, alias);
  const maximumPerTransferAtomic = chainDecimal(field(row.maximumPerTransfer, "maximumPerTransfer"), asset.decimals);
  const dailyLimitAtomic = chainDecimal(field(row.dailyLimit, "dailyLimit"), asset.decimals);
  if (BigInt(maximumPerTransferAtomic) > BigInt(dailyLimitAtomic)) invalid("A chain policy's daily limit must cover its per-transfer limit.");
  return validateChainPolicy(sealChainPolicy({
    schemaVersion: "apn.chain-policy.v1", account, asset, networkIdentity: account.rail === "solana" ? SOLANA_GENESIS : TRON_GENESIS,
    maximumPerTransferAtomic, dailyLimitAtomic,
    maximumNativeFeeAtomic: chainDecimal(field(row.maximumFee, "maximumFee"), account.rail === "solana" ? 9 : 6),
    admittedAt: file.effectiveAt,
  }));
}

function walletRowMatches(row: Readonly<Record<string, unknown>>, binding: ProfilePolicyBinding): boolean {
  if (typeof row.chain !== "string" || typeof row.asset !== "string") invalid("Each wallet policy row needs chain and asset.");
  if (binding.x402Solana !== undefined) return row.chain.startsWith("solana:") && row.asset === binding.x402Solana.mint;
  const chainId = binding.x402Network?.chainId ?? CHAIN_ID;
  const token = binding.x402Network?.token ?? BASE_USDC;
  if (row.chain !== `eip155:${chainId}`) return false;
  try { return getAddress(row.asset) === getAddress(token); } catch { return invalid("A wallet policy row names an invalid EVM asset."); }
}

function field(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") invalid(`Global policy field ${name} must be a non-empty string.`);
  return value;
}

function payees(value: unknown): readonly string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) invalid("x402Payees must be a list of EVM addresses or null.");
  return value as readonly string[];
}

function invalid(message: string): never {
  throw new ApnError("APN_INVALID_INPUT", message, { reason: "invalid_global_policy_file" });
}
