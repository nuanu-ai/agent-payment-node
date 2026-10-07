import { getBase58Encoder, getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";
import { canonicalJson, domainHash, isPlainRecord, sha256 } from "../../canonical.js";
import { createSwapQuote } from "../quote.js";
import { freezeJson } from "./v1-codec.js";
import { validateJupiterV1Material } from "./v1-material.js";
import { rawAccount } from "../orca-solana/accounts.js";
import { guardJupiterV1WhirlpoolMaterial, validateJupiterV1GuardedMaterial, reject, semanticAccount, tokenState } from "./v1-guard.js";
import { JUPITER_V6_PROGRAM as JUP, TOKEN_PROGRAM as TOKEN, SYSTEM_PROGRAM as SYS, ASSOCIATED_TOKEN_PROGRAM as ATA, SOLANA_USDC_MINT as USDC, WRAPPED_SOL_MINT as SOL, canonicalAddress } from "./catalog.js";
import { JUPITER_V1_WHIRLPOOL_PROGRAM as ORCA } from "./v1-pins.js";
const quoteProofBrand = Symbol("JupiterV1QuoteProof");
const quoteProofs = new WeakMap();
function quoteBinding(material, input) { if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()))
    reject("Jupiter V1 quote time is invalid."); return domainHash("apn.jupiter-v1-issued-quote-binding.v1", canonicalJson({ materialDigest: material.materialDigest, messageHash: material.messageHash, nativeCap: material.maximumNativeExpenseLamports, profile: input.profile, account: input.account, recipient: input.recipient, amountAtomic: input.amountAtomic, slippageBps: input.slippageBps, now: input.now.toISOString() })); }
export async function proveJupiterV1Quote(reader, material, input, expiresAt) {
    const binding = quoteBinding(material, input), deadline = expiresAt ?? new Date(input.now.getTime() + 90000).toISOString();
    if (input.account !== material.payer || input.recipient !== material.payer || input.amountAtomic !== material.quoteResponse.inAmount || input.slippageBps !== material.quoteResponse.slippageBps || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= input.now.getTime() || Date.parse(deadline) > input.now.getTime() + 90000)
        reject("Jupiter V1 quote input/expiry binding changed.");
    freezeJson(material);
    const guarded = await guardJupiterV1WhirlpoolMaterial(material, { now: input.now.getTime(), deadline }), proof = await proveJupiterV1Simulation(reader, guarded);
    const snapshot = freezeJson(createSwapQuote({ profile: input.profile, account: material.payer, recipient: material.payer, sourceAsset: { chain: `solana:${material.genesis}`, kind: "native", identifier: null }, destinationAsset: { chain: `solana:${material.genesis}`, kind: "token", identifier: USDC }, inputAmountAtomic: guarded.inputAtomic, expectedOutputAtomic: guarded.quotedOutputAtomic, minimumOutputAtomic: guarded.quotedMinimumOutputAtomic, slippageBps: material.quoteResponse.slippageBps, effectiveAt: input.now.toISOString(), expiresAt: deadline, providerResponseHash: material.materialDigest, routeHash: guarded.admissionDigest, unsignedTransactionPayloadHash: sha256(material.transactionBase64), simulation: { requestHash: proof.requestHash, resultHash: proof.resultHash, success: true, blockNumber: material.accountSlot, blockHash: `0x${Buffer.from(getBase58Encoder().encode(material.lifetime.blockhash)).toString("hex")}`, headBlockNumber: proof.slot, maxHeadDrift: 256, gasEstimate: proof.unitsConsumed } }));
    const issued = Object.freeze({ [quoteProofBrand]: true });
    quoteProofs.set(issued, { snapshot, binding });
    return issued;
}
export function snapshotFromJupiterV1QuoteProof(proof, material, input) { if (proof === null || typeof proof !== "object")
    reject("Jupiter V1 quote lacks producer-verified evidence."); validateJupiterV1Material(material); const issued = quoteProofs.get(proof); if (issued === undefined || issued.binding !== quoteBinding(material, input))
    reject("Jupiter V1 quote proof is forged, cloned or bound to another input."); return issued.snapshot; }
