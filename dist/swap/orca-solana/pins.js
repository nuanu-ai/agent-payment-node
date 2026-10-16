import { createHash } from "node:crypto";
import { address, getAddressEncoder } from "@solana/kit";
import { SOLANA_USDC } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import { SWAP_MECHANISM_PIN_SCHEMA, swapMechanismDigest, validateSwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry } from "../protocol-registry.js";
import { readRawAccounts } from "./accounts.js";
/**
 * Keyless Orca Whirlpool pins. Every value was read from Solana mainnet on 2026-09-18 (slots 447989559-447990764):
 * the Whirlpool program is executable under the upgradeable loader, the pool account is owned by it, its mints are
 * wSOL (A) and USDC (B), and it is the deepest SOL/USDC Whirlpool (91,742 SOL and 15.1M USDC in its vaults, in-range
 * liquidity about 1000x the next tick spacing). Its oracle PDA is absent, so the fee is the static fee rate below.
 */
export const ORCA_SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
export const WHIRLPOOL_PROGRAMDATA = "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD";
export const WHIRLPOOLS_CONFIG = "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ";
export const ORCA_SOL_USDC_POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
export const ORCA_SOL_VAULT = "EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9";
export const ORCA_USDC_VAULT = "2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP";
export const ORCA_POOL_TICK_SPACING = 4;
/** Hundredths of a basis point (400 = 0.04%). A fee change is a pin drift and refuses until re-reviewed. */
export const ORCA_POOL_FEE_RATE = 400;
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = SOLANA_USDC;
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_PROGRAMDATA = "3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const IMMUTABLE_LOADER = "BPFLoader2111111111111111111111111111111111";
export const NATIVE_LOADER = "NativeLoader1111111111111111111111111111111";
/** Anchor discriminators: sha256("global:swap")[0..8], sha256("account:Whirlpool"|"account:TickArray")[0..8]. */
export const WHIRLPOOL_SWAP_DISCRIMINATOR = "f8c69e91e17587c8";
export const WHIRLPOOL_ACCOUNT_DISCRIMINATOR = "3f95d10ce1806309";
export const TICK_ARRAY_ACCOUNT_DISCRIMINATOR = "4561bdbe6e0742bb";
export const WHIRLPOOL_DEPLOYMENT_SLOT = 457_152_296;
export const ORCA_PROGRAM_PINS = [
    { role: "whirlpool_program", address: WHIRLPOOL_PROGRAM, owner: UPGRADEABLE_LOADER, executable: true, space: 36, scope: "account",
        dataSha256: programAccountHash(WHIRLPOOL_PROGRAMDATA) },
    { role: "whirlpool_programdata_header", address: WHIRLPOOL_PROGRAMDATA, owner: UPGRADEABLE_LOADER, executable: false, space: 10_485_760,
        scope: "programdata_header", dataSha256: "fabfdb127c040782f2ba077df7cbc62185c14a036c8d136e0fed4fac3e7f1bdf" },
    { role: "whirlpool_programdata_payload", address: WHIRLPOOL_PROGRAMDATA, owner: UPGRADEABLE_LOADER, executable: false, space: 10_485_760,
        scope: "programdata_payload", dataSha256: "c422b22f3eefe86dd55878a4f505b9c68c26e241dc96af1573ca032b24b8ee3f" },
    { role: "spl_token_program", address: TOKEN_PROGRAM, owner: UPGRADEABLE_LOADER, executable: true, space: 36, scope: "account",
        dataSha256: programAccountHash(TOKEN_PROGRAMDATA) },
    { role: "spl_token_programdata", address: TOKEN_PROGRAMDATA, owner: UPGRADEABLE_LOADER, executable: false, space: 108_645, scope: "account",
        dataSha256: "573971c9baedda479bf4c38537787ae396358009b4920f8a270bd2b31dde5fe3" },
    { role: "associated_token_program", address: ATA_PROGRAM, owner: IMMUTABLE_LOADER, executable: true, space: 105_032, scope: "account",
        dataSha256: "6804554e69fd3a58caa191dc4a58f4c67223d30ca28ab8987f39fc18d2f7374d" },
    { role: "system_program", address: SYSTEM_PROGRAM, owner: NATIVE_LOADER, executable: true, space: 21, scope: "account",
        dataSha256: sha256Hex(Buffer.from("solana_system_program")) },
    { role: "compute_budget_program", address: COMPUTE_BUDGET_PROGRAM, owner: NATIVE_LOADER, executable: true, space: 22, scope: "account",
        dataSha256: sha256Hex(Buffer.from("compute_budget_program")) },
];
export const PROGRAMDATA_HEADER_BYTES = 45;
/** Base64 of one chunk occupies 2,000,000 bytes, under the 2 MiB RPC body cap; 10 MiB takes seven reads. */
export const PROGRAMDATA_CHUNK_BYTES = 1_500_000;
/** Historical generation (deployed at slot 440170207). It only identifies existing operations; it cannot quote or sign. */
export const ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207 = validateSwapMechanismPin({
    schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "orca_solana", networkFamily: "solana", chain: ORCA_SOLANA_CHAIN,
    protocolVersion: "whirlpool-slot-440170207", constructorKind: "sdk", constructorIdentity: "apn.orca-whirlpool.local-instruction-builder",
    constructorVersion: "1.0.0", routerProgramIdentity: WHIRLPOOL_PROGRAM,
    auxiliaryContractProgramIdentities: [ORCA_SOL_USDC_POOL, WHIRLPOOLS_CONFIG, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM],
    quoteSchemaVersion: "whirlpool-onchain-state.exact-in-a-to-b.1",
    transactionSchemaVersion: "v0.compute-budget-ata-wrap-swap-close.1",
    validationPolicyIdentity: "apn.orca.solana-native-sol-usdc-keyless", validationPolicyVersion: "1.0.0",
});
/** Current generation. Historical owner admissions name the slot-440170207 pin and cannot authorize these bytes. */
export const ORCA_KEYLESS_MECHANISM_PIN = validateSwapMechanismPin({
    ...ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207, protocolVersion: `whirlpool-slot-${WHIRLPOOL_DEPLOYMENT_SLOT}`,
});
/** Official identity only. Owners must still admit SOL and USDC with this exact pin under a sealed policy. */
export const ORCA_KEYLESS_PROTOCOL_REGISTRY = compileSwapProtocolRegistry({
    registryVersion: "orca-whirlpool-keyless.2026-10-16", pins: [ORCA_KEYLESS_MECHANISM_PIN],
});
const ORCA_KEYLESS_MECHANISM_DIGESTS = Object.freeze([ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207]
    .map((pin) => swapMechanismDigest(pin)));
