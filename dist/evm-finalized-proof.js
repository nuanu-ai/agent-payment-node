import { canonicalJson, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { BridgeHttps } from "./lifi/https.js";
import { parsePublicHttpsUrl } from "./network-policy.js";
import { parseRpcResultEnvelope } from "./rpc-envelope.js";
export function finalizedQuantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "Malformed RPC quantity.");
    return BigInt(value);
}
/** A keyless public HTTPS JSON-RPC endpoint, one exact result envelope per call, through the shared bounded transport. */
export function publicFinalizedRead(url, label, https = new BridgeHttps()) {
    const parsed = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", `${label} endpoint`, 2048);
    if (parsed.search !== "")
        throw new ApnError("APN_RPC_CONFIG", `${label} endpoint must not carry a query.`);
    const endpoint = parsed.toString();
    let sequence = 0;
    return {
        async call(method, params) {
            const id = String(++sequence);
            const response = await https.request(endpoint, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }), 1024 * 1024, "APN_RPC_CONFIG");
            if (response.status !== 200)
                throw new ApnError("APN_RPC_PROTOCOL", `${label} answered a non-200 status.`, { status: response.status });
            return parseRpcResultEnvelope(response.body, id, method);
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
export async function assertFinalizedChain(rpc, chainId) {
    if (finalizedQuantity(await rpc.call("eth_chainId", [])) !== BigInt(chainId)) {
        throw new ApnError("APN_CHAIN_MISMATCH", "The closure RPC does not serve the record's signing chain.", { chainId: String(chainId) });
    }
}
const nonceWait = (account, chainId, nonce, finalized) => `the finalized nonce of ${account} on chain ${chainId} to pass ${nonce} (it is ${finalized})`;
/** A transaction by hash: null when the node does not know it, else whether it is in a block. */
async function transactionSeen(rpc, transactionHash) {
    const found = await rpc.call("eth_getTransactionByHash", [transactionHash]);
    if (found === null)
        return "not_found";
    if (!isPlainRecord(found) || typeof found.hash !== "string" || found.hash.toLowerCase() !== transactionHash.toLowerCase()) {
        throw new ApnError("APN_RPC_PROTOCOL", "The RPC answered another transaction than the one asked for.");
    }
    if (found.blockNumber === null || found.blockNumber === undefined)
        return "pending";
    finalizedQuantity(found.blockNumber);
    return "included";
}
/**
 * Closed when, at the finalized block of its signing chain, the signer's nonce is past every nonce the record froze (so
 * none of its envelopes can ever be included again) and none of its own transaction hashes is pending. Hashes are read
 * only once the nonce is past.
 */
export async function checkNonceClosure(facts, rpc) {
    await assertFinalizedChain(rpc, facts.chainId);
    const finalized = finalizedQuantity(await rpc.call("eth_getTransactionCount", [facts.account, "finalized"]));
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
/**
 * R4 exit 2 for one signed effect: at the finalized tag the signer's nonce is past the effect's nonce (so the nonce is
 * spent by a finalized transaction) and the node knows neither the effect's transaction nor a receipt for it, so that
 * transaction was not the one and can never be included. The nonce is read first, then the hash.
 */
export async function checkNeverLands(effect, rpc) {
    await assertFinalizedChain(rpc, effect.chainId);
    const finalized = finalizedQuantity(await rpc.call("eth_getTransactionCount", [effect.account, "finalized"]));
    if (finalized <= effect.nonce)
        return { neverLands: false, waitingFor: nonceWait(effect.account, effect.chainId, effect.nonce, finalized) };
    if (await transactionSeen(rpc, effect.transactionHash) !== "not_found") {
        return { neverLands: false, waitingFor: `transaction ${effect.transactionHash} is known to the node; its receipt decides it` };
    }
    if (await rpc.call("eth_getTransactionReceipt", [effect.transactionHash]) !== null) {
        return { neverLands: false, waitingFor: `transaction ${effect.transactionHash} has a receipt; its observation decides it` };
    }
    return { neverLands: true, finalizedNonce: finalized };
}
//# sourceMappingURL=evm-finalized-proof.js.map