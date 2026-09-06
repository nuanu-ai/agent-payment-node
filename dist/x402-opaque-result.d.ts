import type { PaidHttpResult } from "./x402-http.js";
import type { HttpObservation } from "./x402-model.js";
export declare function opaqueHttpResult(raw: HttpObservation): PaidHttpResult["result"];
export declare function parseResultMediaType(value: string): string;
