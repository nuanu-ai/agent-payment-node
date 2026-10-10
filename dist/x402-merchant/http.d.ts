import type { HttpGetRequest, HttpObservation, HttpPort } from "../x402-model.js";
/** Finite vendor HTTP transport: one URL, no redirects/retries, DNS pin, bounded bytes, canonical v2 proof. */
export declare class MerchantHttp implements HttpPort {
    get(input: HttpGetRequest): Promise<HttpObservation>;
}
