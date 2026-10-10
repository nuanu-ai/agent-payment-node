/** Finite Polygon callTracer decoder; no trace enrichment or absent-data inference. */
import { ApnError } from "../errors.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { RELAY_BNB_SOURCE } from "./native-quote.js";
export const POLYGON_PAYOUT_ROUTER = "0xccc88a9d1b4ed6b0eaba998850414b24f1c315be";
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
function invalid() { throw new ApnError("APN_RPC_PROTOCOL", "Polygon exhaustive trace or recipient balance binding failed."); }
export function decodePolygonPayoutTrace(value, transaction, hash, blockHash, before, after) {
    const root = evmRpcRecord(value);
    if (root.type !== "CALL" || root.error !== undefined || root.revertReason !== undefined ||
        !same(evmRpcHex(transaction.hash, 32), hash) || !same(evmRpcHex(transaction.blockHash, 32), blockHash) ||
        evmRpcQuantity(transaction.chainId) !== 137n || !same(evmRpcAddress(transaction.to), POLYGON_PAYOUT_ROUTER) ||
        evmRpcQuantity(transaction.value) !== 0n || !same(evmRpcAddress(root.from), evmRpcAddress(transaction.from)) ||
        !same(evmRpcAddress(root.to), POLYGON_PAYOUT_ROUTER) || evmRpcQuantity(root.value) !== 0n ||
        evmRpcHex(root.input) !== evmRpcHex(transaction.input))
        invalid();
    const transfers = [];
    let nodes = 0;
    function visit(value, depth, reverted) {
        if (++nodes > 2048 || depth > 64)
            invalid();
        const node = evmRpcRecord(value), type = node.type;
        if (!["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE"].includes(String(type)) ||
            node.error !== undefined && typeof node.error !== "string" || node.revertReason !== undefined && typeof node.revertReason !== "string")
            invalid();
        const from = evmRpcAddress(node.from), to = evmRpcAddress(node.to);
        evmRpcHex(node.input);
        if (node.output !== undefined)
            evmRpcHex(node.output);
        evmRpcQuantity(node.gas);
        evmRpcQuantity(node.gasUsed);
        const amount = node.value === undefined && type === "STATICCALL" ? 0n : evmRpcQuantity(node.value);
        if (type === "STATICCALL" && amount !== 0n)
            invalid();
        const failed = reverted || node.error !== undefined || node.revertReason !== undefined;
        if (!failed && type === "CALL" && amount > 0n)
            transfers.push({ from, to, valueWei: amount });
        if (node.calls !== undefined && !Array.isArray(node.calls))
            invalid();
        for (const child of (node.calls ?? [])) {
            const nested = evmRpcRecord(child);
            // Delegate execution retains its caller's context. Other edges must begin at the called account.
            if (!same(evmRpcAddress(nested.from), type === "DELEGATECALL" || type === "CALLCODE" ? from : to))
                invalid();
            visit(child, depth + 1, failed);
        }
    }
    visit(root, 0, false);
    const credits = transfers.filter(t => same(t.to, RELAY_BNB_SOURCE));
    if (credits.length !== 1 || transfers.some(t => same(t.from, RELAY_BNB_SOURCE)) ||
        before < 0n || after - before !== credits[0].valueWei)
        invalid();
    return { transactionHash: hash.toLowerCase(), blockHash: blockHash.toLowerCase(), complete: true,
        revertedCallsExcluded: true, transfers };
}
//# sourceMappingURL=polygon-trace.js.map