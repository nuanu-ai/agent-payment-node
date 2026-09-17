import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { canonicalAddress, canonicalBase64, invalid, sha256Bytes } from "./catalog.js";
export async function parseJupiterV0Envelope(transactionBase64, resolver) {
    const bytes = canonicalBase64(transactionBase64);
    let wire;
    try {
        wire = getTransactionDecoder().decode(bytes);
    }
    catch {
        return invalid("Jupiter transaction cannot be decoded.");
    }
    let message;
    try {
        message = getCompiledTransactionMessageDecoder().decode(wire.messageBytes);
    }
    catch {
        return invalid("Jupiter transaction message cannot be decoded.");
    }
    if (message.version !== 0)
        invalid("Jupiter transaction must use message version 0.");
    const signerKeys = Object.keys(wire.signatures);
    if (message.header.numSignerAccounts !== signerKeys.length || signerKeys.length !== 1 || Object.values(wire.signatures).some((signature) => signature !== null)) {
        invalid("Jupiter transaction must be unsigned with exactly one required signer.");
    }
    const staticAddresses = message.staticAccounts.map(String);
    staticAddresses.forEach(canonicalAddress);
    if (staticAddresses.length === 0 || signerKeys[0] !== staticAddresses[0])
        invalid("Jupiter fee payer and signer binding is invalid.");
    const lookups = message.addressTableLookups ?? [];
    if (lookups.length > 8 || new Set(lookups.map((lookup) => lookup.lookupTableAddress)).size !== lookups.length)
        invalid("Jupiter address table lookup set is invalid.");
    const requestedTables = lookups.map((lookup) => String(lookup.lookupTableAddress));
    const tables = await resolver.resolveAddressTables(requestedTables);
    if (!Array.isArray(tables) || tables.length !== requestedTables.length)
        invalid("Jupiter address table resolution is incomplete.");
    const byTable = new Map(tables.map((table) => [table.address, validateTable(table)]));
    const loadedWritable = [], loadedReadonly = [];
    const lookupBinding = [];
    for (const lookup of lookups) {
        const table = byTable.get(String(lookup.lookupTableAddress));
        if (table === undefined)
            invalid("Jupiter address table identity changed during resolution.");
        const writable = resolveIndexes(table, lookup.writableIndexes);
        const readonly = resolveIndexes(table, lookup.readonlyIndexes);
        if (new Set([...lookup.writableIndexes, ...lookup.readonlyIndexes]).size !== lookup.writableIndexes.length + lookup.readonlyIndexes.length)
            invalid("Jupiter address table index is duplicated.");
        loadedWritable.push(...writable);
        loadedReadonly.push(...readonly);
        lookupBinding.push({ address: table.address, owner: table.owner, executable: table.executable, dataHash: table.dataHash,
            writableIndexes: [...lookup.writableIndexes], readonlyIndexes: [...lookup.readonlyIndexes], writable, readonly });
    }
    const allAddresses = [...staticAddresses, ...loadedWritable, ...loadedReadonly];
    if (allAddresses.length > 256 || new Set(allAddresses).size !== allAddresses.length)
        invalid("Jupiter transaction account list is invalid.");
    const descriptors = await resolver.resolveAccounts(allAddresses);
    if (!Array.isArray(descriptors) || descriptors.length !== allAddresses.length)
        invalid("Jupiter account resolution is incomplete.");
    const descriptorMap = new Map(descriptors.map((descriptor) => [descriptor.address, validateDescriptor(descriptor)]));
    if (descriptorMap.size !== allAddresses.length)
        invalid("Jupiter account resolution contains duplicates.");
    const staticCount = staticAddresses.length;
    const signerCount = message.header.numSignerAccounts;
    const writableSigned = signerCount - message.header.numReadonlySignerAccounts;
    const writableUnsigned = staticCount - signerCount - message.header.numReadonlyNonSignerAccounts;
    const accounts = allAddresses.map((accountAddress, index) => {
        const descriptor = descriptorMap.get(accountAddress);
        if (descriptor === undefined)
            invalid("Jupiter account resolution changed an account identity.");
        const signer = index < signerCount;
        const writable = index < staticCount ? (signer ? index < writableSigned : index - signerCount < writableUnsigned) : index < staticCount + loadedWritable.length;
        if (writable && descriptor.executable)
            invalid("Jupiter transaction makes an executable account writable.");
        return Object.freeze({ ...descriptor, signer, writable, source: index < staticCount ? "static" : "lookup" });
    });
    const instructions = message.instructions.map((instruction) => {
        const program = accounts[instruction.programAddressIndex];
        if (program === undefined || !program.executable || program.writable)
            invalid("Jupiter instruction program account is invalid.");
        const instructionAccounts = (instruction.accountIndices ?? []).map((index) => { const account = accounts[index]; if (account === undefined)
            invalid("Jupiter instruction account index is invalid."); return account; });
        return Object.freeze({ programId: program.address, accounts: instructionAccounts, data: new Uint8Array(instruction.data ?? []) });
    });
    if (instructions.length === 0 || instructions.length > 64)
        invalid("Jupiter instruction count is invalid.");
    return Object.freeze({ transactionBase64, transactionHash: sha256Bytes(bytes), messageHash: sha256Bytes(new Uint8Array(wire.messageBytes)), blockhash: String(message.lifetimeToken),
        signerCount, feePayer: staticAddresses[0], accounts: Object.freeze(accounts), addressTables: Object.freeze(requestedTables.map((key) => byTable.get(key))),
        loadedWritable: Object.freeze([...loadedWritable]), loadedReadonly: Object.freeze([...loadedReadonly]),
        lookupBindingDigest: domainHash("apn.jupiter-alt-binding.v1", canonicalJson(lookupBinding)), instructions });
}
function validateDescriptor(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["address", "owner", "executable", "dataHash"]))
        invalid("Jupiter account descriptor shape is invalid.");
    canonicalAddress(value.address);
    canonicalAddress(value.owner);
    if (typeof value.executable !== "boolean" || !/^[a-f0-9]{64}$/u.test(value.dataHash))
        invalid("Jupiter account descriptor is invalid.");
    return Object.freeze({ ...value });
}
function validateTable(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["address", "owner", "executable", "dataHash", "addresses"]))
        invalid("Jupiter address table descriptor shape is invalid.");
    canonicalAddress(value.address);
    canonicalAddress(value.owner);
    if (typeof value.executable !== "boolean" || !/^[a-f0-9]{64}$/u.test(value.dataHash) || value.executable || !Array.isArray(value.addresses) || value.addresses.length > 256)
        invalid("Jupiter address table descriptor is invalid.");
    value.addresses.forEach(canonicalAddress);
    if (new Set(value.addresses).size !== value.addresses.length)
        invalid("Jupiter address table contains duplicate addresses.");
    return Object.freeze({ ...value, addresses: Object.freeze([...value.addresses]) });
}
function resolveIndexes(table, indexes) {
    if (indexes.length > 64)
        invalid("Jupiter address table loads too many accounts.");
    return indexes.map((index) => { if (!Number.isSafeInteger(index) || index < 0 || index >= table.addresses.length)
        invalid("Jupiter address table index is invalid."); return table.addresses[index]; });
}
//# sourceMappingURL=transaction.js.map