export async function proveJupiterV1Simulation(reader, guarded) {
    await revalidate(guarded);
    const m = guarded.material, keys = m.compiledAccounts.map(a => a.address);
    if (BigInt(m.accountSlot) > BigInt(Number.MAX_SAFE_INTEGER))
        reject("Jupiter V1 simulation context slot cannot be represented safely.");
    if (keys.length > 64)
        reject("Jupiter V1 simulation account request exceeds bounds.");
    const params = [m.transactionBase64, { encoding: "base64", commitment: "confirmed", sigVerify: false, replaceRecentBlockhash: false, minContextSlot: Number(m.accountSlot), innerInstructions: true, accounts: { encoding: "base64", addresses: keys } }];
    const response = strict(record(await reader.call("simulateTransaction", params)), ["context", "value"]), context = record(response.context), v = record(response.value);
    parseExtensions(context, v, keys.length);
    const slot = integer(context.slot);
    if (slot < BigInt(m.accountSlot) || v.err !== null || v.replacementBlockhash !== undefined && v.replacementBlockhash !== null)
        reject("Jupiter V1 simulation failed or changed blockhash.");
    const units = integer(v.unitsConsumed);
    if (units < 1n || units > 1400000n)
        reject("Jupiter V1 simulation compute evidence is invalid.");
    const wire = getTransactionDecoder().decode(Buffer.from(m.transactionBase64, "base64"));
    if (sha256(new Uint8Array(wire.messageBytes)) !== m.messageHash || Object.values(wire.signatures).some(s => s !== null && s.some(b => b !== 0)))
        reject("Jupiter V1 simulation wire is signed or changed.");
    const after = array(v.accounts, 64);
    if (after.length !== keys.length)
        reject("Jupiter V1 simulation post-state is incomplete.");
    const index = (key) => { const i = keys.indexOf(key); if (i < 0)
        reject("Jupiter V1 proof account is missing."); return i; };
    const state = (key) => { const value = after[index(key)]; if (value === null)
        reject("Jupiter V1 required post-account is absent."); const a = rawAccount(value, 1048576); return { address: key, existence: "present", owner: a.owner, executable: a.executable, lamports: a.lamports.toString(), dataBase64: a.data.toString("base64"), dataHash: sha256(a.data), slot: slot.toString() }; };
    const destBefore = tokenState(semanticAccount(m, guarded.destinationTokenAccount), USDC, guarded.payer).amount, destAfter = tokenState(state(guarded.destinationTokenAccount), USDC, guarded.payer).amount, output = destAfter - destBefore;
    const payerBefore = BigInt(semanticAccount(m, guarded.payer).lamports), payerAfter = BigInt(state(guarded.payer).lamports), nativeSpend = payerBefore - payerAfter;
    const closed = after[index(guarded.sourceTokenAccount)];
    if (closed !== null) {
        const c = rawAccount(closed, 165);
        if (c.lamports !== 0n || c.data.length !== 0 || c.owner !== SYS)
            reject("Jupiter V1 WSOL rent was not returned on close.");
    }
    const vaultA = guarded.nativeAccounts[4], vaultB = guarded.nativeAccounts[6];
    if (tokenState(state(vaultA), SOL, guarded.pool).amount - tokenState(semanticAccount(m, vaultA), SOL, guarded.pool).amount !== BigInt(guarded.inputAtomic) || tokenState(semanticAccount(m, vaultB), USDC, guarded.pool).amount - tokenState(state(vaultB), USDC, guarded.pool).amount !== output)
        reject("Jupiter V1 vault input/output effects disagree.");
    checkEffects(guarded, output, nativeSpend, BigInt(m.networkFeeLamports));
    bindCpi(v.innerInstructions, guarded, output);
    // Every owned or read-only account is checked against the frozen before snapshot. Pool/vault/tick state is the only permitted foreign mutation.
    const mutableData = new Set([guarded.pool, ...guarded.nativeAccounts.slice(7, 10)]), tokenData = new Set([guarded.destinationTokenAccount, guarded.nativeAccounts[4], guarded.nativeAccounts[6]]);
    for (const [i, key] of keys.entries()) {
        if (key === guarded.sourceTokenAccount)
            continue;
        const before = semanticAccount(m, key), value = after[i];
        if (value === null) {
            if (before.existence !== "absent")
                reject("Jupiter V1 simulation removed an unrelated account.");
            continue;
        }
        const a = rawAccount(value, 1048576), expectedLamports = BigInt(before.lamports) + (key === guarded.payer ? -nativeSpend : key === guarded.nativeAccounts[4] ? BigInt(guarded.inputAtomic) : 0n);
        if (before.owner !== a.owner || before.executable !== a.executable || expectedLamports !== a.lamports)
            reject("Jupiter V1 account identity or lamport effects changed.");
        const beforeData = Buffer.from(before.dataBase64, "base64");
        if (tokenData.has(key)) {
            const checked = Buffer.from(a.data);
            beforeData.subarray(64, 72).copy(checked, 64);
            if (!checked.equals(beforeData))
                reject("Jupiter V1 token data changed beyond its amount.");
        }
        else if (mutableData.has(key)) {
            if (a.data.length !== beforeData.length || !a.data.subarray(0, 8).equals(beforeData.subarray(0, 8)) || key !== guarded.pool && !a.data.subarray(9956).equals(beforeData.subarray(9956)))
                reject("Jupiter V1 pool/tick identity data changed.");
            if (key === guarded.pool)
                for (const [offset, length] of [[8, 41], [101, 64], [181, 64]])
                    if (!a.data.subarray(offset, offset + length).equals(beforeData.subarray(offset, offset + length)))
                        reject("Jupiter V1 pool static identity changed.");
        }
        else if (!a.data.equals(beforeData))
            reject("Jupiter V1 simulation mutated read-only account data.");
    }
    if (v.fee !== undefined && v.fee !== null && integer(v.fee) !== BigInt(m.networkFeeLamports))
        reject("Jupiter V1 simulation fee extension disagrees.");
    if (v.loadedAddresses !== undefined) {
        const loaded = record(v.loadedAddresses);
        if (canonicalJson(loaded.writable) !== canonicalJson(m.compiledAccounts.filter(a => a.source === "lookup" && a.writable).map(a => a.address)) || canonicalJson(loaded.readonly) !== canonicalJson(m.compiledAccounts.filter(a => a.source === "lookup" && !a.writable).map(a => a.address)))
            reject("Jupiter V1 simulation loaded addresses changed.");
    }
    if (v.preBalances !== undefined && v.postBalances !== undefined) {
        const pre = amountArray(v.preBalances, keys.length), post = amountArray(v.postBalances, keys.length);
        if (pre[index(guarded.payer)] - post[index(guarded.payer)] !== nativeSpend)
            reject("Jupiter V1 native balance evidence disagrees.");
    }
    return Object.freeze({ requestHash: domainHash("apn.jupiter-v1-simulation-request.v1", canonicalJson(params)), resultHash: jupiterV1RpcResponseHash("apn.jupiter-v1-simulation-result.v1", response), messageHash: m.messageHash, admissionDigest: guarded.admissionDigest, slot: slot.toString(), unitsConsumed: units.toString(), recipientOutputAtomic: output.toString(), nativeSpendLamports: nativeSpend.toString(), success: true });
}
export async function validateFinalizedJupiterV1Receipt(reader, g, expected) {
    // Receipt observation remains valid after blockhash expiry; integrity/semantics were frozen before signature.
    await validateJupiterV1GuardedMaterial(g, false);
    signature(expected.signature);
    const m = g.material, statusResponse = strict(record(await reader.call("getSignatureStatuses", [[expected.signature], { searchTransactionHistory: true }])), ["context", "value"]), ctx = record(statusResponse.context);
    contextExtensions(ctx);
    const statuses = array(statusResponse.value, 1);
    if (statuses.length !== 1 || statuses[0] === null)
        reject("Jupiter V1 signature status is unavailable.");
    const status = strict(record(statuses[0]), ["slot", "confirmations", "err", "confirmationStatus", "status"]), slot = integer(status.slot);
    if (status.status !== undefined)
        successfulStatus(status.status);
    if (status.err !== null || status.confirmationStatus !== "finalized" || status.confirmations !== null || integer(ctx.slot) < slot)
        reject("Jupiter V1 signature is not finalized successfully.");
    const response = strict(record(await reader.call("getTransaction", [expected.signature, { encoding: "base64", commitment: "finalized", maxSupportedTransactionVersion: 0 }])), ["slot", "version", "transaction", "meta", "blockTime"]), meta = record(response.meta), encoded = array(response.transaction, 2);
    receiptExtensions(response, meta);
    if (integer(response.slot) !== slot || integer(response.version) !== 0n || meta.err !== null || encoded.length !== 2 || encoded[1] !== "base64" || typeof encoded[0] !== "string")
        reject("Jupiter V1 finalized transaction shape changed.");
    const wire = getTransactionDecoder().decode(Buffer.from(encoded[0], "base64"));
    if (sha256(new Uint8Array(wire.messageBytes)) !== m.messageHash || Object.keys(wire.signatures).length !== 1 || Object.keys(wire.signatures)[0] !== g.payer || getSignatureFromTransaction(wire) !== expected.signature)
        reject("Jupiter V1 finalized signature or message changed.");
    const loaded = strict(record(meta.loadedAddresses), ["writable", "readonly"]), writable = m.compiledAccounts.filter(a => a.source === "lookup" && a.writable).map(a => a.address), readonly = m.compiledAccounts.filter(a => a.source === "lookup" && !a.writable).map(a => a.address);
    if (canonicalJson(loaded.writable) !== canonicalJson(writable) || canonicalJson(loaded.readonly) !== canonicalJson(readonly))
        reject("Jupiter V1 finalized loaded addresses changed.");
    const keys = m.compiledAccounts.map(a => a.address), pre = amountArray(meta.preBalances, keys.length), post = amountArray(meta.postBalances, keys.length), payer = keys.indexOf(g.payer), source = keys.indexOf(g.sourceTokenAccount), dest = keys.indexOf(g.destinationTokenAccount);
    if (payer !== 0 || source < 0 || dest < 0 || post[source] !== 0n)
        reject("Jupiter V1 finalized payer/WSOL closure changed.");
    const fee = integer(meta.fee), nativeSpend = pre[payer] - post[payer], output = tokenAmount(meta.postTokenBalances, dest, g.payer) - tokenAmount(meta.preTokenBalances, dest, g.payer);
    checkEffects(g, output, nativeSpend, fee);
    if (fee > 20000n || fee !== BigInt(m.networkFeeLamports) || pre[source] !== BigInt(semanticAccount(m, g.sourceTokenAccount).lamports))
        reject("Jupiter V1 finalized fee exceeds cap.");
    bindCpi(meta.innerInstructions, g, output);
    for (const [i, key] of keys.entries()) {
        const expectedDelta = key === g.payer ? -nativeSpend : key === g.sourceTokenAccount ? -pre[i] : key === g.nativeAccounts[4] ? BigInt(g.inputAtomic) : 0n;
        if (post[i] - pre[i] !== expectedDelta)
            reject("Jupiter V1 receipt has unexpected account lamport effects.");
    }
    validateAllTokens(meta.preTokenBalances, meta.postTokenBalances, keys, g);
    const tokenVault = (v, key, mint) => { const rows = tokenRows(v).filter(r => integer(r.accountIndex) === BigInt(keys.indexOf(key))); if (rows.length !== 1 || rows[0].mint !== mint || rows[0].owner !== g.pool)
        reject("Jupiter V1 receipt vault identity changed."); return BigInt(record(rows[0].uiTokenAmount).amount); };
    if (tokenVault(meta.postTokenBalances, g.nativeAccounts[4], SOL) - tokenVault(meta.preTokenBalances, g.nativeAccounts[4], SOL) !== BigInt(g.inputAtomic) || tokenVault(meta.preTokenBalances, g.nativeAccounts[6], USDC) - tokenVault(meta.postTokenBalances, g.nativeAccounts[6], USDC) !== output)
        reject("Jupiter V1 receipt vault effects changed.");
    const body = { signature: expected.signature, slot: slot.toString(), feeLamports: fee.toString(), nativeSpendLamports: nativeSpend.toString(), recipientOutputAtomic: output.toString(), messageHash: m.messageHash, admissionDigest: g.admissionDigest, responseHash: jupiterV1RpcResponseHash("apn.jupiter-v1-receipt-response.v1", response) };
    return Object.freeze({ signature: body.signature, slot: body.slot, feeLamports: body.feeLamports, nativeSpendLamports: body.nativeSpendLamports, recipientOutputAtomic: body.recipientOutputAtomic, receiptHash: domainHash("apn.jupiter-v1-finalized-receipt.v1", canonicalJson(body)) });
}
async function revalidate(g) { await validateJupiterV1GuardedMaterial(g); }
function checkEffects(g, output, spend, fee) { if (output < BigInt(g.quotedMinimumOutputAtomic) || output < BigInt(g.instructionMinimumOutputAtomic) || spend !== BigInt(g.inputAtomic) + fee - (semanticAccount(g.material, g.sourceTokenAccount).existence === "present" ? BigInt(semanticAccount(g.material, g.sourceTokenAccount).lamports) : 0n) || spend > BigInt(g.maximumNativeExpenseLamports))
    reject("Jupiter V1 output, input debit or rent refund proof failed."); }
