import type { PaidHttpResult } from "./x402-http.js";
import type { HttpObservation } from "./x402-model.js";
export declare function opaqueHttpResult(raw: HttpObservation): PaidHttpResult["result"];
/**
 * The seller body after payment. A body APN cannot keep (oversized, compressed, truncated or with an
 * unreadable media type) is withheld, never thrown: the PAYMENT-RESPONSE beside it must still be decoded.
 * JSON and UTF-8 text keep their text form; any other 200 body is kept as exact bytes (base64).
 */
export declare function observedPaidResult(raw: HttpObservation, opaque: boolean, maxBodyBytes: number): PaidHttpResult["result"];
export declare function parseResultMediaType(value: string): string;
