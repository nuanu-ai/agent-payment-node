import { AccountRole, address, appendTransactionMessageInstructions, blockhash, compileTransaction, createNoopSigner, createTransactionMessage, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder, getTransactionDecoder, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash } from "@solana/kit";
import { getTokenDecoder, getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token";
import { SOLANA_USDT } from "../../chain-policy.js";
import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { solanaAddress } from "../../solana/rpc.js";
import { associatedTokenAddress, decodeTickArray, decodeWhirlpool, whirlpoolOracleAddress, whirlpoolTickArrayAddress } from "./accounts.js";
import { quoteWhirlpoolExactInAToB, tickArrayStart } from "./math.js";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, ORCA_SOLANA_CHAIN, sha256Hex, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOL_SWAP_DISCRIMINATOR, WHIRLPOOL_ACCOUNT_DISCRIMINATOR, TICK_ARRAY_ACCOUNT_DISCRIMINATOR, WHIRLPOOLS_CONFIG } from "./pins.js";
import { ORCA_STABLE_POOL, ORCA_STABLE_VAULT_A, ORCA_STABLE_VAULT_B } from "./stable-readonly.js";
const U64_MAX = (1n << 64n) - 1n;
const MAX_COMPUTE_UNITS = 1_400_000;
const BASE_FEE_LAMPORTS = 5000n;
const PREVIEW_DIGEST_DOMAIN = "apn.orca-stable-untrusted-preview-manifest.v1";
export const ORCA_STABLE_PREVIEW_SCHEMA = "apn.orca-stable-unsigned-preview.v1";
/** Offline, unsigned preview only. It deliberately exposes no signer or send path. */
export async function prepareOrcaStableUnsigned(input) {
    validateBase(input);
    const sourceAta = await associatedTokenAddress(input.owner, USDC_MINT, TOKEN_PROGRAM);
    const destinationAta = await associatedTokenAddress(input.owner, SOLANA_USDT, TOKEN_PROGRAM);
    if (input.snapshot.usdcAtaAddress !== sourceAta || input.snapshot.usdtAtaAddress !== destinationAta)
        blocked("Owner ATA derivation differs from the snapshot.", "orca_stable_ata_mismatch");
    tokenAccount(input.snapshot.usdcAta, input.owner, USDC_MINT, "source");
    if (BigInt(input.snapshot.usdcAta.data.readBigUInt64LE(64)) < BigInt(input.quote.amountInAtomic))
        blocked("Owner USDC balance is below the input.", "orca_stable_balance");
    if (input.snapshot.usdtAta !== null)
        tokenAccount(input.snapshot.usdtAta, input.owner, SOLANA_USDT, "destination");
    if (input.snapshot.usdtAta === null && !input.createUsdtAta)
        blocked("USDT ATA is absent and creation was not explicitly requested.", "orca_stable_destination_absent");
    if (input.createUsdtAta && input.snapshot.usdtAta !== null)
        blocked("USDT ATA already exists.", "orca_stable_destination_present");
    let rent = 0n;
    if (input.createUsdtAta) {
        rent = uint(input.usdtAtaRentLamports, true);
        if (rent > uint(input.maximumAtaRentLamports, true))
            blocked("USDT ATA rent exceeds the explicit cap.", "orca_stable_rent_cap");
    }
    else if (input.usdtAtaRentLamports !== undefined || input.maximumAtaRentLamports !== undefined)
        invalid("ATA rent inputs require explicit ATA creation.");
    const priority = (BigInt(input.computeUnitLimit) * BigInt(input.computeUnitPriceMicroLamports) + 999999n) / 1000000n;
    const total = BASE_FEE_LAMPORTS + priority + rent;
    const feeCap = uint(input.maximumTotalFeeLamports, true);
    if (total > U64_MAX || total > feeCap || input.snapshot.owner.lamports < total)
        blocked("Priority fee, base fee, and rent exceed the total cap or owner SOL balance.", "orca_stable_fee_cap");
    const oracle = await whirlpoolOracleAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL);
    const tickArrays = await Promise.all(input.quote.tickArrayStarts.map((start) => whirlpoolTickArrayAddress(WHIRLPOOL_PROGRAM, ORCA_STABLE_POOL, start)));
    validateMarketSnapshot(input, tickArrays);
    const owner = createNoopSigner(address(input.owner));
    const limit = Buffer.alloc(5);
    limit[0] = 2;
    limit.writeUInt32LE(input.computeUnitLimit, 1);
    const price = Buffer.alloc(9);
    price[0] = 3;
    price.writeBigUInt64LE(BigInt(input.computeUnitPriceMicroLamports), 1);
    const swap = Buffer.alloc(42);
    Buffer.from(WHIRLPOOL_SWAP_DISCRIMINATOR, "hex").copy(swap);
    swap.writeBigUInt64LE(BigInt(input.quote.amountInAtomic), 8);
    swap.writeBigUInt64LE(BigInt(input.quote.minimumOutputAtomic), 16);
    swap[40] = 1;
    swap[41] = 1; // exact input, A to B; sqrt price limit 0 delegates to program min bound.
    const writable = (key) => ({ address: address(key), role: AccountRole.WRITABLE });
    const instructions = [
        { programAddress: address(COMPUTE_BUDGET_PROGRAM), accounts: [], data: new Uint8Array(limit) },
        { programAddress: address(COMPUTE_BUDGET_PROGRAM), accounts: [], data: new Uint8Array(price) },
    ];
    if (input.createUsdtAta)
        instructions.push(getCreateAssociatedTokenIdempotentInstruction({ payer: owner,
            ata: address(destinationAta), owner: address(input.owner), mint: address(SOLANA_USDT) }));
    instructions.push({ programAddress: address(WHIRLPOOL_PROGRAM), data: new Uint8Array(swap), accounts: [
            { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
            { address: address(input.owner), role: AccountRole.READONLY_SIGNER },
            writable(ORCA_STABLE_POOL), writable(sourceAta), writable(ORCA_STABLE_VAULT_A), writable(destinationAta),
            writable(ORCA_STABLE_VAULT_B), writable(tickArrays[0]), writable(tickArrays[1]), writable(tickArrays[2]),
            { address: address(oracle), role: AccountRole.READONLY },
        ] });
    const message = appendTransactionMessageInstructions(instructions, setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(input.lifetime.blockhash), lastValidBlockHeight: BigInt(input.lifetime.lastValidBlockHeight) }, setTransactionMessageFeePayerSigner(owner, createTransactionMessage({ version: 0 }))));
    const transaction = compileTransaction(message), bytes = new Uint8Array(transaction.messageBytes);
    const body = { schemaVersion: ORCA_STABLE_PREVIEW_SCHEMA, trust: "untrusted_offline_snapshot",
        signable: false, executable: false,
        owner: input.owner, sourceAta, destinationAta, amountInAtomic: input.quote.amountInAtomic,
        minimumOutputAtomic: input.quote.minimumOutputAtomic, marketSlot: input.quote.slot, blockhash: input.lifetime.blockhash,
        lastValidBlockHeight: input.lifetime.lastValidBlockHeight, messageBase64: Buffer.from(bytes).toString("base64"),
        messageHash: sha256Hex(bytes), unsignedPayload: getBase64EncodedWireTransaction(transaction),
        createUsdtAta: input.createUsdtAta, instructionPrograms: instructions.map((instruction) => instruction.programAddress),
        tickArrayStarts: [...input.quote.tickArrayStarts], tickCurrentIndex: input.quote.tickCurrentIndex, oracle,
        computeUnitLimit: input.computeUnitLimit, computeUnitPriceMicroLamports: input.computeUnitPriceMicroLamports,
        maximumPriorityFeeLamports: priority.toString(), ataRentLamports: rent.toString(),
        totalFeeAndRentLamports: total.toString(),
        maximumTotalFeeLamports: input.maximumTotalFeeLamports };
    const preview = { ...body, manifestDigest: domainHash(PREVIEW_DIGEST_DOMAIN, canonicalJson(body)) };
    await validateOrcaStableUnsigned(preview);
    return preview;
}
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
function validateBase(input) {
    solanaAddress(input.owner);
    solanaAddress(input.lifetime.blockhash);
    const q = input.quote, s = input.snapshot;
    if (q.chain !== ORCA_SOLANA_CHAIN || q.pool !== ORCA_STABLE_POOL || q.program !== WHIRLPOOL_PROGRAM ||
        q.sourceMint !== USDC_MINT || q.destinationMint !== SOLANA_USDT || q.vaultA !== ORCA_STABLE_VAULT_A ||
        q.vaultB !== ORCA_STABLE_VAULT_B || q.direction !== "USDC_to_USDT_exact_input" || q.signed !== false || q.broadcast !== false ||
        q.slot !== s.slot)
        blocked("Stable quote or snapshot identity differs from pins.", "orca_stable_pin_drift");
    const amount = uint(q.amountInAtomic, true), expected = uint(q.expectedOutputAtomic, true), minimum = uint(q.minimumOutputAtomic, true);
    if (amount > U64_MAX || expected > U64_MAX || minimum > expected || minimum === 0n ||
        !Number.isSafeInteger(q.tickCurrentIndex) || !Array.isArray(q.tickArrayStarts) || q.tickArrayStarts.length !== 3 ||
        q.tickArrayStarts.some((start, index) => start !== tickArrayStart(q.tickCurrentIndex, 1) - index * 88) ||
        !Number.isSafeInteger(q.slippageBps) || q.slippageBps < 0 || q.slippageBps >= 10_000)
        invalid("Stable quote amount or tick arrays are invalid.");
    if (!Number.isSafeInteger(input.computeUnitLimit) || input.computeUnitLimit < 1 || input.computeUnitLimit > MAX_COMPUTE_UNITS ||
        uint(input.computeUnitPriceMicroLamports, false) > U64_MAX)
        invalid("Stable compute cap is invalid.");
    const current = uint(input.lifetime.currentBlockHeight, true), expiry = uint(input.lifetime.lastValidBlockHeight, true);
    if (current >= expiry || expiry - current > 150n)
        blocked("Stable preview blockhash lifetime is expired or implausible.", "orca_stable_lifetime");
    if (s.owner.owner !== SYSTEM_PROGRAM || s.owner.executable || s.owner.data.length !== 0)
        blocked("Owner system account is invalid.", "orca_stable_owner");
}
function validateMarketSnapshot(input, tickAddresses) {
    const s = input.snapshot, q = input.quote;
    const pool = decodeWhirlpool(ORCA_STABLE_POOL, s.pool, WHIRLPOOL_PROGRAM, WHIRLPOOL_ACCOUNT_DISCRIMINATOR);
    if (pool.config !== WHIRLPOOLS_CONFIG || pool.mintA !== USDC_MINT || pool.mintB !== SOLANA_USDT ||
        pool.vaultA !== ORCA_STABLE_VAULT_A || pool.vaultB !== ORCA_STABLE_VAULT_B || pool.tickSpacing !== 1 ||
        pool.feeTierIndexSeed !== 1 || pool.feeRate !== 100 || pool.tickCurrentIndex !== q.tickCurrentIndex ||
        s.oracle !== null || s.tickArrays.length !== 3)
        blocked("Caller supplied stable pool state differs from pins.", "orca_stable_pool_state");
    const arrays = s.tickArrays.map((account, i) => decodeTickArray(tickAddresses[i], account, WHIRLPOOL_PROGRAM, TICK_ARRAY_ACCOUNT_DISCRIMINATOR));
    if (arrays.some((array, i) => array.startTickIndex !== q.tickArrayStarts[i] || array.whirlpool !== ORCA_STABLE_POOL))
        blocked("Caller supplied stable tick arrays differ from derived addresses.", "orca_stable_tick_state");
    for (const [account, mint] of [[s.vaultA, USDC_MINT], [s.vaultB, SOLANA_USDT]]) {
        if (account.owner !== TOKEN_PROGRAM || account.executable || account.data.length !== 165)
            blocked("Caller supplied stable vault is not a classic token account.", "orca_stable_vault_state");
        const token = getTokenDecoder().decode(account.data);
        if (token.mint !== mint || token.owner !== ORCA_STABLE_POOL || token.state !== 1 ||
            token.delegate.__option !== "None" || token.isNative.__option !== "None")
            blocked("Caller supplied stable vault identity differs from pool.", "orca_stable_vault_state");
    }
    const swap = quoteWhirlpoolExactInAToB(pool, arrays, BigInt(q.amountInAtomic));
    const expected = BigInt(swap.amountOutAtomic);
    const minimum = (expected * BigInt(10_000 - q.slippageBps) + 9999n) / 10000n;
    if (swap.amountOutAtomic !== q.expectedOutputAtomic || minimum.toString() !== q.minimumOutputAtomic ||
        expected > getTokenDecoder().decode(s.vaultB.data).amount)
        blocked("Stable quote does not reproduce from supplied pool state.", "orca_stable_quote_state");
}
function tokenAccount(account, owner, mint, role) {
    if (account === null || account.owner !== TOKEN_PROGRAM || account.executable || account.data.length !== 165)
        blocked(`Owner ${role} ATA is not a classic token account.`, "orca_stable_ata_state");
    const token = getTokenDecoder().decode(account.data);
    if (token.owner !== owner || token.mint !== mint || token.state !== 1 || token.isNative.__option !== "None" ||
        token.delegate.__option !== "None" || token.closeAuthority.__option !== "None")
        blocked(`Owner ${role} ATA is not solely controlled by owner.`, "orca_stable_ata_state");
}
function uint(value, positive) {
    if (typeof value !== "string" || !(positive ? /^[1-9][0-9]{0,19}$/u : /^(?:0|[1-9][0-9]{0,19})$/u).test(value))
        invalid("Stable preview integer is invalid.");
    return BigInt(value);
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=stable-prepare.js.map