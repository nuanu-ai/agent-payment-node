import { canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "./evm-rpc-codec.js";
import { parseRpcBatchResultEnvelope } from "./rpc-envelope.js";
/**
 * The chain-proven "never lands" exit (phase 4c R4 exit 2) in one batch: the chain ID, the signer's nonce at the
 * `finalized` tag, and this hash's receipt and transaction. One POST keeps every answer in one node's view: a load
 * balancer could route separate requests to a node behind the finalized head, which would not know a receipt the
 * finalized nonce already covers. Current state only, never a historical (archive) read.
 */
export async function readEvmUnlandedEvidence(batch, chainId, account, hash) {
    const [chain, nonce, receipt, transaction] = await batch([
        { method: "eth_chainId", params: [] }, { method: "eth_getTransactionCount", params: [account, "finalized"] },
        { method: "eth_getTransactionReceipt", params: [hash] }, { method: "eth_getTransactionByHash", params: [hash] }
    ]);
    if (evmRpcQuantity(chain) !== BigInt(chainId))
        throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the operation's chain.");
    if (receipt !== null && evmRpcHex(evmRpcRecord(receipt).transactionHash, 32) !== hash.toLowerCase() ||
        transaction !== null && evmRpcHex(evmRpcRecord(transaction).hash, 32) !== hash.toLowerCase()) {
        throw new ApnError("APN_RPC_PROTOCOL", "EVM transaction lookup returned a different hash.");
    }
    return { finalizedNonce: evmRpcQuantity(nonce).toString(), receiptFound: receipt !== null, transactionKnown: transaction !== null };
}
/**
 * True only when a transaction other than this one took its nonce at finality and the node knows neither this
 * transaction nor a receipt for it: it can never land. A nonce that is not past yet proves nothing.
 */
export function provesUnlanded(evidence, nonce) {
    return BigInt(evidence.finalizedNonce) > BigInt(nonce) && !evidence.receiptFound && !evidence.transactionKnown;
}
/** A JSON-RPC batch reader over one public HTTPS endpoint (the URL is the family's own configured endpoint). */
export function jsonRpcBatchReader(https, url) {
    let sequence = 0;
    return async (calls) => {
        const ids = calls.map(() => ++sequence);
        const body = canonicalJson(calls.map((call, i) => ({ jsonrpc: "2.0", id: ids[i], method: call.method, params: call.params })));
        const response = await https.request(url, "POST", body, 1024 * 1024, "APN_RPC_CONFIG");
        if (response.status !== 200)
            throw new ApnError("APN_RPC_PROTOCOL", "The RPC endpoint refused the batch read.", { status: response.status });
        return parseRpcBatchResultEnvelope(response.body, ids);
    };
}
//# sourceMappingURL=evm-unlanded-proof.js.map