function bindCpi(value, g, actualOutput) {
    const groups = array(value, 32), keys = g.material.compiledAccounts.map(a => a.address), swapIndex = g.material.rawBuildResponse.computeBudgetInstructions.length + g.material.rawBuildResponse.setupInstructions.length;
    let native = 0, input = 0, output = 0;
    const seen = new Set();
    for (const item of groups) {
        const group = strict(record(item), ["index", "instructions"]), index = Number(integer(group.index));
        if (index >= g.material.rawInstructions.length || seen.has(index))
            reject("Jupiter V1 CPI group index changed.");
        seen.add(index);
        for (const entry of array(group.instructions, 128)) {
            const ix = strict(record(entry), ["programIdIndex", "accounts", "data", "stackHeight"]), programIndex = Number(integer(ix.programIdIndex)), program = keys[programIndex];
            if (program === undefined || typeof ix.data !== "string")
                reject("Jupiter V1 CPI encoding changed.");
            const accountIndices = array(ix.accounts, 32).map(x => Number(integer(x)));
            if (accountIndices.some(x => x >= keys.length))
                reject("Jupiter V1 CPI account index changed.");
            const accounts = accountIndices.map(x => keys[x]);
            let bytes;
            try {
                bytes = new Uint8Array(getBase58Encoder().encode(ix.data));
            }
            catch {
                return reject("Jupiter V1 CPI data is invalid.");
            }
            const d = Buffer.from(bytes);
            if (ix.stackHeight !== undefined && ix.stackHeight !== null && (integer(ix.stackHeight) < 2n || integer(ix.stackHeight) > 8n))
                reject("Jupiter V1 CPI stack height is invalid.");
            if (program === ORCA) {
                if (integer(ix.stackHeight) !== 2n || index !== swapIndex || canonicalJson(accounts) !== canonicalJson(g.nativeAccounts) || d.length !== 42 || d.subarray(0, 8).toString("hex") !== "f8c69e91e17587c8" || d.readBigUInt64LE(8).toString() !== g.inputAtomic || d.subarray(16, 40).some(b => b !== 0) || d[40] !== 1 || d[41] !== 1)
                    reject("Jupiter V1 native Whirlpool CPI roles or input changed.");
                native++;
            }
            else if (program === TOKEN) {
                if (index !== swapIndex) {
                    if (g.material.rawInstructions[index]?.programId !== ATA)
                        reject("Jupiter V1 unexpected token CPI outside swap.");
                    if (!(d[0] === 21 && (d.length === 1 || d.length === 3 && d.readUInt16LE(1) === 7) && accounts.length === 1 && accounts[0] === SOL || d[0] === 22 && d.length === 1 && accounts.length === 1 && accounts[0] === g.sourceTokenAccount || d[0] === 18 && d.length === 33 && accounts.length === 2 && accounts[0] === g.sourceTokenAccount && accounts[1] === SOL && getBase58Encoder().encode(g.payer).every((b, i) => b === d[i + 1])))
                        reject("Jupiter V1 ATA token initialization CPI changed.");
                    continue;
                }
                if (integer(ix.stackHeight) !== 3n || d.length !== 9 || d[0] !== 3 || accounts.length !== 3)
                    reject("Jupiter V1 swap token CPI is unsupported.");
                const amount = d.readBigUInt64LE(1);
                if (accounts[0] === g.sourceTokenAccount && accounts[1] === g.nativeAccounts[4] && accounts[2] === g.payer && amount === BigInt(g.inputAtomic))
                    input++;
                else if (accounts[0] === g.nativeAccounts[6] && accounts[1] === g.destinationTokenAccount && accounts[2] === g.pool && amount === actualOutput)
                    output++;
                else
                    reject("Jupiter V1 unexpected token transfer CPI.");
            }
            else if (program === JUP) {
                if (integer(ix.stackHeight) !== 2n || index !== swapIndex || accounts.length !== 1 || accounts[0] !== "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf")
                    reject("Jupiter V1 unexpected Jupiter CPI.");
            }
            else if (program === SYS) {
                if (g.material.rawInstructions[index]?.programId !== ATA || canonicalJson(accounts) !== canonicalJson([g.payer, g.sourceTokenAccount]) || d.length !== 52 || d.readUInt32LE(0) !== 0 || d.readBigUInt64LE(4) !== BigInt(g.material.tokenAccountRentLamports) || d.readBigUInt64LE(12) !== 165n || !getBase58Encoder().encode(TOKEN).every((b, i) => b === d[i + 20]))
                    reject("Jupiter V1 system CPI outside exact own ATA creation.");
            }
            else
                reject("Jupiter V1 CPI program is outside whitelist.");
        }
    }
    if (native !== 1 || input !== 1 || output !== 1)
        reject("Jupiter V1 exact Whirlpool/input/output CPI proof is missing.");
}
function parseExtensions(context, v, count) { strict(v, ["err", "logs", "unitsConsumed", "accounts", "returnData", "innerInstructions", "loadedAccountsDataSize", "replacementBlockhash", "fee", "preBalances", "postBalances", "preTokenBalances", "postTokenBalances", "loadedAddresses"]); contextExtensions(context); if (v.logs !== null) {
    for (const x of array(v.logs, 512))
        if (typeof x !== "string" || x.length > 4096)
            reject("Jupiter V1 simulation log is invalid.");
} if (v.loadedAccountsDataSize !== undefined)
    integer(v.loadedAccountsDataSize); if (v.fee !== undefined && v.fee !== null)
    integer(v.fee); if (v.preBalances !== undefined)
    amountArray(v.preBalances, count); if (v.postBalances !== undefined)
    amountArray(v.postBalances, count); if (v.preTokenBalances !== undefined)
    tokenRows(v.preTokenBalances); if (v.postTokenBalances !== undefined)
    tokenRows(v.postTokenBalances); if (v.loadedAddresses !== undefined) {
    const a = strict(record(v.loadedAddresses), ["writable", "readonly"]);
    for (const list of [a.writable, a.readonly])
        for (const x of array(list, 64))
            if (typeof x !== "string")
                reject("Jupiter V1 loaded address extension is invalid.");
            else
                canonicalAddress(x);
} if (v.returnData !== undefined && v.returnData !== null) {
    const r = strict(record(v.returnData), ["programId", "data"]), d = array(r.data, 2);
    if (typeof r.programId !== "string" || d.length !== 2 || typeof d[0] !== "string" || d[1] !== "base64" || Buffer.from(d[0], "base64").toString("base64") !== d[0] || d[0].length > 16384)
        reject("Jupiter V1 return data extension is invalid.");
} }
function contextExtensions(c) { strict(c, ["slot", "apiVersion"]); integer(c.slot); if (c.apiVersion !== undefined && (typeof c.apiVersion !== "string" || c.apiVersion.length > 64))
    reject("Jupiter V1 API version extension is invalid."); }
