import { ApnError, type ErrorDetails } from "../errors.js";
/** The setting the Circle commands read for a chain's RPC (funding-runtime.ts and funding-external-adoption.ts). */
export declare function circleRpcSetting(chainId: number): string;
/** An HTTP status other than 200, named in `httpStatus` as in the other RPC families. */
export declare function circleHttpRefusal(label: string, status: number, method: string, setting: string, details: ErrorDetails): ApnError;
/**
 * The JSON-RPC error an HTTP 200 body carries for this id, alone or as a batch row: the exact error member with an integer
 * code and a message, and no result. Null when the value is not one; the caller then checks the result envelope.
 */
export declare function circleJsonRpcRefusal(label: string, value: Record<string, unknown>, id: number, method: string, setting: string, details: ErrorDetails): ApnError | null;
