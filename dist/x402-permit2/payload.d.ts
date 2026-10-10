import type { Hex } from "../model.js";
import { type X402PaymentRequired, type X402PaymentPayload } from "../x402-codec.js";
import { type Permit2ExecutionIntent } from "./execution-intent.js";
import { type Permit2PreparedMaterial } from "./prepare.js";
export interface Permit2PayloadInput {
    readonly intent: Permit2ExecutionIntent;
    readonly prepared: Permit2PreparedMaterial;
    readonly challenge: X402PaymentRequired;
    readonly permit2Signature: Hex;
    readonly eip2612Signature?: Hex;
    readonly nowSeconds: number;
}
/** Pure assembly of already signed, immutable material. This does not reserve, sign, or submit a payment. */
export declare function assemblePermit2PaymentPayload(input: Permit2PayloadInput): Promise<{
    readonly payload: X402PaymentPayload;
    readonly paymentSignatureHeader: string;
}>;