function tokenRows(value) { return array(value, 64).map(x => { const r = strict(record(x), ["accountIndex", "mint", "owner", "programId", "uiTokenAmount"]), ui = strict(record(r.uiTokenAmount), ["amount", "decimals", "uiAmount", "uiAmountString"]); integer(r.accountIndex); if (typeof r.mint !== "string" || typeof r.owner !== "string" || typeof ui.amount !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(ui.amount) || integer(ui.decimals) > 255n)
    reject("Jupiter V1 token balance is invalid."); canonicalAddress(r.mint); canonicalAddress(r.owner); if (r.programId !== undefined) {
    if (typeof r.programId !== "string")
        reject("Jupiter V1 token program extension is invalid.");
    canonicalAddress(r.programId);
} if (ui.uiAmount !== undefined && ui.uiAmount !== null && (typeof ui.uiAmount === "bigint" ? ui.uiAmount < 0n || ui.uiAmount > BigInt(Number.MAX_SAFE_INTEGER) : typeof ui.uiAmount !== "number" || !Number.isFinite(ui.uiAmount) || ui.uiAmount < 0 || ui.uiAmount > Number.MAX_SAFE_INTEGER))
    reject("Jupiter V1 token UI amount extension is invalid."); if (ui.uiAmountString !== undefined && (typeof ui.uiAmountString !== "string" || ui.uiAmountString.length > 100))
    reject("Jupiter V1 token UI string extension is invalid."); return r; }); }
