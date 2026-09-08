import { canonicalJson, sha256 } from "../canonical.js";
import { BridgeHttps } from "./https.js";
import { BRIDGE_CHAINS, BRIDGE_USDC, bridgeHex, bridgeJson, bridgeRecord, validateBridgeRequest } from "./validation.js";
const ORIGIN = "https://li.quest/v1";
export const LIFI_ROUTE_RESPONSE_BYTES = 512 * 1024;
export const LIFI_INVENTORY_RESPONSE_BYTES = 4 * 1024 * 1024;
export class LifiProvider {
    transport;
    now;
    constructor(transport = new BridgeHttps(), now = Date.now) {
        this.transport = transport;
        this.now = now;
    }
    async inventory() {
        const pairs = BRIDGE_CHAINS.flatMap((from) => BRIDGE_CHAINS.filter((to) => to !== from).map((to) => ({ from, to })));
        const [chains, tokens, tools, connections] = await Promise.all([
            this.get("/chains", { chainTypes: "EVM" }, LIFI_INVENTORY_RESPONSE_BYTES),
            this.get("/tokens", { chains: BRIDGE_CHAINS.join(",") }, LIFI_INVENTORY_RESPONSE_BYTES),
            this.get("/tools", { chains: BRIDGE_CHAINS.map(String) }, LIFI_INVENTORY_RESPONSE_BYTES),
            Promise.all(pairs.map(async ({ from, to }) => {
                const response = await this.get("/connections", { fromChain: String(from), toChain: String(to), fromToken: BRIDGE_USDC[from],
                    toToken: BRIDGE_USDC[to], allowSwitchChain: "false", allowDestinationCall: "false" }, LIFI_INVENTORY_RESPONSE_BYTES);
                return { fromChainId: from, toChainId: to, status: response.status, responseHash: sha256(response.body),
                    response: bridgeJson(response.body, LIFI_INVENTORY_RESPONSE_BYTES) };
            })),
        ]);
        const body = canonicalJson({ pairs: connections });
        bridgeJson(body, LIFI_INVENTORY_RESPONSE_BYTES);
        return { chains, tokens, tools, connections: { status: 200, body } };
    }
    async routes(request, sender) {
        validateBridgeRequest(request);
        return await this.transport.request(`${ORIGIN}/advanced/routes`, "POST", canonicalJson({
            fromChainId: request.fromChainId, toChainId: request.toChainId, fromTokenAddress: request.fromToken,
            toTokenAddress: request.toToken, fromAmount: request.amountAtomic, fromAddress: sender, toAddress: request.recipient,
            options: { slippage: request.slippageBps / 10_000, allowSwitchChain: false, allowDestinationCall: false,
                executionType: "transaction", gasless: false, fee: 0, integrator: "lifi-api",
                bridges: { allow: ["across", "stargateV2"] }, exchanges: { allow: [] } },
        }), LIFI_ROUTE_RESPONSE_BYTES, "APN_HTTP_CONFIG");
    }
    async materialize(step) {
        return await this.transport.request(`${ORIGIN}/advanced/stepTransaction`, "POST", canonicalJson(step), LIFI_ROUTE_RESPONSE_BYTES, "APN_HTTP_CONFIG");
    }
    async status(input) {
        let response;
        try {
            response = await this.get("/status", { txHash: input.transactionHash, bridge: input.tool,
                fromChain: String(input.fromChainId), toChain: String(input.toChainId) }, 64 * 1024);
        }
        catch {
            return { status: "unknown", destinationTransactionHash: null, observedAt: new Date(this.now()).toISOString(), responseHash: null };
        }
        return normalizeLifiStatus(response, new Date(this.now()).toISOString());
    }
    async get(path, parameters, limit) {
        const query = new URLSearchParams();
        for (const [name, value] of Object.entries(parameters))
            for (const entry of typeof value === "string" ? [value] : value)
                query.append(name, entry);
        return await this.transport.request(`${ORIGIN}${path}?${query}`, "GET", null, limit, "APN_HTTP_CONFIG");
    }
}
export function normalizeLifiStatus(response, observedAt) {
    const responseHash = sha256(response.body);
    try {
        const r = bridgeRecord(bridgeJson(response.body, 64 * 1024));
        let status = "unknown";
        if (response.status === 404 || r.code === 1003 || r.status === "NOT_FOUND")
            status = "not_found";
        else if (response.status === 200) {
            if (r.status === "PENDING")
                status = "pending";
            else if (r.status === "FAILED")
                status = "failed_observed";
            else if (r.status === "DONE") {
                if (r.substatus === "COMPLETED")
                    status = "completed_observed";
                else if (r.substatus === "PARTIAL")
                    status = "partial_observed";
                else if (r.substatus === "REFUNDED")
                    status = "refund_observed";
            }
        }
        let destinationTransactionHash = null;
        if (r.receiving !== undefined && r.receiving !== null) {
            const receiving = bridgeRecord(r.receiving);
            if (receiving.txHash !== undefined)
                destinationTransactionHash = bridgeHex(receiving.txHash, 32, 32);
        }
        return { status, destinationTransactionHash, responseHash, observedAt };
    }
    catch {
        return { status: response.status === 404 ? "not_found" : "unknown", destinationTransactionHash: null, responseHash, observedAt };
    }
}
//# sourceMappingURL=provider.js.map