import { getAddressDecoder } from "@solana/kit";
import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { associatedTokenAddress, decodeWhirlpool, decodeTickArray, whirlpoolTickArrayAddress, whirlpoolOracleAddress } from "../orca-solana/accounts.js";
import { assertJupiterV1FreshMaterial, validateJupiterV1Material } from "./v1-material.js";
import { JUPITER_V1_RUNTIME_PROGRAM_PINS, JUPITER_V1_POOL, JUPITER_V1_WHIRLPOOL_PROGRAM as ORCA } from "./v1-pins.js";
import { JUPITER_V6_PROGRAM as JUP, TOKEN_PROGRAM as TOKEN, ASSOCIATED_TOKEN_PROGRAM as ATA, SYSTEM_PROGRAM as SYS, COMPUTE_BUDGET_PROGRAM as COMPUTE, WRAPPED_SOL_MINT as SOL, SOLANA_USDC_MINT as USDC } from "./catalog.js";
export function reject(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
export function semanticAccount(material, key) { const row = material.semanticAccounts.find(a => a.address === key); return row ?? reject("Jupiter V1 semantic snapshot is incomplete."); }
function raw(a) { return a.existence === "absent" ? null : { owner: a.owner, lamports: BigInt(a.lamports), executable: a.executable, space: Buffer.from(a.dataBase64, "base64").length, data: Buffer.from(a.dataBase64, "base64") }; }
export function tokenState(a, mint, owner) { const d = Buffer.from(a.dataBase64, "base64"), key = (o) => getAddressDecoder().decode(d.subarray(o, o + 32)); if (a.existence !== "present" || a.owner !== TOKEN || a.executable || d.length !== 165 || key(0) !== mint || key(32) !== owner || d[108] !== 1 || d.readUInt32LE(72) !== 0 || d.readUInt32LE(129) !== 0 || d.readBigUInt64LE(121) !== 0n)
    reject("Jupiter V1 token owner, mint, delegate or close authority changed."); const flag = d.readUInt32LE(109); if (flag > 1 || (mint === SOL ? flag !== 1 : flag !== 0))
    reject("Jupiter V1 native token state changed."); return { amount: d.readBigUInt64LE(64), nativeRent: flag === 1 ? d.readBigUInt64LE(113) : null }; }
function metas(ix, expected, data) { if (ix.accounts.length !== expected.length || ix.accounts.some((a, i) => a.pubkey !== expected[i][0] || a.isSigner !== expected[i][1] || a.isWritable !== expected[i][2]) || (data !== undefined && Buffer.from(ix.data, "base64").toString("hex") !== data))
    reject("Jupiter V1 instruction roles or raw privileges changed."); }
export async function guardJupiterV1WhirlpoolMaterial(material, options = {}) { return await evaluate(material, options, true); }
export async function validateJupiterV1GuardedMaterial(guarded, requireFresh = true) { const checked = await evaluate(guarded.material, {}, requireFresh); if (canonicalJson(checked) !== canonicalJson(guarded))
    reject("Jupiter V1 guarded proof binding changed."); }
async function evaluate(material, options, requireFresh) {
    if (requireFresh)
        assertJupiterV1FreshMaterial(material);
    else {
        validateJupiterV1Material(material);
        if (material.networkFeeLamports === null)
            reject("Jupiter V1 frozen fee is absent.");
    }
    if (options.deadline !== undefined && (!Number.isFinite(Date.parse(options.deadline)) || (options.now ?? Date.now()) >= Date.parse(options.deadline)))
        reject("Jupiter V1 consent deadline expired.");
    const q = material.quoteResponse, b = material.rawBuildResponse, p = material.payer, pool = q.routePlan[0].swapInfo.ammKey;
    if (pool !== JUPITER_V1_POOL || q.inAmount !== "1000000" || BigInt(material.maximumNativeExpenseLamports) > 6000000n)
        reject("Jupiter V1 route or cap is outside the admitted lane.");
    const source = await associatedTokenAddress(p, SOL, TOKEN), destination = await associatedTokenAddress(p, USDC, TOKEN), ix = b.swapInstruction, d = Buffer.from(ix.data, "base64");
    if (d.length !== 36 || d.subarray(0, 8).toString("hex") !== "e517cb977ae3ad2a" || d.readUInt32LE(8) !== 1 || d[12] !== 17 || d[13] !== 1 || d[14] !== 100 || d[15] !== 0 || d[16] !== 1 || d.readBigUInt64LE(17).toString() !== q.inAmount || d.readBigUInt64LE(25).toString() !== q.outAmount || d.readUInt16LE(33) !== q.slippageBps)
        reject("Jupiter V1 canonical route arguments changed.");
    // The zero platform-fee byte is part of the complete canonical route encoding.
    rejectIfMissingFeeByte(ix, q.slippageBps);
    const state = decodeWhirlpool(pool, raw(semanticAccount(material, pool)), ORCA, "3f95d10ce1806309");
    if (state.mintA !== SOL || state.mintB !== USDC)
        reject("Jupiter V1 pool pair changed.");
    const r = ix.accounts;
    if (r.length !== 21)
        reject("Jupiter V1 remaining accounts changed.");
    const ticks = r.slice(17, 20).map(a => a.pubkey), oracle = await whirlpoolOracleAddress(ORCA, pool);
    const native = [TOKEN, p, pool, source, state.vaultA, destination, state.vaultB, ...ticks, oracle];
    const expected = [[TOKEN, false, false], [p, true, false], [source, false, true], [destination, false, true], [JUP, false, false], [USDC, false, false], [JUP, false, false], ["D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf", false, false], [JUP, false, false], [ORCA, false, false], ...native.map((a, i) => [a, false, i >= 2 && i <= 9])];
    metas(ix, expected);
    tokenState(semanticAccount(material, state.vaultA), SOL, pool);
    tokenState(semanticAccount(material, state.vaultB), USDC, pool);
    tokenState(semanticAccount(material, destination), USDC, p);
    for (const [i, key] of ticks.entries()) {
        const t = decodeTickArray(key, raw(semanticAccount(material, key)), ORCA, "4561bdbe6e0742bb");
        const width = state.tickSpacing * 88;
        if (t.whirlpool !== pool || t.startTickIndex % width !== 0 || key !== await whirlpoolTickArrayAddress(ORCA, pool, t.startTickIndex) || t.startTickIndex !== Math.floor(state.tickCurrentIndex / width) * width - i * width)
            reject("Jupiter V1 tick array seed or order changed.");
    }
    const o = semanticAccount(material, oracle);
    if (o.executable || (o.existence === "present" && (o.owner !== SYS || o.dataBase64 !== "")))
        reject("Jupiter V1 adaptive oracle state is unsupported.");
    const src = semanticAccount(material, source), initial = src.existence === "absent" ? 0n : tokenState(src, SOL, p).amount;
    if (initial !== 0n)
        reject("Jupiter V1 refuses to close existing WSOL funds.");
    if (b.setupInstructions.length !== 3 || b.cleanupInstruction === null)
        reject("Jupiter V1 wrap/close sequence changed.");
    const [create, transfer, sync] = b.setupInstructions;
    if (create.programId !== ATA || transfer.programId !== SYS || sync.programId !== TOKEN || b.cleanupInstruction.programId !== TOKEN)
        reject("Jupiter V1 setup program changed.");
    metas(create, [[p, true, true], [source, false, true], [p, false, false], [SOL, false, false], [SYS, false, false], [TOKEN, false, false]], "01");
    const funding = Buffer.alloc(12);
    funding.writeUInt32LE(2);
    funding.writeBigUInt64LE(BigInt(q.inAmount), 4);
    metas(transfer, [[p, true, true], [source, false, true]], funding.toString("hex"));
    metas(sync, [[source, false, true]], "11");
    metas(b.cleanupInstruction, [[source, false, true], [p, false, true], [p, true, false]], "09");
    if (b.computeBudgetInstructions.length !== 2)
        reject("Jupiter V1 compute budget changed.");
    const limit = b.computeBudgetInstructions[0], price = b.computeBudgetInstructions[1];
    if (limit.programId !== COMPUTE || price.programId !== COMPUTE)
        reject("Jupiter V1 compute program changed.");
    metas(limit, [], "02c05c1500");
    metas(price, [], "03e803000000000000");
    const fee = BigInt(material.networkFeeLamports), rent = BigInt(material.tokenAccountRentLamports), cap = BigInt(material.maximumNativeExpenseLamports);
    if (fee < 1400n || fee > 20000n || 1000000n + fee + (src.existence === "absent" ? rent : 0n) > cap || BigInt(semanticAccount(material, p).lamports) < 1000000n + fee + (src.existence === "absent" ? rent : 0n))
        reject("Jupiter V1 prospective expense or payer balance exceeds cap.");
    for (const pin of JUPITER_V1_RUNTIME_PROGRAM_PINS) {
        const a = semanticAccount(material, pin.programId), actual = material.programPins.find(x => x.programId === pin.programId), pd = semanticAccount(material, pin.programDataAddress);
        if (!a.executable || actual?.storedPayloadHash !== pin.payloadHash || actual.programDataAddress !== pin.programDataAddress || actual.provenance !== "runtime_bytes_only" || actual.accountHash !== a.dataHash || actual.programDataHash !== pd.dataHash || sha256(Buffer.from(pd.dataBase64, "base64").subarray(45)) !== pin.payloadHash || a.owner !== "BPFLoaderUpgradeab1e11111111111111111111111" || pd.owner !== a.owner || pd.executable || Buffer.from(pd.dataBase64, "base64").length < 45 || Buffer.from(pd.dataBase64, "base64").readUInt32LE(0) !== 3 || ![0, 1].includes(Buffer.from(pd.dataBase64, "base64")[12]) || actual.loader !== a.owner || actual.deploymentSlot !== Buffer.from(pd.dataBase64, "base64").readBigUInt64LE(4).toString() || actual.upgradeAuthority !== (Buffer.from(pd.dataBase64, "base64")[12] === 1 ? getAddressDecoder().decode(Buffer.from(pd.dataBase64, "base64").subarray(13, 45)) : null) || Buffer.from(a.dataBase64, "base64").length !== 36 || Buffer.from(a.dataBase64, "base64").readUInt32LE(0) !== 2 || getAddressDecoder().decode(Buffer.from(a.dataBase64, "base64").subarray(4)) !== pin.programDataAddress)
            reject("Jupiter V1 runtime pin changed.");
    }
    const fixed = [{ programId: ATA, hash: "6804554e69fd3a58caa191dc4a58f4c67223d30ca28ab8987f39fc18d2f7374d" }, { programId: COMPUTE, hash: "005950c007e8e550a16beddf836f0082d26d197f5f645ff7c04a5c8d171cf8a1" }, { programId: SYS, hash: "c94b792a6d8b25d3e53ea94d8b80111735ed80d6a7dc8deb937cd342707f5f03" }];
    for (const pin of fixed) {
        const a = semanticAccount(material, pin.programId);
        if (!a.executable || a.dataHash !== pin.hash || a.owner !== (pin.programId === ATA ? "BPFLoader2111111111111111111111111111111111" : "NativeLoader1111111111111111111111111111111"))
            reject("Jupiter V1 setup executable bytes changed.");
    }
    if (material.semanticAccounts.some(a => BigInt(a.slot) < BigInt(q.contextSlot)))
        reject("Jupiter V1 semantic snapshot predates quote.");
    const floor = BigInt(q.outAmount) * BigInt(10000 - q.slippageBps) / 10000n, rounding = BigInt(q.otherAmountThreshold) - floor;
    if (rounding < 0n || rounding > 1n)
        reject("Jupiter V1 quote minimum rounding exceeds admitted difference.");
    const body = { material, payer: p, sourceTokenAccount: source, destinationTokenAccount: destination, pool, nativeAccounts: native, inputAtomic: q.inAmount, quotedOutputAtomic: q.outAmount, instructionMinimumOutputAtomic: (BigInt(q.outAmount) * BigInt(10000 - q.slippageBps) / 10000n).toString(), quotedMinimumOutputAtomic: q.otherAmountThreshold, minimumRoundingDeltaAtomic: rounding.toString(), maximumNativeExpenseLamports: material.maximumNativeExpenseLamports };
    return Object.freeze({ ...body, admissionDigest: domainHash("apn.jupiter-v1-semantic-admission.v1", canonicalJson(body)) });
}
function rejectIfMissingFeeByte(ix, _slippage) { const d = Buffer.from(ix.data, "base64"); if (d.length !== 36 || d[35] !== 0)
    reject("Jupiter V1 platform fee byte is invalid."); }
//# sourceMappingURL=v1-guard.js.map