import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity } from "../evm-rpc-codec.js";
import { readSolanaBlockHeight, rpcArray, rpcAtomic, rpcRecord, solanaSignature } from "../solana/rpc.js";
export const SWAP_UNLANDED_PROOF_SCHEMA = "apn.swap-expired-unlanded-proof.v1";
const UINT = /^(?:0|[1-9][0-9]{0,77})$/u;
export function validateSwapUnlandedProof(value, chain) {
    if (!isPlainRecord(value))
        invalid();
    const network = value.network;
    const expected = /^solana:/u.test(chain) ? "solana" : /^eip155:/u.test(chain) ? "evm" : /^tron:/u.test(chain) ? "tron" : null;
    if (network !== expected)
        invalid();
    if (network === "solana") {
        if (!exactKeys(value, ["network", "transactionId", "lastValidBlockHeight", "observedFinalizedBlockHeight"]) ||
            (value.transactionId !== null && solanaSignature(value.transactionId) !== value.transactionId) ||
            !uint(value.lastValidBlockHeight) || !uint(value.observedFinalizedBlockHeight) ||
            BigInt(value.observedFinalizedBlockHeight) <= BigInt(value.lastValidBlockHeight))
            invalid();
    }
    else if (network === "evm") {
        if (!exactKeys(value, ["network", "transactionId", "deadlineSeconds", "observedFinalizedBlockNumber", "observedFinalizedTimestamp"]) ||
            (value.transactionId !== null && (typeof value.transactionId !== "string" || !/^0x[a-f0-9]{64}$/u.test(value.transactionId))) ||
            !uint(value.deadlineSeconds) || !uint(value.observedFinalizedBlockNumber) || !uint(value.observedFinalizedTimestamp) ||
            BigInt(value.observedFinalizedTimestamp) <= BigInt(value.deadlineSeconds))
            invalid();
    }
    else if (!exactKeys(value, ["network", "transactionId", "expirationMs", "observedSolidifiedBlockNumber", "observedSolidifiedTimestampMs"]) ||
        typeof value.transactionId !== "string" || !/^[a-f0-9]{64}$/u.test(value.transactionId) || !uint(value.expirationMs) ||
        !uint(value.observedSolidifiedBlockNumber) || !uint(value.observedSolidifiedTimestampMs) ||
        BigInt(value.observedSolidifiedTimestampMs) <= BigInt(value.expirationMs))
        invalid();
    return value;
}
/** The terminal outcome digest: one value per operation and transaction identity, independent of when it was observed. */
export function swapUnlandedProofHash(operation, proof) {
    const bound = proof.network === "solana" ? proof.lastValidBlockHeight : proof.network === "evm" ? proof.deadlineSeconds : proof.expirationMs;
    return domainHash(SWAP_UNLANDED_PROOF_SCHEMA, canonicalJson({ operationId: operation.operationId,
        markerHash: operation.submissionMarker?.markerHash ?? null, network: proof.network, transactionId: proof.transactionId, bound }));
}
/**
 * Solana: the finalized block height passed the message's lastValidBlockHeight, so no later block can include it, and
 * the signature (when one was ever persisted) has no status with full history. The height is read first: a signature
 * persisted afterwards can only be sent into an expired lifetime. Two reads at most.
 */
export async function proveSolanaUnlanded(rpc, input) {
    const lastValid = BigInt(input.lastValidBlockHeight);
    // Checked against the finalized latest blockhash read in the same request: a slot answered as a height is refused.
    const finalized = await readSolanaBlockHeight(rpc, "finalized");
    if (finalized <= lastValid)
        return null;
    const signature = await input.loadSignature();
    if (signature !== null) {
        const statuses = rpcArray(rpcRecord(await rpc.call("getSignatureStatuses", [[solanaSignature(signature)], { searchTransactionHistory: true }])).value, 1);
        if (statuses.length !== 1)
            throw new ApnError("APN_RPC_PROTOCOL", "Solana signature status response is incomplete.");
        if (statuses[0] !== null)
            return null;
    }
    return { network: "solana", transactionId: signature, lastValidBlockHeight: lastValid.toString(),
        observedFinalizedBlockHeight: finalized.toString() };
}
/**
 * EVM: the finalized block's timestamp passed the router deadline, so any later inclusion reverts and the input cannot
 * move, and the signed transaction (when one was ever persisted) has no receipt up to that finalized block.
 */
export async function proveEvmUnlanded(call, input) {
    if (!Number.isSafeInteger(input.deadlineSeconds) || input.deadlineSeconds <= 0)
        invalid();
    if (evmRpcQuantity(await call("eth_chainId", [])) !== input.chainId)
        throw new ApnError("APN_CHAIN_MISMATCH", "Swap expiry proof requires the exact EVM chain.");
    const block = await evmRpcBlock(call, "finalized"), timestamp = evmRpcQuantity(block.raw.timestamp);
    if (timestamp <= BigInt(input.deadlineSeconds))
        return null;
    const hash = await input.loadTransactionHash();
    if (hash !== null) {
        const exact = evmRpcHex(hash, 32).toLowerCase();
        if (await call("eth_getTransactionReceipt", [exact]) !== null)
            return null;
    }
    return { network: "evm", transactionId: hash === null ? null : hash.toLowerCase(), deadlineSeconds: String(input.deadlineSeconds),
        observedFinalizedBlockNumber: block.number, observedFinalizedTimestamp: timestamp.toString() };
}
/**
 * TRON: the solidified head's timestamp passed the transaction expiration, so no later block may include it, and the
 * solidified node has neither the transaction nor its info. Every earlier block is already solidified.
 */
export async function proveTronUnlanded(rpc, input) {
    if (!/^[a-f0-9]{64}$/u.test(input.transactionId) || !uint(input.expirationMs))
        invalid();
    const header = record(record(record(await rpc.call("walletsolidity/getnowblock", {})).block_header).raw_data);
    const number = integer(header.number), timestamp = integer(header.timestamp);
    if (timestamp <= BigInt(input.expirationMs))
        return null;
    const [transaction, info] = [await rpc.call("walletsolidity/gettransactionbyid", { value: input.transactionId }),
        await rpc.call("walletsolidity/gettransactioninfobyid", { value: input.transactionId })];
    if (!empty(transaction) || !empty(info))
        return null;
    return { network: "tron", transactionId: input.transactionId, expirationMs: input.expirationMs,
        observedSolidifiedBlockNumber: number.toString(), observedSolidifiedTimestampMs: timestamp.toString() };
}
function empty(value) { return isPlainRecord(value) && Object.keys(value).length === 0; }
function record(value) {
    if (!isPlainRecord(value))
        throw new ApnError("APN_RPC_PROTOCOL", "TRON solidified block response is malformed.");
    return value;
}
function integer(value) {
    if ((typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) && (typeof value !== "string" || !UINT.test(value)) &&
        typeof value !== "bigint")
        throw new ApnError("APN_RPC_PROTOCOL", "TRON solidified block number or time is malformed.");
    return BigInt(value);
}
function uint(value) { return typeof value === "string" && UINT.test(value); }
function invalid() { throw new ApnError("APN_INVALID_INPUT", "Swap expiry proof is invalid."); }
//# sourceMappingURL=unlanded.js.map