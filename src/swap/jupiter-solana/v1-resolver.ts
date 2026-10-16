import { AccountRole, address, appendTransactionMessageInstructions, blockhash, compileTransaction, compressTransactionMessageUsingAddressLookupTables, createNoopSigner, createTransactionMessage, getAddressDecoder, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, type Instruction, type Address } from "@solana/kit";
import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { assertSolanaNetwork, rpcRecord, rpcAtomic, solanaReadBatch, type SolanaRpcPort, type SolanaBatchRead } from "../../solana/rpc.js";
import { rawAccount } from "../orca-solana/accounts.js";
import { ADDRESS_LOOKUP_TABLE_PROGRAM, SOLANA_MAINNET_GENESIS, canonicalAddress, invalid } from "./catalog.js";
import { jupiterV1Instructions, jupiterV1Lifetime, jupiterV1ResponseHash, decodeJupiterV1Build, decodeJupiterV1Quote, freezeJson, type JupiterV1QuoteResponse, type JupiterV1RawBuildResponse } from "./v1-codec.js";
import { JUPITER_V1_MATERIAL_SCHEMA, jupiterV1MaterialDigest, type JupiterV1SemanticAccount, type JupiterV1AddressTable, type JupiterV1RuntimeProgramPin, type JupiterV1ResolvedMaterial, type JupiterV1CompiledAccount, assertJupiterV1RpcOrigin, checkedJupiterV1QuoteRpcLifetime, type JupiterV1QuoteRpcLifetime } from "./v1-material.js";
import { routeConfigForQuoteBuild, jupiterV1RouteProgramAuthorities, type JupiterV1RouteId } from "./v1-route-config.js";
import { validateWhirlpoolV2AccountSnapshot } from "./v1-whirlpool-v2-accounts.js";
import { PROGRAM_HEADER_SLICE, programAuthorityReadKeys, verifyProgramAuthorities } from "../solana-program-authority.js";
import { assertJupiterV1RpcLifetimeWindow, readJupiterV1QuoteRpcLifetime } from "./v1-rpc-lifetime.js";
export class JupiterV1MaterialResolver {
    constructor(private readonly rpc: SolanaRpcPort) { }
    /**
     * A new quote passes `freezeRpcLifetime`: the configured RPC supplies the blockhash after the account reads, and the one
     * fee/height/rent read prices that exact message. A saved quote passes its `frozenRpcLifetime` and must rebuild the same bytes.
     */
    async resolve(payer: string, quote: JupiterV1QuoteResponse, build: JupiterV1RawBuildResponse, maximumNativeExpenseLamports: string, frozenRpcLifetime?: JupiterV1QuoteRpcLifetime, expectedRouteId?: JupiterV1RouteId, freezeRpcLifetime = false): Promise<JupiterV1ResolvedMaterial> {
        canonicalAddress(payer);
        decodeJupiterV1Quote(quote);
        decodeJupiterV1Build(build);
        // Only the current route set resolves; a historical generation is observe-only. The owner admits the pool's route.
        const route = routeConfigForQuoteBuild(quote, build, expectedRouteId);
        if (route.programAuthorities === undefined)
            throw new ApnError("APN_OPERATION_BLOCKED", "This Jupiter route generation pinned executable bytes and is observe-only; quote again.", { reason: "jupiter_v1_historical_route" });
        const authorities = jupiterV1RouteProgramAuthorities(route);
        assertJupiterV1RpcOrigin(this.rpc.originHash, frozenRpcLifetime);
        await assertSolanaNetwork(this.rpc);
        const instructions = jupiterV1Instructions(build), programs = [...new Set([...instructions.map(ix => ix.programId), ...authorities.map(pin => pin.programId)])];
        if (programs.some(program => !authorities.some(pin => pin.programId === program)))
            invalid("Jupiter V1 instruction program is not pinned.");
        // Programs are read as 45-byte prefixes (a Program account, a ProgramData header, an immutable loader's ELF head).
        const headerKeys = programAuthorityReadKeys(authorities), keys = [...new Set([payer, ...instructions.flatMap(ix => ix.accounts.map(a => a.pubkey)), ...build.addressLookupTableAddresses])].filter(key => !headerKeys.includes(key));
        const accounts = [...await this.read(keys, quote.contextSlot), ...await this.read(headerKeys, quote.contextSlot, PROGRAM_HEADER_SLICE)], map = new Map(accounts.map(a => [a.address, a]));
        if (route.variant === 47) await validateWhirlpoolV2AccountSnapshot(payer, build, accounts);
        const tables = build.addressLookupTableAddresses.map(key => decodeJupiterV1AddressTable(map.get(key)!));
        const view = (address: string) => { const row = map.get(address); return row === undefined || row.existence === "absent" ? null : { owner: row.owner!, executable: row.executable, data: Buffer.from(row.dataBase64, "base64") }; };
        const programPins: JupiterV1RuntimeProgramPin[] = verifyProgramAuthorities(authorities, view).map(o => ({ programId: o.programId, loader: o.loader,
            programDataAddress: o.programDataAddress, deploymentSlot: o.deploymentSlot, upgradeAuthority: o.upgradeAuthority, accountHash: o.accountSha256,
            programDataHeaderHash: o.programDataHeaderSha256, provenance: "upgrade_authority" as const }));
        const freezing = frozenRpcLifetime === undefined && freezeRpcLifetime;
        const rpcLifetime = frozenRpcLifetime !== undefined ? checkedJupiterV1QuoteRpcLifetime(frozenRpcLifetime) : freezing ? await readJupiterV1QuoteRpcLifetime(this.rpc, accounts) : undefined;
        const compiled = assembleJupiterV1(payer, build, tables, rpcLifetime);
        const [feeValue, heightValue, rentValue] = await boundedPublicReads(this.rpc, [
            { method: "getFeeForMessage", params: [compiled.messageBase64, { commitment: "confirmed" }] },
            { method: "getBlockHeight", params: [{ commitment: "confirmed" }] },
            { method: "getMinimumBalanceForRentExemption", params: [165, { commitment: "confirmed" }] }
        ]);
        const feeResponse = rpcRecord(feeValue);
        const fee = feeResponse.value === null ? null : rpcAtomic(feeResponse.value).toString(), height = rpcAtomic(heightValue).toString(), rent = rpcAtomic(rentValue).toString();
        if (freezing) assertJupiterV1RpcLifetimeWindow(rpcLifetime!, height);
        if (!/^[1-9][0-9]{0,19}$/u.test(maximumNativeExpenseLamports))
            invalid("Jupiter V1 native cap is invalid.");
        const body = { schemaVersion: JUPITER_V1_MATERIAL_SCHEMA, genesis: SOLANA_MAINNET_GENESIS, payer, quoteResponse: quote, rawBuildResponse: build, quoteResponseHash: jupiterV1ResponseHash(quote), rawBuildResponseHash: jupiterV1ResponseHash(build), lifetime: rpcLifetime === undefined ? jupiterV1Lifetime(build) : { blockhash: rpcLifetime.blockhash, lastValidBlockHeight: rpcLifetime.lastValidBlockHeight }, ...(rpcLifetime === undefined ? {} : { quoteRpcLifetime: rpcLifetime }), ...compiled, rawInstructions: instructions, semanticAccounts: accounts, addressTables: tables, programPins, accountSlot: accounts[0]!.slot, currentBlockHeight: height, networkFeeLamports: fee, tokenAccountRentLamports: rent, maximumNativeExpenseLamports };
        return freezeJson({ ...body, materialDigest: jupiterV1MaterialDigest(body) });
    }
    private async read(keys: readonly string[], minContextSlot: number, slice?: {
        offset: number;
        length: number;
    }): Promise<JupiterV1SemanticAccount[]> { const result: JupiterV1SemanticAccount[] = [], batches: string[][] = [];
    const readLimit = this.rpc.maximumAccountsPerRead ?? 16;
    if (readLimit !== 8 && readLimit !== 16) invalid("Jupiter V1 account read limit is invalid.");
    for (let offset = 0; offset < keys.length; offset += readLimit) batches.push(keys.slice(offset, offset + readLimit));
    const responses = await boundedPublicReads(this.rpc, batches.map(batch => ({ method: "getMultipleAccounts", params: [batch, { encoding: "base64", commitment: "confirmed", minContextSlot, ...(slice === undefined ? {} : { dataSlice: slice }) }] })));
    for (const [index, batch] of batches.entries()) {
        const response = rpcRecord(responses[index]), slot = rpcAtomic(rpcRecord(response.context).slot).toString();
        if (BigInt(slot) < BigInt(minContextSlot) || !Array.isArray(response.value) || response.value.length !== batch.length)
            invalid("Jupiter V1 account snapshot is incomplete.");
        response.value.forEach((v, i) => { const key = batch[i]!; if (v === null) {
            result.push({ address: key, existence: "absent", owner: null, executable: false, lamports: "0", dataBase64: "", dataHash: sha256(Buffer.alloc(0)), slot });
            return;
        } const a = rawAccount(v, slice === undefined ? 1048576 : slice.length, slice); result.push({ address: key, existence: "present", owner: a.owner, executable: a.executable, lamports: a.lamports.toString(), dataBase64: a.data.toString("base64"), dataHash: sha256(a.data), slot }); });
    } return result; }
}
async function boundedPublicReads(rpc: SolanaRpcPort, reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]> {
    if (reads.length < 1 || reads.length > 8) invalid("Jupiter V1 public read batch exceeds its finite bound.");
    const results = reads.length === 1 ? [await rpc.call(reads[0]!.method, reads[0]!.params)] : await solanaReadBatch(rpc, reads);
    if (!Array.isArray(results) || results.length !== reads.length) invalid("Jupiter V1 public read batch is incomplete.");
    return results;
}
export function decodeJupiterV1AddressTable(account: JupiterV1SemanticAccount): JupiterV1AddressTable { const bytes = Buffer.from(account.dataBase64, "base64"); if (account.existence !== "present" || account.owner !== ADDRESS_LOOKUP_TABLE_PROGRAM || account.executable || bytes.length < 56 || (bytes.length - 56) % 32 !== 0 || bytes.readUInt32LE(0) !== 1 || bytes.readBigUInt64LE(4) !== (1n << 64n) - 1n)
    invalid("Jupiter V1 ALT is not active canonical state."); const addresses: string[] = []; for (let offset = 56; offset < bytes.length; offset += 32)
    addresses.push(getAddressDecoder().decode(bytes.subarray(offset, offset + 32))); if (addresses.length > 256)
    invalid("Jupiter V1 ALT exceeds address capacity."); return { account, addresses, deactivationSlot: bytes.readBigUInt64LE(4).toString(), lastExtendedSlot: bytes.readBigUInt64LE(12).toString() }; }
