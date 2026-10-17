import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { SOLANA_USDT } from "../../chain-policy.js";
import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { solanaAddress } from "../../solana/rpc.js";
import { associatedTokenAddress, whirlpoolOracleAddress, whirlpoolTickArrayAddress } from "../../swap/orca-solana/accounts.js";
import { tickArrayStart } from "../../swap/orca-solana/math.js";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, sha256Hex, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOL_SWAP_DISCRIMINATOR } from "../../swap/orca-solana/pins.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "./mechanism.js";
const U64_MAX = (1n << 64n) - 1n;
const MAX_COMPUTE_UNITS = 1_400_000;
const BASE_FEE_LAMPORTS = 5000n;
const PREVIEW_DIGEST_DOMAIN = "apn.orca-stable-untrusted-preview-manifest.v1";
export const ORCA_STABLE_PREVIEW_SCHEMA = "apn.orca-stable-unsigned-preview.v1";
/** Reparse untrusted preview material. Passing this check never authorizes signing or sending. */
export async function validateOrcaStableUnsigned(value) {
    if (value.schemaVersion !== ORCA_STABLE_PREVIEW_SCHEMA || value.trust !== "untrusted_offline_snapshot" ||
        value.signable !== false || value.executable !== false ||
        typeof value.createUsdtAta !== "boolean" || !Array.isArray(value.instructionPrograms))
        invalid("Stable preview schema is invalid.");
    [value.owner, value.sourceAta, value.destinationAta, value.blockhash].forEach(solanaAddress);
    uint(value.amountInAtomic, true);
    uint(value.minimumOutputAtomic, true);
    uint(value.marketSlot, true);
    uint(value.lastValidBlockHeight, true);
    const { manifestDigest, ...body } = value;
    if (manifestDigest !== domainHash(PREVIEW_DIGEST_DOMAIN, canonicalJson(body)))
        blocked("Stable preview manifest metadata changed.", "orca_stable_manifest_digest");
    const priority = (BigInt(value.computeUnitLimit) * BigInt(value.computeUnitPriceMicroLamports) + 999999n) / 1000000n;
    const rent = uint(value.ataRentLamports, false), total = BASE_FEE_LAMPORTS + priority + rent;
    if ((!value.createUsdtAta && rent !== 0n) || (value.createUsdtAta && rent === 0n) ||
        value.maximumPriorityFeeLamports !== priority.toString() ||
        uint(value.totalFeeAndRentLamports, true) !== total ||
        uint(value.totalFeeAndRentLamports, true) > uint(value.maximumTotalFeeLamports, true))
        blocked("Stable preview fee bound changed.", "orca_stable_fee_cap");
    if (!Number.isSafeInteger(value.computeUnitLimit) || value.computeUnitLimit < 1 || value.computeUnitLimit > MAX_COMPUTE_UNITS ||
        uint(value.computeUnitPriceMicroLamports, false) > U64_MAX || !Number.isSafeInteger(value.tickCurrentIndex) ||
        !Array.isArray(value.tickArrayStarts) || value.tickArrayStarts.length !== 3 ||
        value.tickArrayStarts.some((start, index) => start !== tickArrayStart(value.tickCurrentIndex, 1) - index * 88))
        invalid("Stable preview compute or tick bounds changed.");
    const [sourceAta, destinationAta, oracle] = await Promise.all([associatedTokenAddress(value.owner, USDC_MINT, TOKEN_PROGRAM),
        associatedTokenAddress(value.owner, SOLANA_USDT, TOKEN_PROGRAM), whirlpoolOracleAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL)]);
    const ticks = await Promise.all(value.tickArrayStarts.map((start) => whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, start)));
    if (value.sourceAta !== sourceAta || value.destinationAta !== destinationAta || value.oracle !== oracle)
        blocked("Stable preview derived account changed.", "orca_stable_ata_mismatch");
    if (BigInt(value.amountInAtomic) > U64_MAX || BigInt(value.minimumOutputAtomic) > U64_MAX)
        invalid("Stable preview amount exceeds u64.");
    const bytes = Buffer.from(value.messageBase64, "base64");
    if (bytes.toString("base64") !== value.messageBase64 || sha256Hex(bytes) !== value.messageHash ||
        typeof value.unsignedPayload !== "string" || Buffer.from(value.unsignedPayload, "base64").toString("base64") !== value.unsignedPayload)
        blocked("Stable preview bytes or hash changed.", "orca_stable_message_hash");
    const wire = getTransactionDecoder().decode(Buffer.from(value.unsignedPayload, "base64"));
    if (!Buffer.from(wire.messageBytes).equals(bytes) || Object.values(wire.signatures).length !== 1 ||
        Object.values(wire.signatures).some((signature) => signature !== null && Buffer.from(signature).some((byte) => byte !== 0)))
        blocked("Unsigned payload differs from the bound message.", "orca_stable_payload");
    const message = getCompiledTransactionMessageDecoder().decode(bytes);
    if (message.version !== 0 || (message.addressTableLookups ?? []).length !== 0 || message.lifetimeToken !== value.blockhash ||
        message.header.numSignerAccounts !== 1 || message.header.numReadonlySignerAccounts !== 0 || message.staticAccounts[0] !== value.owner)
        blocked("Stable preview signer or lifetime changed.", "orca_stable_message_shape");
    const keys = message.staticAccounts, writable = (i) => i < 1 || i < keys.length - message.header.numReadonlyNonSignerAccounts;
    const allowedWritable = new Set([value.owner, value.sourceAta, value.destinationAta, ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B]);
    // Tick arrays are the only additional writable keys; they appear exclusively in the swap instruction.
    const swapIndex = value.createUsdtAta ? 3 : 2, swapIx = message.instructions[swapIndex];
    if (swapIx === undefined || swapIx.accountIndices?.length !== 11 || keys[swapIx.programAddressIndex] !== WHIRLPOOL_PROGRAM)
        blocked("Stable swap account shape changed.", "orca_stable_message_shape");
    const swapKeys = swapIx.accountIndices.map((i) => keys[i]);
    if (swapKeys[0] !== TOKEN_PROGRAM || swapKeys[1] !== value.owner || swapKeys[2] !== ORCA_STABLE_POOL ||
        swapKeys[3] !== value.sourceAta || swapKeys[4] !== ORCA_STABLE_VAULT_A || swapKeys[5] !== value.destinationAta ||
        swapKeys[6] !== ORCA_STABLE_VAULT_B || swapKeys[7] !== ticks[0] || swapKeys[8] !== ticks[1] ||
        swapKeys[9] !== ticks[2] || swapKeys[10] !== oracle || new Set(swapKeys).size !== 11)
        blocked("Stable swap account identities changed.", "orca_stable_message_shape");
    for (const key of swapKeys.slice(7, 10))
        allowedWritable.add(key);
    const expectedKeys = new Set([value.owner, value.sourceAta, value.destinationAta, ORCA_STABLE_POOL,
        ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B, TOKEN_PROGRAM, WHIRLPOOL_PROGRAM, COMPUTE_BUDGET_PROGRAM,
        oracle, ...ticks, ...(value.createUsdtAta ? [ATA_PROGRAM, SYSTEM_PROGRAM, SOLANA_USDT] : [])]);
    if (new Set(keys).size !== keys.length || keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key)))
        blocked("Stable preview has an extra or missing account.", "orca_stable_message_shape");
    keys.forEach((key, i) => {
        if (writable(i) !== allowedWritable.has(key))
            blocked("Stable account writable role changed.", "orca_stable_message_writable");
    });
    const programs = message.instructions.map((ix) => keys[ix.programAddressIndex]);
    const expectedPrograms = value.createUsdtAta ? [COMPUTE_BUDGET_PROGRAM, COMPUTE_BUDGET_PROGRAM, ATA_PROGRAM, WHIRLPOOL_PROGRAM] :
        [COMPUTE_BUDGET_PROGRAM, COMPUTE_BUDGET_PROGRAM, WHIRLPOOL_PROGRAM];
    if (JSON.stringify(programs) !== JSON.stringify(expectedPrograms) || JSON.stringify(value.instructionPrograms) !== JSON.stringify(expectedPrograms) ||
        keys.some((key) => key === SYSTEM_PROGRAM) !== value.createUsdtAta || !keys.some((key) => key === TOKEN_PROGRAM))
        blocked("Stable preview instruction allowlist changed.", "orca_stable_message_program");
    const computeLimit = Buffer.from(message.instructions[0]?.data ?? new Uint8Array());
    const computePrice = Buffer.from(message.instructions[1]?.data ?? new Uint8Array());
    if (computeLimit.length !== 5 || computeLimit[0] !== 2 || computeLimit.readUInt32LE(1) !== value.computeUnitLimit ||
        computePrice.length !== 9 || computePrice[0] !== 3 ||
        computePrice.readBigUInt64LE(1).toString() !== value.computeUnitPriceMicroLamports ||
        (message.instructions[0]?.accountIndices?.length ?? 0) !== 0 ||
        (message.instructions[1]?.accountIndices?.length ?? 0) !== 0)
        blocked("Stable compute instructions changed.", "orca_stable_message_data");
    if (value.createUsdtAta) {
        const ataIx = message.instructions[2];
        const ataKeys = (ataIx.accountIndices ?? []).map((i) => keys[i]);
        if (Buffer.from(ataIx.data ?? new Uint8Array()).toString("hex") !== "01" ||
            JSON.stringify(ataKeys) !== JSON.stringify([value.owner, destinationAta, value.owner, SOLANA_USDT, SYSTEM_PROGRAM, TOKEN_PROGRAM]))
            blocked("Stable ATA creation instruction changed.", "orca_stable_message_data");
    }
    const data = Buffer.from(swapIx.data ?? new Uint8Array());
    if (data.length !== 42 || data.subarray(0, 8).toString("hex") !== WHIRLPOOL_SWAP_DISCRIMINATOR ||
        data.readBigUInt64LE(8).toString() !== value.amountInAtomic || data.readBigUInt64LE(16).toString() !== value.minimumOutputAtomic ||
        data.subarray(24, 40).some((byte) => byte !== 0) || data[40] !== 1 || data[41] !== 1)
        blocked("Stable swap data changed.", "orca_stable_message_data");
    return value;
}
function uint(value, positive) {
    if (typeof value !== "string" || !(positive ? /^[1-9][0-9]{0,19}$/u : /^(?:0|[1-9][0-9]{0,19})$/u).test(value))
        invalid("Stable preview integer is invalid.");
    return BigInt(value);
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=preview.js.map