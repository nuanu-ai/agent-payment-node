import type { NativeRequest } from "./ports.js";
import type { VerifiedX402PaymentMaterial } from "./x402-native.js";
import { type X402Permit2Terms } from "./x402-permit2-exact.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
/** The Permit2 operation's frozen terms: its EIP-3009-shaped authorization is the witness transfer. */
export declare function x402Permit2Terms(operation: X402OperationRecord): X402Permit2Terms;
/** Custody request for a Permit2 witness transfer: the same frozen binding as EIP-3009, the Permit2 terms instead of a token domain. */
export declare function x402Permit2NativeRequest(requestId: string, operation: X402OperationRecord, kind: "create" | "get"): NativeRequest;
/** Both signatures must recover the frozen payer over typed data rebuilt from the record; the wire is built from the same terms. */
export declare function verifyX402Permit2Material(value: unknown, operation: X402OperationRecord): Promise<VerifiedX402PaymentMaterial>;
