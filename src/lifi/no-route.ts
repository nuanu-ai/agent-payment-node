import { isPlainRecord } from "../canonical.js";
import { bridgeDestinationChain, bridgeQuoteDestination, BRIDGE_ASSET_REGISTRY } from "./asset-registry.js";
import type { BridgeRouteRequest } from "./model.js";
import { LIFI_ROUTES_ENDPOINT, lifiRouteTools } from "./provider.js";

/** At most this many provider rows of each kind are shown; the rest are counted. */
const ROWS = 8;
/** Provider text is shown, never interpreted: control characters become spaces and each field is bounded. */
const TEXT = 240;

export interface BridgeNoRouteFilteredRow { readonly path: string; readonly reason: string }
export interface BridgeNoRouteFailedRow {
  readonly path: string; readonly step: string; readonly tool: string; readonly error_type: string; readonly code: string; readonly message: string;
}
/**
 * Why `bridge routes` lists nothing: LI.FI's own answer to the exact request APN sent. APN drops no returned route (every
 * route LI.FI returns is listed, preparable or with its gate), so an empty list is the provider's: `filtered_out` and
 * `failed` are LI.FI's `unavailableRoutes` rows, and `provider_reported` says whether it sent that object at all.
 */
export interface BridgeNoRouteEvidence {
  readonly reason: "provider_returned_no_route";
  readonly provider: "lifi"; readonly endpoint: string;
  readonly from_chain: string; readonly to_chain: string; readonly from_token: string; readonly to_token: string; readonly amount_atomic: string;
  readonly requested_tools: { readonly bridges: readonly string[]; readonly exchanges: readonly string[]; readonly allow_destination_call: boolean };
  readonly provider_reported: boolean;
  readonly filtered_out: readonly BridgeNoRouteFilteredRow[];
  readonly failed: readonly BridgeNoRouteFailedRow[];
  readonly omitted_rows: number;
}

export function bridgeNoRouteEvidence(rawResponse: string, request: BridgeRouteRequest): BridgeNoRouteEvidence {
  const tools = lifiRouteTools(request), filtered: BridgeNoRouteFilteredRow[] = [], failed: BridgeNoRouteFailedRow[] = [];
  let reported = false, omitted = 0;
  let body: unknown;
  try { body = JSON.parse(rawResponse); } catch { body = null; }
  const unavailable = isPlainRecord(body) ? body.unavailableRoutes : undefined;
  if (isPlainRecord(unavailable) && Array.isArray(unavailable.filteredOut) && Array.isArray(unavailable.failed)) {
    reported = true;
    for (const row of unavailable.filteredOut) {
      if (filtered.length >= ROWS) { omitted++; continue; }
      filtered.push({ path: text(isPlainRecord(row) ? row.overallPath : undefined), reason: text(isPlainRecord(row) ? row.reason : undefined) });
    }
    for (const row of unavailable.failed) {
      const path = text(isPlainRecord(row) ? row.overallPath : undefined), errors: [string, Record<string, unknown>][] = [];
      if (isPlainRecord(row) && isPlainRecord(row.subpaths)) for (const [step, list] of Object.entries(row.subpaths))
        if (Array.isArray(list)) for (const error of list) errors.push([step, isPlainRecord(error) ? error : {}]);
      if (errors.length === 0) errors.push(["", {}]);
      for (const [step, e] of errors) {
        if (failed.length >= ROWS) { omitted++; continue; }
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
function caip2(chainId: number): string {
  const id = bridgeDestinationChain(chainId);
  return id in BRIDGE_ASSET_REGISTRY ? BRIDGE_ASSET_REGISTRY[id].caip2 : bridgeQuoteDestination(id).caip2;
}
function text(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/gu, " ");
  return clean.length > TEXT ? `${clean.slice(0, TEXT)}…` : clean;
}