function tokenAmount(value, index, owner) { const rows = tokenRows(value).filter(r => integer(r.accountIndex) === BigInt(index)); if (rows.length !== 1 || rows[0].owner !== owner || rows[0].mint !== USDC || integer(record(rows[0].uiTokenAmount).decimals) !== 6n)
    reject("Jupiter V1 recipient token identity changed."); return BigInt(record(rows[0].uiTokenAmount).amount); }
function validateAllTokens(before, after, keys, g) { const pre = tokenRows(before), post = tokenRows(after), allowed = new Set([g.sourceTokenAccount, g.destinationTokenAccount, g.nativeAccounts[4], g.nativeAccounts[6]]); for (const row of pre) {
    const i = Number(integer(row.accountIndex)), key = keys[i];
    if (key === undefined)
        reject("Jupiter V1 token account index is invalid.");
    if (allowed.has(key))
        continue;
    const other = post.find(r => integer(r.accountIndex) === BigInt(i));
    if (other === undefined || canonicalJson(other) !== canonicalJson(row))
        reject("Jupiter V1 receipt changed another token account.");
} for (const row of post) {
    const i = Number(integer(row.accountIndex));
    if (keys[i] === undefined || !allowed.has(keys[i]) && !pre.some(r => integer(r.accountIndex) === BigInt(i)))
        reject("Jupiter V1 receipt introduced another token account.");
} }
function amountArray(v, n) { const a = array(v, 64); if (a.length !== n)
    reject("Jupiter V1 balance vector changed."); return a.map(integer); }
