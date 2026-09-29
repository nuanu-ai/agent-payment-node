import { getBase58Decoder, getBase58Encoder, getCompiledTransactionMessageDecoder } from "@solana/kit";
import { SOLANA_USDT } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import { rpcArray, rpcRecord } from "../../solana/rpc.js";
import { ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, WHIRLPOOL_PROGRAM } from "./pins.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "./stable-readonly.js";
/**
 * Prove the same-result classic Tokenkeg Transfer CPIs. Orca's pinned legacy swap uses
 * anchor_spl::token::transfer (Orca a119d79b, util/token.rs); it has no mint CPI accounts.
 * A missing or unfamiliar trace fails closed.
 * The standalone transaction message has no address lookup tables, so partially decoded CPI account indices
 * resolve against its exact static account table. Parsed CPIs must bind the same exact accounts and values.
 * A missing destination permits only the
 * classic Tokenkeg ATA creation sequence from the pinned associated-token program.
 */
export function proveOrcaStableSimulationTransfers(innerValue, preview, owner, amountInAtomic, minimumOutputAtomic) {
    const message = getCompiledTransactionMessageDecoder().decode(Buffer.from(preview.messageBase64, "base64"));
    if (message.version !== 0 || (message.addressTableLookups ?? []).length !== 0)
        invalid();
    const keys = message.staticAccounts, outer = message.instructions;
    const swapIndex = outer.length - 1;
    if (swapIndex !== (preview.createUsdtAta ? 3 : 2) || keys[outer[swapIndex].programAddressIndex] !== WHIRLPOOL_PROGRAM ||
        (preview.createUsdtAta && keys[outer[2].programAddressIndex] !== ATA_PROGRAM) ||
        outer.some((ix) => keys[ix.programAddressIndex] === TOKEN_PROGRAM))
        invalid();
    if (innerValue === null || innerValue === undefined)
        blocked("Simulation omitted the inner-instruction trace.", "orca_stable_trace_missing");
    const groups = rpcArray(innerValue, 8);
    if (groups.length !== (preview.createUsdtAta ? 2 : 1))
        invalid();
    if (preview.createUsdtAta)
        proveAtaCreation(rpcRecord(groups[0]), keys, preview, owner);
    const group = rpcRecord(groups[preview.createUsdtAta ? 1 : 0]);
    if (groupIndex(group) !== swapIndex)
        invalid();
    const instructions = rpcArray(group.instructions, 32);
    if (instructions.length !== 2)
        invalid();
    const expected = [
        { accounts: [preview.sourceAta, ORCA_STABLE_VAULT_A, owner], amount: BigInt(amountInAtomic) },
        { accounts: [ORCA_STABLE_VAULT_B, preview.destinationAta, ORCA_STABLE_POOL], amount: null },
    ];
    let output = 0n;
    for (const [index, value] of instructions.entries()) {
        const instruction = rpcRecord(value), program = programAddress(instruction, keys);
        if (program !== TOKEN_PROGRAM)
            invalid();
        if ("parsed" in instruction) {
            const info = parsedInfo(instruction, "spl-token", "transfer", ["source", "destination", "amount", "authority"]);
            const want = expected[index];
            if (info.source !== want.accounts[0] || info.destination !== want.accounts[1] ||
                info.authority !== want.accounts[2])
                invalid();
            const amount = decimalU64(info.amount);
            if (index === 0 && amount !== expected[0].amount)
                invalid();
            if (index === 1)
                output = amount;
            continue;
        }
        const accounts = accountAddresses(instruction, keys);
        if (JSON.stringify(accounts) !== JSON.stringify(expected[index].accounts))
            invalid();
        const data = instruction.data;
        if (typeof data !== "string" || data.length > 64)
            invalid();
        let bytes;
        try {
            bytes = Buffer.from(getBase58Encoder().encode(data));
            if (getBase58Decoder().decode(bytes) !== data)
                invalid();
        }
        catch {
            return invalid();
        }
        if (bytes.length !== 9 || bytes[0] !== 3)
            invalid();
        const amount = Buffer.from(bytes).readBigUInt64LE(1);
        if (index === 0 && amount !== expected[0].amount)
            invalid();
        if (index === 1)
            output = amount;
    }
    if (output < BigInt(minimumOutputAtomic))
        blocked("Simulation output transfer is below the owner minimum.", "orca_stable_simulation_delta");
    return { sourceDebitedAtomic: amountInAtomic, destinationCreditedAtomic: output.toString(),
        swapOuterInstructionIndex: swapIndex, tokenTransferCount: 2 };
}
function proveAtaCreation(group, keys, preview, owner) {
    if (groupIndex(group) !== 2 || keys[0] !== owner || !preview.createUsdtAta)
        invalid();
    const instructions = rpcArray(group.instructions, 8);
    if (instructions.length !== 4)
        invalid();
    const expected = [
        { program: TOKEN_PROGRAM, accounts: [SOLANA_USDT], data: Buffer.from([21, 7, 0]) },
        { program: SYSTEM_PROGRAM, accounts: [owner, preview.destinationAta], data: createAccountData(preview.ataRentLamports) },
        { program: TOKEN_PROGRAM, accounts: [preview.destinationAta], data: Buffer.from([22]) },
        { program: TOKEN_PROGRAM, accounts: [preview.destinationAta, SOLANA_USDT],
            data: Buffer.concat([Buffer.from([18]), Buffer.from(getBase58Encoder().encode(owner))]) },
    ];
    for (const [index, value] of instructions.entries()) {
        const instruction = rpcRecord(value), want = expected[index];
        if ("parsed" in instruction) {
            if (programAddress(instruction, keys) !== want.program)
                invalid();
            switch (index) {
                case 0: {
                    const info = parsedInfo(instruction, "spl-token", "getAccountDataSize", ["mint", "extensionTypes"]);
                    if (info.mint !== SOLANA_USDT || !Array.isArray(info.extensionTypes) ||
                        info.extensionTypes.length !== 1 || info.extensionTypes[0] !== "immutableOwner")
                        invalid();
                    break;
                }
                case 1: {
                    const info = parsedInfo(instruction, "system", "createAccount", ["source", "newAccount", "lamports", "space", "owner"]);
                    if (info.source !== owner || info.newAccount !== preview.destinationAta ||
                        parsedNumberU64(info.lamports) !== BigInt(preview.ataRentLamports) ||
                        parsedNumberU64(info.space) !== 165n || info.owner !== TOKEN_PROGRAM)
                        invalid();
                    break;
                }
                case 2: {
                    const info = parsedInfo(instruction, "spl-token", "initializeImmutableOwner", ["account"]);
                    if (info.account !== preview.destinationAta)
                        invalid();
                    break;
                }
                case 3: {
                    const info = parsedInfo(instruction, "spl-token", "initializeAccount3", ["account", "mint", "owner"]);
                    if (info.account !== preview.destinationAta || info.mint !== SOLANA_USDT || info.owner !== owner)
                        invalid();
                    break;
                }
            }
            continue;
        }
        if (programAddress(instruction, keys) !== want.program ||
            JSON.stringify(accountAddresses(instruction, keys)) !== JSON.stringify(want.accounts))
            invalid();
        const data = instruction.data;
        if (typeof data !== "string" || data.length > 128)
            invalid();
        let bytes;
        try {
            bytes = Buffer.from(getBase58Encoder().encode(data));
            if (getBase58Decoder().decode(bytes) !== data)
                invalid();
        }
        catch {
            return invalid();
        }
        if (!bytes.equals(want.data))
            invalid();
    }
}
function groupIndex(group) {
    const index = group.index;
    if ((typeof index !== "number" && typeof index !== "bigint") ||
        !Number.isSafeInteger(Number(index)) || Number(index) < 0)
        invalid();
    return Number(index);
}
function parsedInfo(instruction, program, type, keys) {
    if (instruction.program !== program || instruction.programId !== (program === "system" ? SYSTEM_PROGRAM : TOKEN_PROGRAM) ||
        Object.keys(instruction).some((key) => !["program", "programId", "parsed", "stackHeight"].includes(key)) ||
        ("stackHeight" in instruction && instruction.stackHeight !== null &&
            (typeof instruction.stackHeight !== "number" && typeof instruction.stackHeight !== "bigint")))
        invalid();
    const parsed = rpcRecord(instruction.parsed);
    if (parsed.type !== type || Object.keys(parsed).length !== 2 || !("info" in parsed))
        invalid();
    const info = rpcRecord(parsed.info);
    if (Object.keys(info).length !== keys.length || keys.some((key) => !(key in info)))
        invalid();
    return info;
}
function decimalU64(value) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value))
        invalid();
    const amount = BigInt(value);
    if (amount > (1n << 64n) - 1n)
        invalid();
    return amount;
}
function parsedNumberU64(value) {
    if (typeof value !== "bigint" && (typeof value !== "number" || !Number.isSafeInteger(value)))
        invalid();
    const amount = BigInt(value);
    if (amount < 0n || amount > (1n << 64n) - 1n)
        invalid();
    return amount;
}
function createAccountData(rent) {
    if (BigInt(rent) > (1n << 64n) - 1n)
        invalid();
    const data = Buffer.alloc(52);
    data.writeBigUInt64LE(BigInt(rent), 4);
    data.writeBigUInt64LE(165n, 12);
    Buffer.from(getBase58Encoder().encode(TOKEN_PROGRAM)).copy(data, 20);
    return data;
}
function programAddress(instruction, keys) {
    if (typeof instruction.programId === "string")
        return instruction.programId;
    return keys[accountIndex(instruction.programIdIndex, keys.length)];
}
function accountAddresses(instruction, keys) {
    const accounts = rpcArray(instruction.accounts, 32);
    return accounts.map((account) => {
        if (typeof account === "string")
            return account;
        return keys[accountIndex(account, keys.length)];
    });
}
function accountIndex(value, length) {
    if (typeof value === "bigint") {
        if (value < 0n || value >= BigInt(length))
            invalid();
        return Number(value);
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length)
        invalid();
    return value;
}
function invalid() { return blocked("Simulation contains an unexpected or malformed CPI transfer.", "orca_stable_trace_invalid"); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=stable-effects.js.map