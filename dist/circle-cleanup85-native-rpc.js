import { canonicalJson, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcWord } from "./evm-rpc-codec.js";
import { parsePublicHttpsUrl } from "./network-policy.js";
import { BridgeHttps } from "./lifi/https.js";
import { assertCleanup85PhysicalGuard } from "./circle-cleanup85-native-authority.js";
import { CLEANUP85_FEE_CAP, CLEANUP85_OWNER, CLEANUP85_RECIPIENT, CLEANUP85_REQUEST, cleanup85Blocked, cleanup85Envelope, validateCleanup85Envelope } from "./circle-cleanup85-native-codec.js";
import { CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./circle-v2-evm/catalog.js";
const READ = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionReceipt", "eth_getTransactionByHash"]);
const q = (n) => `0x${n.toString(16)}`;
const balanceData = `0x70a08231${CLEANUP85_OWNER.slice(2).toLowerCase().padStart(64, "0")}`;
const allowanceData = `0xdd62ed3e${CLEANUP85_OWNER.slice(2).toLowerCase().padStart(64, "0")}${CIRCLE_MESSENGER.slice(2).toLowerCase().padStart(64, "0")}`;
/** Separate finite transport: all physical requests count, including rejected responses.
 * Reads have no implicit retry; snapshot retries restart the entire anchored observation. */
export class Cleanup85NativeRpc {
    https;
    maximumRequests;
    now;
    calls = 0;
    sequence = 0;
    url;
    constructor(url, https = new BridgeHttps(), maximumRequests = 192, now = Date.now) {
        this.https = https;
        this.maximumRequests = maximumRequests;
        this.now = now;
        const parsed = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "Cleanup85 native RPC", 2048);
        if (parsed.search !== "" || parsed.hash !== "" || !Number.isSafeInteger(maximumRequests) || maximumRequests < 1 || maximumRequests > 192)
            cleanup85Blocked("rpc_configuration");
        this.url = parsed.toString();
    }
    async call(method, params, beforeSend) {
        if ((!READ.has(method) && method !== "eth_sendRawTransaction") || ++this.calls > this.maximumRequests)
            cleanup85Blocked("rpc_method_or_physical_budget");
        if (method === "eth_sendRawTransaction")
            assertCleanup85PhysicalGuard(beforeSend, params[0]);
        const id = ++this.sequence;
        const response = await this.https.request(this.url, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }), 1024 * 1024, "APN_RPC_CONFIG", beforeSend);
        if (response.status !== 200)
            throw new ApnError("APN_RPC_CONFIG", "Cleanup85 native RPC HTTP failure.", { httpStatus: response.status });
        let body;
        try {
            body = JSON.parse(response.body);
        }
        catch {
            cleanup85Blocked("rpc_json");
        }
        if (!isPlainRecord(body) || !exactKeys(body, ["jsonrpc", "id", "result"]) || body.jsonrpc !== "2.0" || body.id !== id)
            cleanup85Blocked("rpc_envelope");
        return body.result;
    }
    async identity() { if (evmRpcQuantity(await this.call("eth_chainId", [])) !== 42161n)
        cleanup85Blocked("rpc_chain"); }
    async block(tag) { return evmRpcBlockResult(await this.call("eth_getBlockByNumber", [tag, false]), tag); }
    async snapshot(frozen) {
        for (let attempt = 0;; attempt++) {
            try {
                return await this.snapshotOnce(frozen);
            }
            catch (error) {
                if (attempt >= 1 || !transient(error))
                    throw error;
            }
        }
    }
    async snapshotOnce(frozen) {
        await this.identity();
        const head = await this.block("latest"), tag = { blockHash: head.hash, requireCanonical: true };
        const [latest, pending, anchored, native, balance, allowance, oldReceipt, basePriority] = await Promise.all([
            this.call("eth_getTransactionCount", [CLEANUP85_OWNER, "latest"]), this.call("eth_getTransactionCount", [CLEANUP85_OWNER, "pending"]),
            this.call("eth_getTransactionCount", [CLEANUP85_OWNER, tag]), this.call("eth_getBalance", [CLEANUP85_OWNER, tag]),
            this.call("eth_call", [{ to: CIRCLE_SOURCE_TOKEN, data: balanceData }, tag]), this.call("eth_call", [{ to: CIRCLE_SOURCE_TOKEN, data: allowanceData }, tag]),
            this.call("eth_getTransactionReceipt", [CLEANUP85_REQUEST.oldCleanupTransactionHash]), this.call("eth_maxPriorityFeePerGas", []),
        ]);
        if ([latest, pending, anchored].some(x => evmRpcQuantity(x) !== 85n) || evmRpcWord(balance) !== 97924n || evmRpcWord(allowance) !== 40100n || oldReceipt !== null ||
            evmRpcQuantity(native) < CLEANUP85_FEE_CAP || BigInt(head.number) <= 513145262n)
            cleanup85Blocked("current_nonce_balance_allowance_or_old_receipt");
        const priority = evmRpcQuantity(basePriority), currentMax = evmRpcQuantity(head.raw.baseFeePerGas) * 2n + priority;
        const preliminary = frozen === undefined ? cleanup85Envelope("21000", currentMax.toString(), priority.toString()) : validateCleanup85Envelope(frozen);
        const gas = evmRpcQuantity(await this.call("eth_estimateGas", [{ type: "0x2", chainId: "0xa4b1", from: CLEANUP85_OWNER, to: CLEANUP85_RECIPIENT,
                value: "0x1", data: "0x", nonce: "0x55", maxFeePerGas: q(BigInt(preliminary.maxFeePerGasAtomic)), maxPriorityFeePerGas: q(BigInt(preliminary.maxPriorityFeePerGasAtomic)), accessList: [] }]));
        const envelope = frozen === undefined ? cleanup85Envelope((gas * 12n / 10n + 1n).toString(), currentMax.toString(), priority.toString()) : preliminary;
        if (gas > BigInt(envelope.gasLimitAtomic) || evmRpcQuantity(head.raw.baseFeePerGas) + BigInt(envelope.maxPriorityFeePerGasAtomic) > BigInt(envelope.maxFeePerGasAtomic) || priority > BigInt(envelope.maxPriorityFeePerGasAtomic))
            cleanup85Blocked("fresh_signed_envelope_inexecutable");
        if ((await this.block(head.tag)).hash !== head.hash)
            cleanup85Blocked("snapshot_reanchor");
        await this.identity();
        return { envelope, nativeBalanceAtomic: evmRpcQuantity(native).toString(), blockNumberAtomic: head.number, blockHash: head.hash, observedAt: this.now() };
    }
    async observation(hash) {
        await this.identity();
        const [transaction, receipt] = await Promise.all([this.call("eth_getTransactionByHash", [hash]), this.call("eth_getTransactionReceipt", [hash])]);
        if (transaction === null || receipt === null)
            return null;
        if (!isPlainRecord(receipt) || receipt.blockHash === null || receipt.blockNumber === null)
            return null;
        const tag = String(receipt.blockNumber), canonicalBlock = await this.block(tag), head = await this.block("finalized");
        if (BigInt(head.number) < BigInt(canonicalBlock.number))
            return null;
        const recheckedBlock = await this.block(tag);
        if ((await this.block(head.tag)).hash !== head.hash)
            cleanup85Blocked("finalized_head_reanchor");
        const current = await this.block("finalized");
        if (BigInt(current.number) < BigInt(head.number) || current.number === head.number && current.hash !== head.hash)
            cleanup85Blocked("finality_regression");
        await this.identity();
        return { transaction, receipt, canonicalBlock: canonicalBlock.raw, recheckedBlock: recheckedBlock.raw, finalityHead: head.raw, chainId: 42161, finalityTag: "finalized" };
    }
    async finalizedAccount(observation) {
        const head = evmRpcBlockResult(observation.finalityHead, "finalized"), tag = { blockHash: head.hash, requireCanonical: true };
        const [nonce, balance, allowance] = await Promise.all([this.call("eth_getTransactionCount", [CLEANUP85_OWNER, tag]), this.call("eth_call", [{ to: CIRCLE_SOURCE_TOKEN, data: balanceData }, tag]), this.call("eth_call", [{ to: CIRCLE_SOURCE_TOKEN, data: allowanceData }, tag])]);
        if (evmRpcQuantity(nonce) !== 86n || evmRpcWord(balance) !== 97924n || evmRpcWord(allowance) !== 40100n || (await this.block(head.tag)).hash !== head.hash)
            cleanup85Blocked("post_cancel_nonce_or_principal");
        await this.identity();
    }
}
function transient(error) {
    if (!(error instanceof ApnError))
        return false;
    const status = error.details?.httpStatus;
    return status === 429 || typeof status === "number" && status >= 500 && status <= 599 ||
        error.code === "APN_RPC_AMBIGUOUS" && ["request_interrupted", "response_interrupted", "response_aborted", "request_deadline", "DNS_deadline"].includes(String(error.details?.transportReason));
}
//# sourceMappingURL=circle-cleanup85-native-rpc.js.map