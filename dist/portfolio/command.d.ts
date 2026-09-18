import type { RuntimeContext } from "../runtime.js";
import type { PortfolioHttpPort } from "./https.js";
export interface PortfolioDependencies {
    /** Owner overrides (`APN_*_RPC_URL`); an unset or empty variable selects the pinned keyless default. */
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly http: PortfolioHttpPort;
    /** Retry pause. Networks retry concurrently, so this must not register a per-wait process signal listener. */
    readonly wait: (milliseconds: number) => Promise<"elapsed" | "interrupted">;
}
export declare function portfolioPause(milliseconds: number): Promise<"elapsed">;
/** Read-only: resolves public profile accounts under the profile lock, then reads every list network without holding it. */
export declare function readProfilePortfolio(context: RuntimeContext, profileInput: string): Promise<unknown>;
