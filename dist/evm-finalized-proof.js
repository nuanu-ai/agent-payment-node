import { canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "./evm-rpc-codec.js";
import { BridgeHttps } from "./lifi/https.js";
import { parsePublicHttpsUrl } from "./network-policy.js";
import { parseRpcBatchResultEnvelope, parseRpcResultEnvelope } from "./rpc-envelope.js";
/** A keyless public HTTPS JSON-RPC endpoint, exact result envelopes, through the shared bounded transport. */
export function publicFinalizedRead(url, label, https = new BridgeHttps()) {
    const parsed = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", `${label} endpoint`, 2048);
    if (parsed.search !== "")
        throw new ApnError("APN_RPC_CONFIG", `${label} endpoint must not carry a query.`);
    const endpoint = parsed.toString();
    let sequence = 0;
    const post = async (body) => {
        const response = await https.request(endpoint, "POST", canonicalJson(body), 1024 * 1024, "APN_RPC_CONFIG");
        if (response.status !== 200)
            throw new ApnError("APN_RPC_PROTOCOL", `${label} answered a non-200 status.`, { status: response.status });
        return response.body;
    };
    return {
        async call(method, params) {
            const id = String(++sequence);
            return parseRpcResultEnvelope(await post({ jsonrpc: "2.0", id, method, params }), id, method);
        },
        async batch(calls) {
            const ids = calls.map(() => ++sequence);
            return parseRpcBatchResultEnvelope(await post(calls.map((call, i) => ({ jsonrpc: "2.0", id: ids[i], method: call.method, params: call.params }))), ids);
        },
    };
}
/** The public RPC setting each family already reads for that chain. */
export const FINALIZED_RPC_ENV = Object.freeze({ 1: "APN_ETHEREUM_RPC_URL", 10: "APN_OPTIMISM_RPC_URL",
    56: "APN_BNB_RPC_URL", 143: "APN_MONAD_RPC_URL", 8453: "APN_BASE_RPC_URL", 42161: "APN_ARBITRUM_RPC_URL", 59144: "APN_LINEA_RPC_URL" });
/** The production reader: the chain's own APN_<CHAIN>_RPC_URL, read keyless; a missing setting is named in the refusal. */
export function environmentFinalizedReader(environment) {
    return chainId => {
        const variable = FINALIZED_RPC_ENV[chainId];
        if (variable === undefined)
            throw new ApnError("APN_RPC_CONFIG", `No public RPC setting is known for chain ${chainId}.`, { chainId: String(chainId) });
        const url = environment[variable];
        if (url === undefined || url === "") {
            throw new ApnError("APN_RPC_CONFIG", `Proving this operation's outcome reads chain ${chainId} at its finalized tag: set ${variable}.`, { reason: "finalized_read_rpc_required" });
        }
        return publicFinalizedRead(url, `Chain ${chainId} finalized-read RPC`);
    };
}
function assertChain(value, chainId) {
    if (evmRpcQuantity(value) !== BigInt(chainId)) {
        throw new ApnError("APN_CHAIN_MISMATCH", "The finalized-read RPC does not serve the operation's signing chain.", { chainId: String(chainId) });
    }
}
export async function assertFinalizedChain(rpc, chainId) {
    assertChain(await rpc.call("eth_chainId", []), chainId);
}
const nonceWait = (account, chainId, nonce, finalized) => `the finalized nonce of ${account} on chain ${chainId} to pass ${nonce} (it is ${finalized})`;
/** A lookup by hash answers null (unknown) or that hash's own record; any other record is a protocol violation. */
function ownLookup(value, field, transactionHash) {
    if (value === null)
        return null;
    const found = evmRpcRecord(value);
    if (evmRpcHex(found[field], 32) !== transactionHash.toLowerCase())
        throw new ApnError("APN_RPC_PROTOCOL", "The RPC answered another transaction than the one asked for.");
    return found;
}
/** A transaction by hash: whether the node knows it, and whether it is in a block. */
async function transactionSeen(rpc, transactionHash) {
    const found = ownLookup(await rpc.call("eth_getTransactionByHash", [transactionHash]), "hash", transactionHash);
    if (found === null)
        return "not_found";
    if (found.blockNumber === null || found.blockNumber === undefined)
        return "pending";
    evmRpcQuantity(found.blockNumber);
    return "included";
}
/**
 * Closed when, at the finalized block of its signing chain, the signer's nonce is past every nonce the record froze (so
 * none of its envelopes can ever be included again) and none of its own transaction hashes is pending. Hashes are read
 * only once the nonce is past. The closure never depends on a null lookup: an envelope that landed closes it the same
 * way, so it claims nothing about what landed and releases no ledger hold (those stay charged).
 */
export async function checkNonceClosure(facts, rpc) {
    await assertFinalizedChain(rpc, facts.chainId);
    const finalized = evmRpcQuantity(await rpc.call("eth_getTransactionCount", [facts.account, "finalized"]));
    if (finalized <= facts.highestNonce)
        return { closed: false, waitingFor: nonceWait(facts.account, facts.chainId, facts.highestNonce, finalized) };
    const ownTransactions = [];
    for (const transactionHash of facts.ownHashes) {
        const seen = await transactionSeen(rpc, transactionHash);
        if (seen === "pending")
            return { closed: false, waitingFor: `own transaction ${transactionHash} to leave the pending pool` };
        ownTransactions.push({ transactionHash, seen });
    }
    return { closed: true, finalizedNonce: finalized, ownTransactions };
}
const ownReads = (effect) => [{ method: "eth_getTransactionCount", params: [effect.account, "finalized"] },
    { method: "eth_getTransactionReceipt", params: [effect.transactionHash] }, { method: "eth_getTransactionByHash", params: [effect.transactionHash] }];
function ownAnswer(effect, [nonce, receipt, transaction]) {
    const finalizedNonce = evmRpcQuantity(nonce), receiptFound = ownLookup(receipt, "transactionHash", effect.transactionHash) !== null;
    const transactionKnown = ownLookup(transaction, "hash", effect.transactionHash) !== null;
    return { neverLands: false, finalizedNonce, receiptFound, transactionKnown, unknown: finalizedNonce > effect.nonce && !receiptFound && !transactionKnown };
}
const notProven = ({ finalizedNonce, receiptFound, transactionKnown }) => ({ neverLands: false, finalizedNonce, receiptFound, transactionKnown });
/** One transaction hash of the era block, or null when this node does not hold that block as canonical or it has none. */
function probeOf(value, era) {
    if (value === null)
        return null;
    const block = evmRpcRecord(value), hash = evmRpcHex(block.hash, 32);
    if (era.number === undefined ? hash !== era.hash.toLowerCase() : evmRpcQuantity(block.number) !== era.number) {
        throw new ApnError("APN_RPC_PROTOCOL", "The RPC answered another block than the one asked for.");
    }
    if (!Array.isArray(block.transactions))
        throw new ApnError("APN_RPC_PROTOCOL", "The RPC answered a block without its transaction hashes.");
    // Read by number, another hash means the era block is not canonical on this node (a reorg): nothing is proven.
    return hash !== era.hash.toLowerCase() || block.transactions.length === 0 ? null : evmRpcHex(block.transactions[0], 32);
}
/** The node's transaction index holds the era block: it answered the probe as included in exactly that block. */
function indexed(found, era) {
    if (found === null || found.blockHash === null || found.blockHash === undefined)
        return false;
    return evmRpcHex(found.blockHash, 32) === era.hash.toLowerCase() && (era.number === undefined || evmRpcQuantity(found.blockNumber) === era.number);
}
/**
 * R4 exit 2 for one signed effect, the one rule every family uses: at the finalized tag the signer's nonce is past the
 * effect's nonce (a finalized transaction spent it) and the node knows neither the effect's transaction nor a receipt
 * for it, so that transaction was not the one and can never be included. A nonce not yet past proves nothing.
 *
 * A null lookup counts only from a node whose transaction index provably reaches the effect's era: a node that prunes
 * its index (geth `--history.transactions`, by default the last 2,350,000 blocks) answers null for a transaction that
 * landed before its window. Every client prunes the index from its tail, so a node that returns a transaction of the
 * era block (`before`) as included in that very block indexes every canonical block above it, which is where the effect
 * could be. The probe hash comes from the era block's body (a block read, not the index, not state). Without `before`, or
 * when the node does not hold the era block as canonical, has no transaction in it or does not index it, nothing is
 * proven: the effect waits for a receipt or its owner's abandon.
 *
 * The deciding answer is one batch: a load balancer could route separate requests to a node behind the finalized head,
 * which would not know a transaction the finalized nonce already covers, or to a node with a shorter index. The chain id
 * is the endpoint's, proven by the first batch of this check (P2). Current state only, never a historical (archive) read.
 */
export async function checkNeverLands(effect, batch) {
    const [chain, ...own] = await batch([{ method: "eth_chainId", params: [] }, ...ownReads(effect)]);
    assertChain(chain, effect.chainId);
    const first = ownAnswer(effect, own), era = effect.before;
    if (!first.unknown || era === undefined)
        return notProven(first);
    const [block] = await batch([era.number === undefined ? { method: "eth_getBlockByHash", params: [era.hash, false] }
            : { method: "eth_getBlockByNumber", params: [`0x${era.number.toString(16)}`, false] }]);
    const probe = probeOf(block, era);
    if (probe === null)
        return notProven(first);
    const [nonce, receipt, transaction, probed] = await batch([...ownReads(effect), { method: "eth_getTransactionByHash", params: [probe] }]);
    const last = ownAnswer(effect, [nonce, receipt, transaction]);
    return last.unknown && indexed(ownLookup(probed, "hash", probe), era) ? { neverLands: true, finalizedNonce: last.finalizedNonce } : notProven(last);
}
//# sourceMappingURL=evm-finalized-proof.js.map