function integer(v) { if (typeof v === "bigint" && v >= 0n && v <= 18446744073709551615n)
    return v; if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0)
    return BigInt(v); return reject("Jupiter V1 RPC integer is invalid."); }
function array(v, n) { if (!Array.isArray(v) || v.length > n)
    reject("Jupiter V1 RPC array is invalid."); return v; }
function record(v) { return isPlainRecord(v) ? v : reject("Jupiter V1 RPC record is invalid."); }
function signature(v) { if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(v))
    reject("Jupiter V1 signature encoding is invalid."); }
function strict(r, allowed) { if (Object.keys(r).some(key => !allowed.includes(key)))
    reject("Jupiter V1 RPC contains an unknown unvalidated field."); return r; }
function successfulStatus(v) { const r = strict(record(v), ["Ok"]); if (Object.keys(r).length !== 1 || r.Ok !== null)
    reject("Jupiter V1 legacy status extension is not successful."); }
function receiptExtensions(response, meta) { strict(meta, ["err", "fee", "preBalances", "postBalances", "innerInstructions", "preTokenBalances", "postTokenBalances", "loadedAddresses", "logMessages", "rewards", "status", "computeUnitsConsumed", "costUnits", "returnData"]); if (response.blockTime !== undefined && response.blockTime !== null)
    integer(response.blockTime); if (meta.status !== undefined)
    successfulStatus(meta.status); for (const k of ["computeUnitsConsumed", "costUnits"])
    if (meta[k] !== undefined)
        integer(meta[k]); if (meta.logMessages !== undefined && meta.logMessages !== null)
    for (const line of array(meta.logMessages, 512))
        if (typeof line !== "string" || line.length > 4096)
            reject("Jupiter V1 receipt log extension is invalid."); if (meta.rewards !== undefined && meta.rewards !== null)
    for (const item of array(meta.rewards, 64)) {
        const r = strict(record(item), ["pubkey", "lamports", "postBalance", "rewardType", "commission"]);
        if (typeof r.pubkey !== "string" || !["fee", "rent", "staking", "voting", null].includes(r.rewardType) || !(typeof r.lamports === "number" && Number.isSafeInteger(r.lamports) || typeof r.lamports === "bigint" && r.lamports >= -18446744073709551615n && r.lamports <= 18446744073709551615n))
            reject("Jupiter V1 reward extension is invalid.");
        canonicalAddress(r.pubkey);
        integer(r.postBalance);
        if (r.commission !== null && r.commission !== undefined && integer(r.commission) > 100n)
            reject("Jupiter V1 reward commission is invalid.");
    } if (meta.returnData !== undefined && meta.returnData !== null) {
    const r = strict(record(meta.returnData), ["programId", "data"]), d = array(r.data, 2);
    if (typeof r.programId !== "string" || d.length !== 2 || typeof d[0] !== "string" || d[1] !== "base64" || d[0].length > 16384 || Buffer.from(d[0], "base64").toString("base64") !== d[0])
        reject("Jupiter V1 receipt return data is invalid.");
    canonicalAddress(r.programId);
} }
/** SolanaRpc preserves JSON integer lexemes as bigint. Integers retain decimal identity without Number conversion. */
export function canonicalJupiterV1RpcJson(value) { return canonicalJson(normalizeRpc(value)); }
export function jupiterV1RpcResponseHash(domain, value) { return domainHash(domain, canonicalJupiterV1RpcJson(value)); }
function normalizeRpc(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "bigint") {
        if (value < -18446744073709551615n || value > 18446744073709551615n)
            reject("Jupiter V1 RPC integer digest exceeds supported range.");
        return { $apnRpcInteger: value.toString() };
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
            reject("Jupiter V1 RPC numeric digest is unsafe.");
        return Number.isInteger(value) ? { $apnRpcInteger: BigInt(value).toString() } : { $apnRpcDecimal: value };
    }
    if (Array.isArray(value))
        return value.map(normalizeRpc);
    if (isPlainRecord(value)) {
        const out = {};
        for (const key of Object.keys(value)) {
            if (value[key] === undefined)
                reject("Jupiter V1 RPC digest contains undefined data.");
            out[key] = normalizeRpc(value[key]);
        }
        return out;
    }
    return reject("Jupiter V1 RPC digest contains an unsupported type.");
}
//# sourceMappingURL=v1-proof.js.map