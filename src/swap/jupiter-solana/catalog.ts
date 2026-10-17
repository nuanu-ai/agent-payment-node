import { address } from "@solana/kit";
import { ApnError } from "../../errors.js";

export const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" as const;
export const JUPITER_V6_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" as const;
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112" as const;
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as const;
export const SYSTEM_PROGRAM = "11111111111111111111111111111111" as const;
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111" as const;
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as const;
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as const;
export const ADDRESS_LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111" as const;

export function canonicalAddress(value: string): string {
  try { return address(value); } catch { return invalid("Jupiter Solana address is invalid."); }
}
export function canonicalBase64(value: unknown, maximumBytes = 1232): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maximumBytes / 3) * 4) invalid("Jupiter transaction encoding is invalid.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > maximumBytes || bytes.toString("base64") !== value) invalid("Jupiter transaction encoding is invalid.");
  return bytes;
}
export function atomic(value: unknown, allowZero = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/u.test(value)) invalid("Jupiter atomic amount is invalid.");
  const result = BigInt(value); if (!allowZero && result === 0n) invalid("Jupiter atomic amount must be positive."); return result;
}
export function invalid(message: string): never { throw new ApnError("APN_PROVIDER_PROTOCOL", message); }
