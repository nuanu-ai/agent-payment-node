import { canonicalJson, sha256 } from "../canonical.js";
import { BridgeHttps } from "./https.js";
import { railStatusIdentifier } from "../rail-status-binding.js";
import { BRIDGE_ASSET_REGISTRY, BRIDGE_CHAINS, bridgePeerToken, validateBridgeRequest } from "./asset-registry.js";
import { BASE_SOLANA_USDC_CANDIDATE, BASE_TRON_USDT_CANDIDATE } from "./discovery-candidates.js";
import { validateBridgeInventoryCandidate } from "./catalog.js";
import { bridgeFailure, bridgeJson, bridgeRecord } from "./validation.js";
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
        const pairs = BRIDGE_CHAINS.flatMap((from) => BRIDGE_ASSET_REGISTRY[from].tokens.flatMap((asset) => asset.peers.map((to) => ({ from, to, fromToken: asset.address, toToken: bridgePeerToken(asset, to).address }))));
        const [chains, tokens, tools, connections] = await Promise.all([
            this.get("/chains", { chainTypes: "EVM" }, LIFI_INVENTORY_RESPONSE_BYTES),
            this.get("/tokens", { chains: BRIDGE_CHAINS.join(",") }, LIFI_INVENTORY_RESPONSE_BYTES),
            this.get("/tools", { chains: BRIDGE_CHAINS.map(String) }, LIFI_INVENTORY_RESPONSE_BYTES),
            Promise.all(pairs.map(async ({ from, to, fromToken, toToken }) => {
                const response = await this.get("/connections", { fromChain: String(from), toChain: String(to), fromToken,
                    toToken, allowSwitchChain: "false", allowDestinationCall: "false" }, LIFI_INVENTORY_RESPONSE_BYTES);
                return { fromChainId: from, toChainId: to, fromToken, toToken, status: response.status, responseHash: sha256(response.body),
                    response: bridgeJson(response.body, LIFI_INVENTORY_RESPONSE_BYTES) };
            })),
        ]);
        // This unadmitted candidate cannot make the established EVM inventory fail.
        const candidate = BASE_SOLANA_USDC_CANDIDATE;
        const candidateIdentity = { fromChainId: candidate.fromChainId, toChainId: candidate.toChainId,
            fromToken: candidate.fromToken, toToken: candidate.toToken };
        let candidateConnection;
        try {
            const response = await this.get("/connections", { fromChain: String(candidate.fromChainId), toChain: String(candidate.toChainId),
                fromToken: candidate.fromToken, toToken: candidate.toToken, allowSwitchChain: "false", allowDestinationCall: "false" }, LIFI_INVENTORY_RESPONSE_BYTES);
            if (response.status !== 200)
                throw new Error("Candidate connection is unavailable.");
            const candidateResponse = bridgeRecord(bridgeJson(response.body, LIFI_INVENTORY_RESPONSE_BYTES));
            validateBridgeInventoryCandidate(candidateResponse);
            candidateConnection = { ...candidateIdentity, status: response.status, responseHash: sha256(response.body),
                response: candidateResponse };
            bridgeJson(canonicalJson({ pairs: [...connections, candidateConnection] }), LIFI_INVENTORY_RESPONSE_BYTES);
        }
        catch {
            candidateConnection = { ...candidateIdentity, status: "unavailable", responseHash: null, response: null };
        }
        const optionalPairs = [candidateConnection];
        const tron = BASE_TRON_USDT_CANDIDATE;
        const tronIdentity = { fromChainId: tron.fromChainId, toChainId: tron.toChainId,
            fromToken: tron.fromToken, toToken: tron.toToken, tool: tron.tool };
        let tronConnection;
        try {
            const [tronChains, tronTokens, tronTools, tronPair] = await Promise.all([
                this.get("/chains", { chainTypes: "TVM" }, LIFI_INVENTORY_RESPONSE_BYTES),
                this.get("/tokens", { chains: String(tron.toChainId) }, LIFI_INVENTORY_RESPONSE_BYTES),
                this.get("/tools", { chains: [String(tron.fromChainId), String(tron.toChainId)] }, LIFI_INVENTORY_RESPONSE_BYTES),
                this.get("/connections", { fromChain: String(tron.fromChainId), toChain: String(tron.toChainId),
                    fromToken: tron.fromToken, toToken: tron.toToken, allowBridges: tron.tool,
                    allowSwitchChain: "false", allowDestinationCall: "false" }, LIFI_INVENTORY_RESPONSE_BYTES),
            ]);
            for (const result of [tronChains, tronTokens, tronTools, tronPair])
                if (result.status !== 200)
                    throw new Error("TRON candidate inventory unavailable.");
            const chainRows = bridgeRecord(bridgeJson(tronChains.body, LIFI_INVENTORY_RESPONSE_BYTES)).chains;
            const tokenRows = bridgeRecord(bridgeRecord(bridgeJson(tronTokens.body, LIFI_INVENTORY_RESPONSE_BYTES)).tokens)[String(tron.toChainId)];
            const toolRows = bridgeRecord(bridgeJson(tronTools.body, LIFI_INVENTORY_RESPONSE_BYTES)).bridges;
            const pairBody = bridgeRecord(bridgeJson(tronPair.body, LIFI_INVENTORY_RESPONSE_BYTES));
            validateBridgeInventoryCandidate(pairBody);
            if (!Array.isArray(chainRows) || !chainRows.some((entry) => {
                const row = bridgeRecord(entry);
                return row.id === tron.toChainId && row.key === "trn" && row.chainType === "TVM" && row.mainnet === true;
            }) || !Array.isArray(tokenRows) || !tokenRows.some((entry) => {
                const row = bridgeRecord(entry);
                return row.chainId === tron.toChainId && row.address === tron.toToken && row.symbol === "USDT" && row.decimals === 6;
            }) || !Array.isArray(toolRows) || !toolRows.some((entry) => {
                const row = bridgeRecord(entry);
                return row.key === tron.tool && Array.isArray(row.supportedChains) && row.supportedChains.some((supported) => {
                    const pair = bridgeRecord(supported);
                    return pair.fromChainId === tron.fromChainId && pair.toChainId === tron.toChainId;
                });
            }) || !Array.isArray(pairBody.connections) || !pairBody.connections.some((entry) => {
                const row = bridgeRecord(entry);
                return row.fromChainId === tron.fromChainId && row.toChainId === tron.toChainId &&
                    Array.isArray(row.fromTokens) && row.fromTokens.some((token) => {
                    const asset = bridgeRecord(token);
                    return asset.address === tron.fromToken && asset.chainId === tron.fromChainId;
                }) && Array.isArray(row.toTokens) && row.toTokens.some((token) => {
                    const asset = bridgeRecord(token);
                    return asset.address === tron.toToken && asset.chainId === tron.toChainId;
                });
            }))
                throw new Error("TRON candidate identity unavailable.");
            tronConnection = { ...tronIdentity, status: 200, responseHash: sha256(canonicalJson([tronChains.body, tronTokens.body, tronTools.body, tronPair.body])), response: pairBody };
        }
        catch {
            tronConnection = { ...tronIdentity, status: "unavailable", responseHash: null, response: null };
        }
        optionalPairs.push(tronConnection);
        let body = canonicalJson({ pairs: [...connections, ...optionalPairs] });
        if (Buffer.byteLength(body, "utf8") > LIFI_INVENTORY_RESPONSE_BYTES && tronConnection.status === 200) {
            optionalPairs[1] = { ...tronIdentity, status: "unavailable", responseHash: null, response: null };
            body = canonicalJson({ pairs: [...connections, ...optionalPairs] });
        }
        if (Buffer.byteLength(body, "utf8") > LIFI_INVENTORY_RESPONSE_BYTES) {
            optionalPairs.pop();
            body = canonicalJson({ pairs: [...connections, ...optionalPairs] });
        }
        // A full admitted inventory may leave no room for either optional candidate.
        if (Buffer.byteLength(body, "utf8") > LIFI_INVENTORY_RESPONSE_BYTES && candidateConnection.status === 200) {
            optionalPairs[0] = { ...candidateIdentity, status: "unavailable", responseHash: null, response: null };
            body = canonicalJson({ pairs: [...connections, ...optionalPairs] });
        }
        if (Buffer.byteLength(body, "utf8") > LIFI_INVENTORY_RESPONSE_BYTES) {
            body = canonicalJson({ pairs: connections });
        }
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
                destinationTransactionHash = bridgeStatusIdentifier(receiving.txHash);
        }
        return { status, destinationTransactionHash, responseHash, observedAt };
    }
    catch {
        return { status: response.status === 404 ? "not_found" : "unknown", destinationTransactionHash: null, responseHash, observedAt };
    }
}
/**
 * The provider names the destination transaction in its own rail's form. An EVM hash must still be
 * a 32-byte hash; a Solana signature is accepted as itself. Anything else is refused, never widened.
 */
function bridgeStatusIdentifier(value) {
    const identifier = railStatusIdentifier(value);
    if (identifier === null)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "rail_status_identity");
    return identifier;
}
//# sourceMappingURL=provider.js.map