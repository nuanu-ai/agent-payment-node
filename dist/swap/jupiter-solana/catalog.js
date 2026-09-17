import { address } from "@solana/kit";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
export const JUPITER_SOLANA_SCHEMA = "apn.swap.jupiter-solana.v1";
export const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const JUPITER_SWAP_API_V2 = "https://api.jup.ag/swap/v2";
export const JUPITER_V6_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const ADDRESS_LOOKUP_TABLE_PROGRAM = "AddressLookupTab1e1111111111111111111111111";
export const JUPITER_V2_SOURCE = Object.freeze({
    apiBase: JUPITER_SWAP_API_V2,
    programLabelsSource: "https://api.jup.ag/swap/v2/program-id-to-label",
    schemaDigest: domainHash(JUPITER_SOLANA_SCHEMA, canonicalJson({
        swapMode: "ExactIn", pair: [WRAPPED_SOL_MINT, SOLANA_USDC_MINT], transactionVersion: 0,
        responseBindings: Object.freeze(["requestId", "transaction", "lastValidBlockHeight"]),
    })),
});
/** Default-deny. A caller must inject a reviewed frozen snapshot; no network fallback exists. */
export const EMPTY_PROGRAM_SNAPSHOT = createProgramSnapshot([]);
export function createProgramSnapshot(entries) {
    const normalized = entries.map((entry) => {
        if (!isPlainRecord(entry) || !exactKeys(entry, ["programId", "label"]) || typeof entry.programId !== "string" ||
            typeof entry.label !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._()+/-]{0,95}$/u.test(entry.label))
            invalid("Jupiter program snapshot entry is invalid.");
        canonicalAddress(entry.programId);
        if ([JUPITER_V6_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM].includes(entry.programId)) {
            invalid("Jupiter route snapshot must not redefine a pinned program.");
        }
        return Object.freeze({ programId: entry.programId, label: entry.label });
    });
    normalized.sort((a, b) => a.programId.localeCompare(b.programId));
    if (new Set(normalized.map((entry) => entry.programId)).size !== normalized.length)
        invalid("Jupiter program snapshot contains duplicate programs.");
    const body = { schemaVersion: JUPITER_SOLANA_SCHEMA, sourceUrl: "https://api.jup.ag/swap/v2/program-id-to-label", entries: Object.freeze(normalized) };
    return Object.freeze({ ...body, digest: domainHash("apn.jupiter-program-snapshot.v1", canonicalJson(body)) });
}
export function validateProgramSnapshot(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "sourceUrl", "entries", "digest"]) ||
        value.schemaVersion !== JUPITER_SOLANA_SCHEMA || value.sourceUrl !== "https://api.jup.ag/swap/v2/program-id-to-label" ||
        !Array.isArray(value.entries) || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/u.test(value.digest))
        corrupt("Jupiter program snapshot is invalid.");
    const expected = createProgramSnapshot(value.entries);
    if (canonicalJson(expected) !== canonicalJson(value))
        corrupt("Jupiter program snapshot digest or ordering is invalid.");
    return expected;
}
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
export function hash64(value) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
        invalid("Jupiter digest is invalid.");
    return value;
}
export function sha256Bytes(value) { return sha256(value); }
export function invalid(message) { throw new ApnError("APN_PROVIDER_PROTOCOL", message); }
export function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=catalog.js.map