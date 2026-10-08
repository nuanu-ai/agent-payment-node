import { AccountRole, address, appendTransactionMessageInstructions, blockhash, compileTransaction, compressTransactionMessageUsingAddressLookupTables, createNoopSigner, createTransactionMessage, getAddressDecoder, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash } from "@solana/kit";
import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { assertSolanaNetwork, rpcRecord, rpcAtomic, solanaReadBatch } from "../../solana/rpc.js";
import { rawAccount } from "../orca-solana/accounts.js";
import { ADDRESS_LOOKUP_TABLE_PROGRAM, SOLANA_MAINNET_GENESIS, canonicalAddress, invalid } from "./catalog.js";
import { jupiterV1Instructions, jupiterV1Lifetime, jupiterV1ResponseHash, decodeJupiterV1Build, decodeJupiterV1Quote, freezeJson } from "./v1-codec.js";
import { JUPITER_V1_MATERIAL_SCHEMA, jupiterV1MaterialDigest, checkedJupiterV1QuoteRpcLifetime } from "./v1-material.js";
import { routeConfigForQuoteBuild, jupiterV1RegisteredProgramPins } from "./v1-route-config.js";
import { assertWhirlpoolV2Memo, validateWhirlpoolV2AccountSnapshot } from "./v1-whirlpool-v2-accounts.js";
import { refreshJupiterV1QuoteBuild } from "./v1-quote-refresh.js";
const UPGRADEABLE = "BPFLoaderUpgradeab1e11111111111111111111111";
// Base64 occupies 2,000,000 bytes, leaving room for metadata under the 2 MiB RPC body cap.
const PROGRAM_DATA_CHUNK_BYTES = 1_500_000;
export class JupiterV1MaterialResolver {
    rpc;
    constructor(rpc) {
        this.rpc = rpc;
    }
    async refreshQuoteBuild(material, build, useRpcLifetime = false) {
        return await refreshJupiterV1QuoteBuild(this.rpc, material, build, useRpcLifetime);
    }
    async resolve(payer, quote, build, maximumNativeExpenseLamports = "6000000", frozenRpcLifetime, expectedRouteId) {
        canonicalAddress(payer);
        decodeJupiterV1Quote(quote);
        decodeJupiterV1Build(build);
        const route = routeConfigForQuoteBuild(quote, build, expectedRouteId), registeredPins = jupiterV1RegisteredProgramPins(route);
        await assertSolanaNetwork(this.rpc);
        const instructions = jupiterV1Instructions(build), keys = [...new Set([payer, ...instructions.flatMap(ix => [ix.programId, ...ix.accounts.map(a => a.pubkey)]), ...build.addressLookupTableAddresses])];
        const accounts = await this.read(keys, quote.contextSlot), map = new Map(accounts.map(a => [a.address, a]));
        if (route.variant === 47)
            await validateWhirlpoolV2AccountSnapshot(payer, build, accounts);
        const tables = build.addressLookupTableAddresses.map(key => decodeJupiterV1AddressTable(map.get(key)));
        const programPins = [];
        const programIds = [...new Set(instructions.map(ix => ix.programId).concat(registeredPins.map(p => p.programId), route.requiredExtraPrograms))];
        for (const programId of programIds) {
            const program = map.get(programId);
            if (program === undefined || program.existence !== "present" || !program.executable)
                invalid("Jupiter V1 executable program is missing.");
            const bytes = Buffer.from(program.dataBase64, "base64");
            if (program.owner === UPGRADEABLE) {
                if (bytes.length !== 36 || bytes.readUInt32LE(0) !== 2)
                    invalid("Jupiter V1 upgradeable Program metadata is invalid.");
                const pointer = getAddressDecoder().decode(bytes.subarray(4, 36)), pin = registeredPins.find(p => p.programId === programId);
                if (pin === undefined || pointer !== pin.programDataAddress)
                    invalid("Jupiter V1 ProgramData pointer is unpinned.");
                const pd = await this.readProgramData(pointer, quote.contextSlot), data = Buffer.from(pd.dataBase64, "base64");
                if (pd.owner !== UPGRADEABLE || pd.executable || data.length < 45 || data.readUInt32LE(0) !== 3 || ![0, 1].includes(data[12]))
                    invalid("Jupiter V1 ProgramData metadata is invalid.");
                const payloadHash = sha256(data.subarray(45));
                if (payloadHash !== pin.payloadHash || pin.programDataHash !== undefined && pd.dataHash !== pin.programDataHash)
                    throw new ApnError("APN_OPERATION_BLOCKED", "Jupiter V1 runtime executable pin changed.");
                accounts.push(pd);
                programPins.push({ programId, loader: program.owner, programDataAddress: pointer, deploymentSlot: data.readBigUInt64LE(4).toString(), upgradeAuthority: data[12] === 1 ? getAddressDecoder().decode(data.subarray(13, 45)) : null, accountHash: program.dataHash, programDataHash: pd.dataHash, storedPayloadHash: payloadHash, provenance: "runtime_bytes_only" });
            }
            else {
                if (route.requiredExtraPrograms.includes(programId))
                    assertWhirlpoolV2Memo(program);
                programPins.push({ programId, loader: program.owner, programDataAddress: null, deploymentSlot: null, upgradeAuthority: null, accountHash: program.dataHash, programDataHash: null, storedPayloadHash: program.dataHash, provenance: "runtime_bytes_only" });
            }
        }
        const rpcLifetime = frozenRpcLifetime === undefined ? undefined : checkedJupiterV1QuoteRpcLifetime(frozenRpcLifetime);
        const compiled = assembleJupiterV1(payer, build, tables, rpcLifetime);
        const [feeValue, heightValue, rentValue] = await boundedPublicReads(this.rpc, [
            { method: "getFeeForMessage", params: [compiled.messageBase64, { commitment: "confirmed" }] },
            { method: "getBlockHeight", params: [{ commitment: "confirmed" }] },
            { method: "getMinimumBalanceForRentExemption", params: [165, { commitment: "confirmed" }] }
        ]);
        const feeResponse = rpcRecord(feeValue);
        const fee = feeResponse.value === null ? null : rpcAtomic(feeResponse.value).toString(), height = rpcAtomic(heightValue).toString(), rent = rpcAtomic(rentValue).toString();
        if (!/^[1-9][0-9]{0,19}$/u.test(maximumNativeExpenseLamports))
            invalid("Jupiter V1 native cap is invalid.");
        const body = { schemaVersion: JUPITER_V1_MATERIAL_SCHEMA, genesis: SOLANA_MAINNET_GENESIS, payer, quoteResponse: quote, rawBuildResponse: build, quoteResponseHash: jupiterV1ResponseHash(quote), rawBuildResponseHash: jupiterV1ResponseHash(build), lifetime: rpcLifetime === undefined ? jupiterV1Lifetime(build) : { blockhash: rpcLifetime.blockhash, lastValidBlockHeight: rpcLifetime.lastValidBlockHeight }, ...(rpcLifetime === undefined ? {} : { quoteRpcLifetime: rpcLifetime }), ...compiled, rawInstructions: instructions, semanticAccounts: accounts, addressTables: tables, programPins, accountSlot: accounts[0].slot, currentBlockHeight: height, networkFeeLamports: fee, tokenAccountRentLamports: rent, maximumNativeExpenseLamports };
        return freezeJson({ ...body, materialDigest: jupiterV1MaterialDigest(body) });
    }
    async read(keys, minContextSlot, slice) {
        const result = [], batches = [];
        const readLimit = this.rpc.maximumAccountsPerRead ?? 16;
        if (readLimit !== 8 && readLimit !== 16)
            invalid("Jupiter V1 account read limit is invalid.");
        for (let offset = 0; offset < keys.length; offset += readLimit)
            batches.push(keys.slice(offset, offset + readLimit));
        const responses = await boundedPublicReads(this.rpc, batches.map(batch => ({ method: "getMultipleAccounts", params: [batch, { encoding: "base64", commitment: "confirmed", minContextSlot, ...(slice === undefined ? {} : { dataSlice: slice }) }] })));
        for (const [index, batch] of batches.entries()) {
            const response = rpcRecord(responses[index]), slot = rpcAtomic(rpcRecord(response.context).slot).toString();
            if (BigInt(slot) < BigInt(minContextSlot) || !Array.isArray(response.value) || response.value.length !== batch.length)
                invalid("Jupiter V1 account snapshot is incomplete.");
            response.value.forEach((v, i) => {
                const key = batch[i];
                if (v === null) {
                    result.push({ address: key, existence: "absent", owner: null, executable: false, lamports: "0", dataBase64: "", dataHash: sha256(Buffer.alloc(0)), slot });
                    return;
                }
                const a = rawAccount(v, slice === undefined ? 1048576 : Math.min(slice.length, PROGRAM_DATA_CHUNK_BYTES), slice);
                result.push({ address: key, existence: "present", owner: a.owner, executable: a.executable, lamports: a.lamports.toString(), dataBase64: a.data.toString("base64"), dataHash: sha256(a.data), slot });
            });
        }
        return result;
    }
    async readProgramData(key, minContextSlot) {
        // The first full chunk carries the same loader header and declared account space.
        // It is also retained in the payload; no separate header-only POST is needed.
        const { raw: first, account: initial } = await this.readProgramDataChunk(key, minContextSlot, 0, PROGRAM_DATA_CHUNK_BYTES);
        if (first.space > 16777216 || first.space < 45)
            invalid("Jupiter V1 ProgramData size exceeds limit.");
        const chunks = [first.data];
        let last = initial;
        for (let offset = PROGRAM_DATA_CHUNK_BYTES; offset < first.space; offset += PROGRAM_DATA_CHUNK_BYTES) {
            const { raw, account } = await this.readProgramDataChunk(key, minContextSlot, offset, Math.min(PROGRAM_DATA_CHUNK_BYTES, first.space - offset));
            last = account;
            if (raw.space !== first.space || last.owner !== first.owner || last.executable !== first.executable || last.lamports !== first.lamports.toString() || last.existence !== "present")
                invalid("Jupiter V1 ProgramData changed during read.");
            chunks.push(Buffer.from(last.dataBase64, "base64"));
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== first.space || !bytes.subarray(0, 45).equals(first.data.subarray(0, 45)))
            invalid("Jupiter V1 ProgramData header or length changed during read.");
        return { ...last, dataBase64: bytes.toString("base64"), dataHash: sha256(bytes) };
    }
    async readProgramDataChunk(key, minContextSlot, offset, length) {
        const response = rpcRecord(await this.rpc.call("getAccountInfo", [key, { encoding: "base64", commitment: "confirmed", minContextSlot,
                dataSlice: { offset, length } }]));
        const slot = rpcAtomic(rpcRecord(response.context).slot).toString();
        if (response.value === null || BigInt(slot) < BigInt(minContextSlot))
            invalid("Jupiter V1 ProgramData is missing or stale.");
        const raw = rawAccount(response.value, PROGRAM_DATA_CHUNK_BYTES, { offset, length });
        const account = { address: key, existence: "present", owner: raw.owner, executable: raw.executable,
            lamports: raw.lamports.toString(), dataBase64: raw.data.toString("base64"), dataHash: sha256(raw.data), slot };
        return { raw, account };
    }
}
async function boundedPublicReads(rpc, reads) {
    if (reads.length < 1 || reads.length > 8)
        invalid("Jupiter V1 public read batch exceeds its finite bound.");
    const results = reads.length === 1 ? [await rpc.call(reads[0].method, reads[0].params)] : await solanaReadBatch(rpc, reads);
    if (!Array.isArray(results) || results.length !== reads.length)
        invalid("Jupiter V1 public read batch is incomplete.");
    return results;
}
export function decodeJupiterV1AddressTable(account) {
    const bytes = Buffer.from(account.dataBase64, "base64");
    if (account.existence !== "present" || account.owner !== ADDRESS_LOOKUP_TABLE_PROGRAM || account.executable || bytes.length < 56 || (bytes.length - 56) % 32 !== 0 || bytes.readUInt32LE(0) !== 1 || bytes.readBigUInt64LE(4) !== (1n << 64n) - 1n)
        invalid("Jupiter V1 ALT is not active canonical state.");
    const addresses = [];
    for (let offset = 56; offset < bytes.length; offset += 32)
        addresses.push(getAddressDecoder().decode(bytes.subarray(offset, offset + 32)));
    if (addresses.length > 256)
        invalid("Jupiter V1 ALT exceeds address capacity.");
    return { account, addresses, deactivationSlot: bytes.readBigUInt64LE(4).toString(), lastExtendedSlot: bytes.readBigUInt64LE(12).toString() };
}
export function assembleJupiterV1(payer, build, tables, frozenRpcLifetime) {
    const raw = jupiterV1Instructions(build), rpcLifetime = frozenRpcLifetime === undefined ? undefined : checkedJupiterV1QuoteRpcLifetime(frozenRpcLifetime), life = rpcLifetime === undefined ? jupiterV1Lifetime(build) : { blockhash: rpcLifetime.blockhash, lastValidBlockHeight: rpcLifetime.lastValidBlockHeight }, instructions = raw.map(ix => ({ programAddress: address(ix.programId), accounts: ix.accounts.map(meta => ({ address: address(meta.pubkey), role: meta.isSigner ? (meta.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER) : (meta.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY) })), data: Buffer.from(ix.data, "base64") }));
    let message = appendTransactionMessageInstructions(instructions, setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(life.blockhash), lastValidBlockHeight: BigInt(life.lastValidBlockHeight) }, setTransactionMessageFeePayerSigner(createNoopSigner(address(payer)), createTransactionMessage({ version: 0 }))));
    const tableMap = {};
    for (const table of tables)
        tableMap[address(table.account.address)] = table.addresses.map(address);
    message = compressTransactionMessageUsingAddressLookupTables(message, tableMap);
    const transaction = compileTransaction(message), wire = getBase64EncodedWireTransaction(transaction), bytes = Buffer.from(transaction.messageBytes);
    if (Buffer.from(wire, "base64").length > 1232 || Object.keys(transaction.signatures).length !== 1 || Object.keys(transaction.signatures)[0] !== payer || Object.values(transaction.signatures).some(s => s !== null))
        invalid("Jupiter V1 assembly has an unexpected signer or size.");
    const decoded = getCompiledTransactionMessageDecoder().decode(bytes);
    if (decoded.version !== 0)
        invalid("Jupiter V1 assembly is not v0.");
    const writable = [], readonly = [];
    const bindings = [];
    for (const lookup of decoded.addressTableLookups ?? []) {
        const table = tables.find(t => t.account.address === lookup.lookupTableAddress);
        if (table === undefined)
            invalid("Jupiter V1 missing ALT.");
        const resolve = (indices) => indices.map(i => {
            const key = table.addresses[i];
            if (key === undefined)
                invalid("Jupiter V1 ALT index is out of range.");
            return key;
        });
        writable.push(...resolve(lookup.writableIndexes));
        readonly.push(...resolve(lookup.readonlyIndexes));
        bindings.push({ address: table.account.address, dataHash: table.account.dataHash, writableIndexes: [...lookup.writableIndexes], readonlyIndexes: [...lookup.readonlyIndexes] });
    }
    const keys = [...decoded.staticAccounts.map(String), ...writable, ...readonly];
    if (new Set(keys).size !== keys.length)
        invalid("Jupiter V1 compiled account identity is duplicated.");
    const compiledAccounts = keys.map((key, i) => ({ address: key, signer: i < decoded.header.numSignerAccounts, writable: i < decoded.staticAccounts.length ? (i < decoded.header.numSignerAccounts ? i < decoded.header.numSignerAccounts - decoded.header.numReadonlySignerAccounts : i < decoded.staticAccounts.length - decoded.header.numReadonlyNonSignerAccounts) : i < decoded.staticAccounts.length + writable.length, source: i < decoded.staticAccounts.length ? "static" : "lookup" }));
    const union = new Map();
    union.set(payer, { signer: true, writable: true });
    for (const ix of raw) {
        if (!union.has(ix.programId))
            union.set(ix.programId, { signer: false, writable: false });
        for (const meta of ix.accounts) {
            const old = union.get(meta.pubkey) ?? { signer: false, writable: false };
            union.set(meta.pubkey, { signer: old.signer || meta.isSigner, writable: old.writable || meta.isWritable });
        }
    }
    if (compiledAccounts.length !== union.size || compiledAccounts.some(a => a.signer !== union.get(a.address)?.signer || a.writable !== union.get(a.address)?.writable))
        invalid("Jupiter V1 compiled privilege union differs from raw instructions.");
    return { transactionBase64: wire, transactionHash: sha256(Buffer.from(wire, "base64")), messageBase64: bytes.toString("base64"), messageHash: sha256(bytes), compiledAccounts, lookupBindingDigest: domainHash("apn.jupiter-v1-alt-binding.v1", canonicalJson(bindings)) };
}
//# sourceMappingURL=v1-resolver.js.map