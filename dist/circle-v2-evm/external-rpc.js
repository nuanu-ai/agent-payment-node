import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { BridgeHttps } from "../lifi/https.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { circleBlocked } from "./operation-model.js";
import { circleRecord } from "./protocol.js";
import { CircleRpc } from "./rpc.js";
const METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getTransactionCount", "eth_getLogs"]);
/** One shared physical POST/deadline/concurrency budget for both public chains. No signing methods or retries. */
export class CircleExternalRpcBudget {
    now;
    endsAt;
    transport;
    requests = 0;
    inFlight = 0;
    waiters = [];
    evidence = [];
    constructor(now, endsAt, transport) {
        this.now = now;
        this.endsAt = endsAt;
        this.transport = transport;
    }
    assert() { if (this.now() >= this.endsAt)
        circleBlocked("external_read_deadline"); }
    async post(endpoint, chain, id, method, params) {
        this.assert();
        if (!METHODS.has(method) || ++this.requests > 160)
            circleBlocked("external_read_budget_or_method");
        if (this.inFlight >= 4)
            await new Promise(resolve => this.waiters.push(resolve));
        else
            this.inFlight++;
        try {
            this.assert();
            const response = await this.transport.request(endpoint, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }), 1024 * 1024, "APN_RPC_CONFIG", () => this.assert());
            this.assert();
            if (response.status !== 200)
                throw new ApnError("APN_RPC_CONFIG", "External Circle proof RPC HTTP failure.");
            const value = circleRecord(JSON.parse(response.body));
            if (value.jsonrpc !== "2.0" || value.id !== id || !Object.hasOwn(value, "result") || Object.hasOwn(value, "error"))
                throw new ApnError("APN_RPC_PROTOCOL", "External Circle proof RPC envelope failure.");
            this.evidence.push({ chain, method, params, result: value.result });
            return value.result;
        }
        finally {
            const next = this.waiters.shift();
            if (next === undefined)
                this.inFlight--;
            else
                next();
        }
    }
}
export class CircleExternalRpc extends CircleRpc {
    budget;
    id = 0;
    count = 0;
    publicEndpoint;
    constructor(url, chain, budget) {
        super(url, chain);
        this.budget = budget;
        const p = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "External Circle RPC", 2048);
        if (p.search !== "" || p.hash !== "")
            circleBlocked("external_rpc_url");
        this.publicEndpoint = p.toString();
    }
    async call(method, params, beforeSend) {
        if (beforeSend !== undefined || ++this.count > 128)
            circleBlocked("external_rpc_financial_or_origin_budget");
        if (method === "eth_getLogs") {
            const q = circleRecord(params[0]);
            if (params.length !== 1 || typeof q.blockHash !== "string" || q.fromBlock !== undefined || q.toBlock !== undefined)
                circleBlocked("external_logs_exact_block_required");
        }
        return this.budget.post(this.publicEndpoint, this.chainId, ++this.id, method, params);
    }
}
//# sourceMappingURL=external-rpc.js.map