export function assembleJupiterV1(payer: string, build: JupiterV1RawBuildResponse, tables: readonly JupiterV1AddressTable[], frozenRpcLifetime?: JupiterV1QuoteRpcLifetime) { const raw = jupiterV1Instructions(build), rpcLifetime = frozenRpcLifetime === undefined ? undefined : checkedJupiterV1QuoteRpcLifetime(frozenRpcLifetime), life = rpcLifetime === undefined ? jupiterV1Lifetime(build) : { blockhash: rpcLifetime.blockhash, lastValidBlockHeight: rpcLifetime.lastValidBlockHeight }, instructions: Instruction[] = raw.map(ix => ({ programAddress: address(ix.programId), accounts: ix.accounts.map(meta => ({ address: address(meta.pubkey), role: meta.isSigner ? (meta.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER) : (meta.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY) })), data: Buffer.from(ix.data, "base64") })); let message = appendTransactionMessageInstructions(instructions, setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(life.blockhash), lastValidBlockHeight: BigInt(life.lastValidBlockHeight) }, setTransactionMessageFeePayerSigner(createNoopSigner(address(payer)), createTransactionMessage({ version: 0 })))); const tableMap: Record<Address, Address[]> = {}; for (const table of tables)
    tableMap[address(table.account.address)] = table.addresses.map(address); message = compressTransactionMessageUsingAddressLookupTables(message, tableMap); const transaction = compileTransaction(message), wire = getBase64EncodedWireTransaction(transaction), bytes = Buffer.from(transaction.messageBytes); if (Buffer.from(wire, "base64").length > 1232 || Object.keys(transaction.signatures).length !== 1 || Object.keys(transaction.signatures)[0] !== payer || Object.values(transaction.signatures).some(s => s !== null))
    invalid("Jupiter V1 assembly has an unexpected signer or size."); const decoded = getCompiledTransactionMessageDecoder().decode(bytes); if (decoded.version !== 0)
    invalid("Jupiter V1 assembly is not v0."); const writable: string[] = [], readonly: string[] = []; const bindings: unknown[] = []; for (const lookup of decoded.addressTableLookups ?? []) {
    const table = tables.find(t => t.account.address === lookup.lookupTableAddress);
    if (table === undefined)
        invalid("Jupiter V1 missing ALT.");
    const resolve = (indices: readonly number[]) => indices.map(i => { const key = table.addresses[i]; if (key === undefined)
        invalid("Jupiter V1 ALT index is out of range."); return key; });
    writable.push(...resolve(lookup.writableIndexes));
    readonly.push(...resolve(lookup.readonlyIndexes));
    bindings.push({ address: table.account.address, dataHash: table.account.dataHash, writableIndexes: [...lookup.writableIndexes], readonlyIndexes: [...lookup.readonlyIndexes] });
} const keys = [...decoded.staticAccounts.map(String), ...writable, ...readonly]; if (new Set(keys).size !== keys.length)
    invalid("Jupiter V1 compiled account identity is duplicated."); const compiledAccounts: JupiterV1CompiledAccount[] = keys.map((key, i) => ({ address: key, signer: i < decoded.header.numSignerAccounts, writable: i < decoded.staticAccounts.length ? (i < decoded.header.numSignerAccounts ? i < decoded.header.numSignerAccounts - decoded.header.numReadonlySignerAccounts : i < decoded.staticAccounts.length - decoded.header.numReadonlyNonSignerAccounts) : i < decoded.staticAccounts.length + writable.length, source: i < decoded.staticAccounts.length ? "static" : "lookup" })); const union = new Map<string, {
    signer: boolean;
    writable: boolean;
}>(); union.set(payer, { signer: true, writable: true }); for (const ix of raw) {
    if (!union.has(ix.programId))
        union.set(ix.programId, { signer: false, writable: false });
    for (const meta of ix.accounts) {
        const old = union.get(meta.pubkey) ?? { signer: false, writable: false };
        union.set(meta.pubkey, { signer: old.signer || meta.isSigner, writable: old.writable || meta.isWritable });
    }
} if (compiledAccounts.length !== union.size || compiledAccounts.some(a => a.signer !== union.get(a.address)?.signer || a.writable !== union.get(a.address)?.writable))
    invalid("Jupiter V1 compiled privilege union differs from raw instructions."); return { transactionBase64: wire, transactionHash: sha256(Buffer.from(wire, "base64")), messageBase64: bytes.toString("base64"), messageHash: sha256(bytes), compiledAccounts, lookupBindingDigest: domainHash("apn.jupiter-v1-alt-binding.v1", canonicalJson(bindings)) }; }
