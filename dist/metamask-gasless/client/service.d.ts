import { type FetchExchange } from "./network.js";
import { type HelperResponse } from "./protocol.js";
export interface HelperExecutionOptions {
    readonly homeDirectory?: string;
    readonly now?: () => Date;
    readonly exchange?: FetchExchange;
    /** The helper process's watch of the APN command that spawned it (helper-entry.ts), checked right before a send is written. */
    readonly parentAlive?: () => boolean;
}
export declare function executeHelperRequest(input: unknown, options?: HelperExecutionOptions): Promise<HelperResponse>;
export type { HelperRequest, HelperResponse, HelperResult } from "./protocol.js";
