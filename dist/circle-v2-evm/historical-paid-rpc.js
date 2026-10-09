import { HISTORICAL_LINEA_OPERATION, HISTORICAL_MONAD_OPERATION } from "./historical-paid-source.js";
import { canonicalJson } from "../canonical.js";
import { circleBlocked } from "./operation-model.js";
import { CircleExternalRpc } from "./external-rpc.js";
/** Exact historical completion only. Memoization never persists or bypasses physical reanchors. */
export class HistoricalPaidRpc extends CircleExternalRpc {
    exactEndpoint;
    historicalBudget;
    cache = new Map();
    logical = 0;
    hits = 0;
    physical = 0;
    constructor(exactEndpoint, chain, historicalBudget, operationId) {
        super(exactEndpoint, chain, historicalBudget);
        this.exactEndpoint = exactEndpoint;
        this.historicalBudget = historicalBudget;
        if (operationId !== HISTORICAL_LINEA_OPERATION && operationId !== HISTORICAL_MONAD_OPERATION || chain !== 42161 && chain !== (operationId === HISTORICAL_LINEA_OPERATION ? 59144 : 143))
            circleBlocked("historical_paid_rpc_exact_scope");
    }
    assertReadDeadline() { this.historicalBudget.assert(); }
    counts() { return Object.freeze({ logical: this.logical, hits: this.hits, physical: this.physical, entries: this.cache.size }); }
    async call(method, params, beforeSend) {
        const copied = structuredClone(params);
        const freeze = (x) => { if (x !== null && typeof x === "object") {
            Object.values(x).forEach(freeze);
            Object.freeze(x);
        } };
        freeze(copied);
        params = copied;
        this.assertReadDeadline();
        if (beforeSend !== undefined)
            circleBlocked("historical_paid_financial_rpc_forbidden");
        this.logical++;
        const selector = params[method === "eth_getStorageAt" ? 2 : 1], canonical = selector !== null && typeof selector === "object" && !Array.isArray(selector) && Object.keys(selector).length === 2 && Object.hasOwn(selector, "blockHash") && Object.hasOwn(selector, "requireCanonical") && selector.requireCanonical === true && typeof selector.blockHash === "string" && /^0x[a-fA-F0-9]{64}$/u.test(selector.blockHash) && BigInt(selector.blockHash) !== 0n;
        const key = ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(method) && canonical ? canonicalJson({ endpoint: this.exactEndpoint, chain: this.chainId, method, params }) : null;
        if (key !== null && this.cache.has(key)) {
            this.hits++;
            this.assertReadDeadline();
            return this.cache.get(key);
        }
        this.physical++;
        const result = await super.call(method, params);
        this.assertReadDeadline();
        if (key !== null && typeof result === "string" && /^0x(?:[a-fA-F0-9]{2})*$/u.test(result) && result.length <= 32770) {
            if (this.cache.size >= 160 && !this.cache.has(key))
                circleBlocked("historical_paid_cache_budget");
            this.cache.set(key, result);
        }
        return result;
    }
}
//# sourceMappingURL=historical-paid-rpc.js.map