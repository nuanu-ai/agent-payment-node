import type { Address } from "../model.js";
import { type X402HttpRequestV1 } from "../x402-http-request.js";
import type { HttpPort } from "../x402-model.js";
import { type Permit2CheckedChallenge } from "./checked-challenge.js";
/** Internal private inspection reuses the existing target, DNS, TLS, header and offer checks. */
export declare function inspectCheckedPermit2Challenge(http: HttpPort, request: X402HttpRequestV1, payer: Address): Promise<Permit2CheckedChallenge>;
