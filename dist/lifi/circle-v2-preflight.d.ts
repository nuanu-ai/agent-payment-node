import { type CircleV2UpfrontInput } from "./circle-v2-upfront-offline.js";
declare const ABI_SIGNATURE = "depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes,address))";
declare const VALIDATE_URL = "https://iris-api.circle.com/v2/quote/validate/usdc/6";
type Request = {
    readonly target: "circle";
    readonly url: typeof VALIDATE_URL;
    readonly body: {
        readonly abiSignature: typeof ABI_SIGNATURE;
        readonly args: readonly (string | readonly string[])[];
    };
} | {
    readonly target: "base";
    readonly method: "eth_getBlockByNumber" | "eth_call";
    readonly params: readonly unknown[];
};
export type CircleV2PreflightTransport = (request: Request) => Promise<unknown>;
export interface CircleV2PreflightInput extends CircleV2UpfrontInput {
    readonly payer: string;
}
export interface CircleV2PreflightSnapshot {
    readonly kind: "circle_v2_preflight_snapshot";
    readonly executionAdmitted: false;
    readonly blockNumber: string;
    readonly blockHash: string;
    readonly abiSignature: typeof ABI_SIGNATURE;
}
/** Circle checks its own current tip; Base simulation is pinned to a separate canonical block observation. Neither authorizes execution. */
export declare function inspectCircleV2Preflight(input: CircleV2PreflightInput, transport: CircleV2PreflightTransport): Promise<CircleV2PreflightSnapshot>;
export {};
