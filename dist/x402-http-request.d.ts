import type { X402OperationRecord } from "./x402-state-model.js";
export interface X402HttpRequestV1 {
    readonly schemaVersion: "apn.http-request.v1";
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly bodyBase64: string | null;
}
export declare const X402_REQUEST_BODY_LIMIT: number;
export declare function decodeX402RequestBody(value: unknown): Buffer | undefined;
export declare function normalizeX402HttpRequest(value: unknown): X402HttpRequestV1;
export declare function optionalX402HttpRequest(url: string, value: unknown): X402HttpRequestV1 | undefined;
export declare function bindX402HttpRequest(options: Readonly<Record<string, string>>): {
    readonly httpRequest?: X402HttpRequestV1;
};
export declare function x402HttpRequestBinding(request: X402HttpRequestV1 | undefined): {
    readonly httpRequestHash?: string;
};
export declare function validateFrozenX402HttpRequest(url: string, value: unknown): void;
export declare function validateX402Resource(value: unknown): X402OperationRecord["resource"];
export declare function isX402ResultStatus(resource: unknown, status: unknown): boolean;
