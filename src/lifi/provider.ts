import { canonicalJson, sha256 } from "../canonical.js";
import type { Address } from "../model.js";
import { BridgeHttps } from "./https.js";
import type { BridgeProviderObservation, BridgeRouteRequest } from "./model.js";
import type { LifiProviderPort, LifiResponse } from "./ports.js";
import { BRIDGE_ASSET_REGISTRY, BRIDGE_CHAINS, bridgePeerToken, validateBridgeRequest } from "./asset-registry.js";
import { bridgeHex, bridgeJson, bridgeRecord } from "./validation.js";

const ORIGIN = "https://li.quest/v1";
export const LIFI_ROUTE_RESPONSE_BYTES = 512 * 1024;
export const LIFI_INVENTORY_RESPONSE_BYTES = 4 * 1024 * 1024;
export interface LifiTransport { request(endpoint: string, method: "GET" | "POST", body: string | null,
  maximumBytes: number, code: "APN_HTTP_CONFIG"): Promise<LifiResponse> }
export class LifiProvider implements LifiProviderPort {
  constructor(private readonly transport: LifiTransport = new BridgeHttps(), private readonly now: () => number = Date.now) {}
  async inventory(): Promise<Readonly<Record<"chains" | "tokens" | "tools" | "connections", LifiResponse>>> {
    const pairs = BRIDGE_CHAINS.flatMap((from) => BRIDGE_ASSET_REGISTRY[from].tokens.flatMap((asset) =>
      asset.peers.map((to) => ({ from, to, fromToken: asset.address, toToken: bridgePeerToken(asset, to).address }))));
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
    const body = canonicalJson({ pairs: connections });
    bridgeJson(body, LIFI_INVENTORY_RESPONSE_BYTES);
    return { chains, tokens, tools, connections: { status: 200, body } };
  }
  async routes(request: BridgeRouteRequest, sender: Address): Promise<LifiResponse> {
    validateBridgeRequest(request);
    return await this.transport.request(`${ORIGIN}/advanced/routes`, "POST", canonicalJson({
      fromChainId: request.fromChainId, toChainId: request.toChainId, fromTokenAddress: request.fromToken,
      toTokenAddress: request.toToken, fromAmount: request.amountAtomic, fromAddress: sender, toAddress: request.recipient,
      options: { slippage: request.slippageBps / 10_000, allowSwitchChain: false, allowDestinationCall: false,
        executionType: "transaction", gasless: false, fee: 0, integrator: "lifi-api",
        bridges: { allow: ["across", "stargateV2"] }, exchanges: { allow: [] } },
    }), LIFI_ROUTE_RESPONSE_BYTES, "APN_HTTP_CONFIG");
  }
  async materialize(step: Readonly<Record<string, unknown>>): Promise<LifiResponse> {
    return await this.transport.request(`${ORIGIN}/advanced/stepTransaction`, "POST", canonicalJson(step), LIFI_ROUTE_RESPONSE_BYTES, "APN_HTTP_CONFIG");
  }
  async status(input: Parameters<LifiProviderPort["status"]>[0]): Promise<BridgeProviderObservation> {
    let response: LifiResponse;
    try {
      response = await this.get("/status", { txHash: input.transactionHash, bridge: input.tool,
        fromChain: String(input.fromChainId), toChain: String(input.toChainId) }, 64 * 1024);
    } catch { return { status: "unknown", destinationTransactionHash: null, observedAt: new Date(this.now()).toISOString(), responseHash: null }; }
    return normalizeLifiStatus(response, new Date(this.now()).toISOString());
  }
  private async get(path: "/chains" | "/tokens" | "/tools" | "/connections" | "/status", parameters: Record<string, string | readonly string[]>, limit: number): Promise<LifiResponse> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(parameters)) for (const entry of typeof value === "string" ? [value] : value) query.append(name, entry);
    return await this.transport.request(`${ORIGIN}${path}?${query}`, "GET", null, limit, "APN_HTTP_CONFIG");
  }
}
export function normalizeLifiStatus(response: LifiResponse, observedAt: string): BridgeProviderObservation {
  const responseHash = sha256(response.body);
  try {
    const r = bridgeRecord(bridgeJson(response.body, 64 * 1024));
    let status: BridgeProviderObservation["status"] = "unknown";
    if (response.status === 404 || r.code === 1003 || r.status === "NOT_FOUND") status = "not_found";
    else if (response.status === 200) {
      if (r.status === "PENDING") status = "pending";
      else if (r.status === "FAILED") status = "failed_observed";
      else if (r.status === "DONE") {
        if (r.substatus === "COMPLETED") status = "completed_observed";
        else if (r.substatus === "PARTIAL") status = "partial_observed";
        else if (r.substatus === "REFUNDED") status = "refund_observed";
      }
    }
    let destinationTransactionHash = null;
    if (r.receiving !== undefined && r.receiving !== null) {
      const receiving = bridgeRecord(r.receiving);
      if (receiving.txHash !== undefined) destinationTransactionHash = bridgeHex(receiving.txHash, 32, 32);
    }
    return { status, destinationTransactionHash, responseHash, observedAt };
  } catch { return { status: response.status === 404 ? "not_found" : "unknown", destinationTransactionHash: null, responseHash, observedAt }; }
}
