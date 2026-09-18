import { utils } from "tronweb";
import { sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { assertSolanaNetwork, protocolFailure, rpcArray, rpcAtomic, rpcRecord, solanaSignature } from "../solana/rpc.js";
import { tronArray, tronAtomic, tronHex, tronProtocolFailure, tronRecord, tronSafeNumber } from "../tron/codec.js";
import { assertTronNetwork, tronBlock } from "../tron/rpc.js";
import { solanaJsonAccountKeys } from "./solana-destination-candidate.js";
import { parseTronDestinationCandidate } from "./tron-destination-candidate.js";
import { bridgeFailure, bridgeRecord } from "./validation.js";
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", `oneclick_status_${reason}`); }
/** Parse the provider's destination hash list from a /v0/status body. Absence means nothing to verify yet. */
export function oneClickDestinationHashes(lane, statusBody) {
    if (statusBody.swapDetails === undefined || statusBody.swapDetails === null)
        return [];
    const list = bridgeRecord(statusBody.swapDetails).destinationChainTxHashes;
    if (list === undefined || list === null)
        return [];
    if (!Array.isArray(list) || list.length > 8)
        fail("destination_hashes");
    const hashes = list.map((item) => {
        const hash = bridgeRecord(item).hash;
        if (lane.destination.network === "tron") {
            if (typeof hash !== "string" || !/^(?:0x)?[a-fA-F0-9]{64}$/u.test(hash))
                fail("destination_hash");
            return hash.replace(/^0x/u, "").toLowerCase();
        }
        try {
            return solanaSignature(hash);
        }
        catch {
            return fail("destination_hash");
        }
    });
    if (new Set(hashes).size !== hashes.length)
        fail("destination_hash_duplicate");
    return hashes;
}
export async function proveOneClickDestination(input) {
    const { lane } = input, minimum = BigInt(input.minimumOutputAtomic);
    const proofClass = lane.destination.network === "solana" ? "solana_finalized_sol_balance_delta"
        : lane.destination.kind === "native" ? "tron_solidified_trx_transfer" : "tron_solidified_usdt_transfer";
    const base = { proofClass, recipient: input.recipient, asset: lane.destination.oneClickAsset, minimumOutputAtomic: minimum.toString(),
        sourceCorrelation: "provider_named_destination_hash" };
    if (input.hashes.length === 0)
        return { ...base, status: "awaiting_provider_destination_hash", reason: "provider_named_no_destination_transaction",
            creditedAtomic: "0", transactions: [], pendingTransactions: [] };
    const verified = [], pending = [];
    let total = 0n;
    try {
        const credit = lane.destination.network === "solana" ? await solanaCredits(input.solana(), input)
            : await tronCredits(input.tron(), input);
        for (const [id, item] of credit) {
            if (item.status === "pending") {
                pending.push(id);
                continue;
            }
            if (item.blockTimeMs < BigInt(input.notBeforeMs))
                throw new ApnError("APN_RPC_PROTOCOL", "Destination credit predates the quote.");
            total += item.credited;
            verified.push({ id, creditedAtomic: item.credited.toString(), block: item.block.toString(), blockTime: new Date(Number(item.blockTimeMs)).toISOString() });
        }
    }
    catch (error) {
        // Malformed, mismatched or unreadable chain evidence is reported as unproven, never as delivery; configuration faults surface.
        if (!(error instanceof ApnError) || error.code !== "APN_RPC_PROTOCOL" && error.code !== "APN_INVALID_INPUT")
            throw error;
        return { ...base, status: "unproven", reason: "destination_evidence_rejected", creditedAtomic: "0", transactions: [], pendingTransactions: [] };
    }
    const status = pending.length > 0 ? "pending" : total >= minimum ? "finalized" : "unproven";
    return { ...base, status, reason: status === "finalized" ? "credited_at_least_minimum_output" : status === "pending" ? "destination_not_final"
            : "credited_below_minimum_output", creditedAtomic: total.toString(), transactions: verified, pendingTransactions: pending };
}
async function tronCredits(rpc, input) {
    await assertTronNetwork(rpc);
    const out = [];
    for (const id of input.hashes)
        out.push([id, await tronCredit(rpc, id, input)]);
    return out;
}
async function tronCredit(rpc, id, input) {
    const tx = tronRecord(await rpc.call("walletsolidity/gettransactionbyid", { value: id }));
    const info = tronRecord(await rpc.call("walletsolidity/gettransactioninfobyid", { value: id }));
    if (Object.keys(tx).length === 0 || Object.keys(info).length === 0)
        return { status: "pending" };
    if (tx.txID !== id || info.id !== id || typeof tx.raw_data_hex !== "string" || !/^(?:[a-f0-9]{2})+$/u.test(tx.raw_data_hex) ||
        sha256(Buffer.from(tx.raw_data_hex, "hex")) !== id)
        tronProtocolFailure();
    let credited;
    if (input.lane.destination.kind === "native")
        credited = trxCredit(tx, info, input.recipient);
    else
        credited = BigInt(parseTronDestinationCandidate({ transactionId: id, recipient: input.recipient, minimumOutputAtomic: "1",
            // The parser's provider gate is met by the provider naming this hash; the credit itself comes from the solidified log.
            providerOutcome: "completed", transaction: tx, transactionInfo: info }).receivedAtomic);
    const number = tronAtomic(info.blockNumber);
    const block = tronBlock(await rpc.call("walletsolidity/getblockbynum", { num: tronSafeNumber(number) }));
    if (block.number !== number || tronAtomic(info.blockTimeStamp) !== block.timestamp)
        tronProtocolFailure();
    const members = tronArray(block.body.transactions, 4000).map(tronRecord).filter(item => item.txID === id);
    if (members.length !== 1 || members[0].raw_data_hex !== tx.raw_data_hex || contractResult(members[0]) !== "SUCCESS")
        tronProtocolFailure();
    const head = tronBlock(await rpc.call("walletsolidity/getnowblock", {}));
    if (head.number < number)
        tronProtocolFailure();
    return { status: "verified", credited, block: number, blockTimeMs: block.timestamp };
}
/** One solidified TransferContract to the recipient. A first transfer may create the recipient account; that fee is the sender's. */
function trxCredit(tx, info, recipient) {
    const raw = tronRecord(tx.raw_data);
    const contracts = tronArray(raw.contract, 1);
    if (contracts.length !== 1)
        tronProtocolFailure();
    const contract = tronRecord(contracts[0]);
    if (contract.type !== "TransferContract")
        tronProtocolFailure();
    const value = tronRecord(tronRecord(contract.parameter).value);
    if (typeof value.to_address !== "string" || typeof value.owner_address !== "string" || tronHex(value.to_address) !== tronHex(recipient))
        tronProtocolFailure();
    const amount = tronAtomic(value.amount);
    let encoded;
    try {
        encoded = utils.transaction.txPbToRawDataHex(utils.transaction.txJsonToPb({ visible: false, raw_data: safeNumbers(raw) })).toLowerCase();
    }
    catch {
        return tronProtocolFailure();
    }
    if (encoded !== tx.raw_data_hex || amount === 0n || contractResult(tx) !== "SUCCESS" ||
        zero(info.result, "SUCESS") !== "SUCESS" || info.resMessage !== undefined && info.resMessage !== "" ||
        info.receipt !== undefined && zero(tronRecord(info.receipt).result, "DEFAULT") !== "DEFAULT" ||
        info.log !== undefined && tronArray(info.log).length !== 0 ||
        info.internal_transactions !== undefined && tronArray(info.internal_transactions).length !== 0)
        tronProtocolFailure();
    return amount;
}
function contractResult(transaction) {
    const rows = tronArray(transaction.ret, 1);
    if (rows.length !== 1)
        tronProtocolFailure();
    const row = tronRecord(rows[0]);
    if (zero(row.ret, "SUCESS") !== "SUCESS")
        tronProtocolFailure();
    return row.contractRet;
}
function zero(value, name) { return value === undefined || value === 0 || value === 0n ? name : value; }
/** The lossless TRON reader yields bigint integers; the protobuf encoder needs exact safe numbers. */
function safeNumbers(value) {
    if (typeof value === "bigint")
        return tronSafeNumber(value);
    if (Array.isArray(value))
        return value.map(safeNumbers);
    if (value !== null && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeNumbers(item)]));
    return value;
}
async function solanaCredits(rpc, input) {
    await assertSolanaNetwork(rpc);
    const out = [];
    for (const signature of input.hashes)
        out.push([signature, await solanaCredit(rpc, signature, input.recipient)]);
    return out;
}
/** Finalized balance delta of the recipient inside the named transaction; any system transfer or CPI credit counts once. */
async function solanaCredit(rpc, signature, recipient) {
    const statuses = rpcRecord(await rpc.call("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]));
    const values = rpcArray(statuses.value, 1);
    if (values.length !== 1)
        protocolFailure();
    if (values[0] === null)
        return { status: "pending" };
    const status = rpcRecord(values[0]);
    if (status.confirmationStatus !== "finalized" || status.confirmations !== null)
        return { status: "pending" };
    const slot = rpcAtomic(status.slot);
    if (status.err !== null || rpcAtomic(rpcRecord(statuses.context).slot) < slot)
        protocolFailure();
    const result = await rpc.call("getTransaction", [signature, { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
    if (result === null)
        return { status: "pending" };
    const tx = rpcRecord(result), meta = rpcRecord(tx.meta);
    if (rpcAtomic(tx.slot) !== slot || meta.err !== null)
        protocolFailure();
    const signatures = rpcArray(rpcRecord(tx.transaction).signatures, 8);
    if (signatures.length === 0 || signatures[0] !== signature)
        protocolFailure();
    const keys = solanaJsonAccountKeys(jsonVersionFields(tx)), index = keys.indexOf(recipient);
    const pre = rpcArray(meta.preBalances, 256).map(rpcAtomic), post = rpcArray(meta.postBalances, 256).map(rpcAtomic);
    if (index < 0 || pre.length !== keys.length || post.length !== keys.length || post[index] <= pre[index])
        protocolFailure();
    return { status: "verified", credited: post[index] - pre[index], block: slot, blockTimeMs: rpcAtomic(tx.blockTime) * 1000n };
}
/** The lossless Solana reader yields bigint integers; the shared key resolver expects numeric version and lookup indexes. */
function jsonVersionFields(tx) {
    const small = (value) => typeof value === "bigint" && value <= 255n ? Number(value) : value;
    const message = rpcRecord(rpcRecord(tx.transaction).message);
    const lookups = message.addressTableLookups === undefined ? undefined : rpcArray(message.addressTableLookups, 64).map(item => {
        const lookup = rpcRecord(item);
        return { ...lookup, writableIndexes: rpcArray(lookup.writableIndexes, 256).map(small), readonlyIndexes: rpcArray(lookup.readonlyIndexes, 256).map(small) };
    });
    return { ...tx, version: small(tx.version), transaction: { ...rpcRecord(tx.transaction),
            message: { ...message, ...(lookups === undefined ? {} : { addressTableLookups: lookups }) } } };
}
//# sourceMappingURL=near-oneclick-destination.js.map