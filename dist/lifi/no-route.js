import { isPlainRecord } from "../canonical.js";
import { bridgeDestinationChain, bridgeQuoteDestination, BRIDGE_ASSET_REGISTRY } from "./asset-registry.js";
import { LIFI_ROUTES_ENDPOINT, lifiRouteTools } from "./provider.js";
/** At most this many provider rows of each kind are shown; the rest are counted. */
const ROWS = 8;
/** Provider text is shown, never interpreted: control characters become spaces and each field is bounded. */
const TEXT = 240;
export function bridgeNoRouteEvidence(rawResponse, request) {
    const tools = lifiRouteTools(request), filtered = [], failed = [];
    let reported = false, omitted = 0;
    let body;
    try {
        body = JSON.parse(rawResponse);
    }
    catch {
        body = null;
    }
    const unavailable = isPlainRecord(body) ? body.unavailableRoutes : undefined;
    if (isPlainRecord(unavailable) && Array.isArray(unavailable.filteredOut) && Array.isArray(unavailable.failed)) {
        reported = true;
        for (const row of unavailable.filteredOut) {
            if (filtered.length >= ROWS) {
                omitted++;
                continue;
            }
            filtered.push({ path: text(isPlainRecord(row) ? row.overallPath : undefined), reason: text(isPlainRecord(row) ? row.reason : undefined) });
        }
        for (const row of unavailable.failed) {
            const path = text(isPlainRecord(row) ? row.overallPath : undefined), errors = [];
            if (isPlainRecord(row) && isPlainRecord(row.subpaths))
                for (const [step, list] of Object.entries(row.subpaths))
                    if (Array.isArray(list))
                        for (const error of list)
                            errors.push([step, isPlainRecord(error) ? error : {}]);
            if (errors.length === 0)
                errors.push(["", {}]);
            for (const [step, e] of errors) {
                if (failed.length >= ROWS) {
                    omitted++;
                    continue;
                }
                failed.push({ path, step: text(step), tool: text(e.tool), error_type: text(e.errorType), code: text(e.code), message: text(e.message) });
            }
        }
    }
    return { reason: "provider_returned_no_route", provider: "lifi", endpoint: `POST ${LIFI_ROUTES_ENDPOINT}`,
        from_chain: caip2(request.fromChainId), to_chain: caip2(request.toChainId), from_token: request.fromToken, to_token: request.toToken,
        amount_atomic: request.amountAtomic,
        requested_tools: { bridges: [...tools.bridges], exchanges: [...tools.exchanges], allow_destination_call: tools.allowDestinationCall },
        provider_reported: reported, filtered_out: filtered, failed, omitted_rows: omitted };
}
function caip2(chainId) {
    const id = bridgeDestinationChain(chainId);
    return id in BRIDGE_ASSET_REGISTRY ? BRIDGE_ASSET_REGISTRY[id].caip2 : bridgeQuoteDestination(id).caip2;
}
function text(value) {
    if (typeof value !== "string")
        return "";
    const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/gu, " ");
    return clean.length > TEXT ? `${clean.slice(0, TEXT)}…` : clean;
}
//# sourceMappingURL=no-route.js.map