/** Any registered keyless generation: existing operations stay readable and observable after a program upgrade. */
export function isOrcaKeylessMechanismDigest(digest) { return ORCA_KEYLESS_MECHANISM_DIGESTS.includes(digest); }
export const verifyOrcaProgramPins = async (rpc) => {
    const accounts = ORCA_PROGRAM_PINS.filter((pin) => pin.scope === "account");
    const read = await readRawAccounts(rpc, accounts.map((pin) => pin.address), 262_144);
    accounts.forEach((pin, index) => verifyProgram(pin, read.accounts[index] ?? null));
    await verifyWhirlpoolProgramData(rpc);
    return ORCA_PROGRAM_PINS;
};
/** Reads the whole programdata in chunks. The first chunk carries the header, so header drift refuses before the rest. */
async function verifyWhirlpoolProgramData(rpc) {
    const header = programDataPin("programdata_header"), payload = programDataPin("programdata_payload");
    const chunk = async (offset) => (await readRawAccounts(rpc, [WHIRLPOOL_PROGRAMDATA], PROGRAMDATA_CHUNK_BYTES, { offset, length: Math.min(PROGRAMDATA_CHUNK_BYTES, header.space - offset) })).accounts[0] ?? null;
    const first = await chunk(0);
    if (first === null || first.data.length < PROGRAMDATA_HEADER_BYTES)
        drift(header);
    verifyProgram(header, { ...first, data: first.data.subarray(0, PROGRAMDATA_HEADER_BYTES) });
    const chunks = [first.data];
    for (let offset = PROGRAMDATA_CHUNK_BYTES; offset < header.space; offset += PROGRAMDATA_CHUNK_BYTES) {
        const next = await chunk(offset);
        if (next === null || next.owner !== first.owner || next.executable !== first.executable || next.space !== first.space)
            drift(payload);
        chunks.push(next.data);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== payload.space)
        drift(payload);
    verifyProgram(payload, { ...first, data: bytes.subarray(PROGRAMDATA_HEADER_BYTES) });
}
function programDataPin(scope) {
    const pin = ORCA_PROGRAM_PINS.find((row) => row.scope === scope);
    if (pin === undefined)
        throw new ApnError("APN_STATE_CORRUPT", "Orca programdata pin is missing.");
    return pin;
}
function verifyProgram(pin, account) {
    if (account === null || account.owner !== pin.owner || account.executable !== pin.executable || account.space !== pin.space ||
        sha256Hex(account.data) !== pin.dataSha256 || (pin.scope === "account" && account.data.length !== pin.space))
        drift(pin);
}
function drift(pin) {
    throw new ApnError("APN_OPERATION_BLOCKED", `Pinned ${pin.role} bytes, loader, or executable flag changed.`, { reason: "orca_program_pin_drift" });
}
function programAccountHash(programdata) {
    return sha256Hex(Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from(getAddressEncoder().encode(address(programdata)))]));
}
export function sha256Hex(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
//# sourceMappingURL=pins.js.map