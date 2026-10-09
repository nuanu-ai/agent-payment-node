import { HISTORICAL_LINEA_OPERATION, HISTORICAL_MONAD_OPERATION } from "./historical-paid-source.js";
import { canonicalJson } from "../canonical.js";
import { circleBlocked } from "./operation-model.js";
import { CircleExternalRpc, type CircleExternalRpcBudget } from "./external-rpc.js";
/** Exact historical completion only. Memoization never persists or bypasses physical reanchors. */
export class HistoricalPaidRpc extends CircleExternalRpc {
  private readonly cache = new Map<string, string>();
  private logical = 0; private hits = 0; private physical = 0;
  constructor(private readonly exactEndpoint: string, chain: number, private readonly historicalBudget: CircleExternalRpcBudget, operationId: string) { super(exactEndpoint, chain, historicalBudget); if (operationId !== HISTORICAL_LINEA_OPERATION && operationId !== HISTORICAL_MONAD_OPERATION || chain !== 42161 && chain !== (operationId === HISTORICAL_LINEA_OPERATION ? 59144 : 143)) circleBlocked("historical_paid_rpc_exact_scope"); }
  assertReadDeadline(): void { this.historicalBudget.assert(); }
  counts() { return Object.freeze({ logical: this.logical, hits: this.hits, physical: this.physical, entries: this.cache.size }); }
  override async call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown> {
    const copied = structuredClone(params); const freeze = (x: unknown): void => { if (x !== null && typeof x === "object") { Object.values(x).forEach(freeze); Object.freeze(x); } }; freeze(copied); params = copied;
    this.assertReadDeadline(); if (beforeSend !== undefined) circleBlocked("historical_paid_financial_rpc_forbidden"); this.logical++;
    const selector = params[method === "eth_getStorageAt" ? 2 : 1], canonical = selector !== null && typeof selector === "object" && !Array.isArray(selector) && Object.keys(selector).length === 2 && Object.hasOwn(selector, "blockHash") && Object.hasOwn(selector, "requireCanonical") && (selector as { requireCanonical: unknown }).requireCanonical === true && typeof (selector as { blockHash: unknown }).blockHash === "string" && /^0x[a-fA-F0-9]{64}$/u.test((selector as { blockHash: string }).blockHash) && BigInt((selector as { blockHash: string }).blockHash) !== 0n;
    const key = ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(method) && canonical ? canonicalJson({ endpoint: this.exactEndpoint, chain: this.chainId, method, params }) : null;
    if (key !== null && this.cache.has(key)) { this.hits++; this.assertReadDeadline(); return this.cache.get(key)!; }
    this.physical++; const result = await super.call(method, params); this.assertReadDeadline();
    if (key !== null && typeof result === "string" && /^0x(?:[a-fA-F0-9]{2})*$/u.test(result) && result.length <= 32770) { if (this.cache.size >= 160 && !this.cache.has(key)) circleBlocked("historical_paid_cache_budget"); this.cache.set(key, result); }
    return result;
  }
}
