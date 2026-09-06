import type { X402ExecutionPort } from "./provider-ports.js";
import type { ProviderX402OperationRecord } from "./provider-x402-model.js";
import { type X402HttpRequestV1 } from "./x402-http-request.js";
export declare function providerHttpRequest(endpoint: URL, httpRequest?: X402HttpRequestV1): ProviderX402OperationRecord["request"];
export declare function validateProviderHttpRequest(request: ProviderX402OperationRecord["request"]): void;
export declare function assertProviderHttpRequest(port: X402ExecutionPort, request: X402HttpRequestV1 | undefined): void;
export declare function assertAwalHttpRequest(request: X402HttpRequestV1): void;
