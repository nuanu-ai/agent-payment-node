import { address } from "@solana/kit";
import { ApnError } from "../../errors.js";
export const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const JUPITER_V6_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const ADDRESS_LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111";
export function canonicalAddress(value) {
    try {
        return address(value);
    }
    catch {
        return invalid("Jupiter Solana address is invalid.");
    }
}
export function canonicalBase64(value, maximumBytes = 1232) {
    if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maximumBytes / 3) * 4)
        invalid("Jupiter transaction encoding is invalid.");
    const bytes = Buffer.from(value, "base64");
    if (bytes.length === 0 || bytes.length > maximumBytes || bytes.toString("base64") !== value)
        invalid("Jupiter transaction encoding is invalid.");
    return bytes;
}
export function atomic(value, allowZero = false) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/u.test(value))
        invalid("Jupiter atomic amount is invalid.");
    const result = BigInt(value);
    if (!allowZero && result === 0n)
        invalid("Jupiter atomic amount must be positive.");
    return result;
}
export function invalid(message) { throw new ApnError("APN_PROVIDER_PROTOCOL", message); }
//# sourceMappingURL=catalog.js.map