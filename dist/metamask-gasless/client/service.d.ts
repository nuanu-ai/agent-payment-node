import { type FetchExchange } from "./network.js";
import { type HelperResponse } from "./protocol.js";
export interface HelperExecutionOptions {
    readonly homeDirectory?: string;
    readonly now?: () => Date;
    readonly exchange?: FetchExchange;
}
export declare function executeHelperRequest(input: unknown, options?: HelperExecutionOptions): Promise<HelperResponse>;
export type { HelperRequest, HelperResponse, HelperResult } from "./protocol.js";
