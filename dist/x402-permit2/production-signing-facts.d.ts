import type { ReadOnlyRpcBatchCall } from "../rpc.js";
import type { Permit2ProductionRecord } from "./production-repository.js";
import { type Permit2ObservedBlock } from "./production-observer-facts.js";
export declare function signingIdentityCalls(record: Permit2ProductionRecord, block: Permit2ObservedBlock): readonly ReadOnlyRpcBatchCall[];
export declare function signingTokenCalls(record: Permit2ProductionRecord, block: Permit2ObservedBlock): readonly ReadOnlyRpcBatchCall[];
export declare function assertSigningIdentity(record: Permit2ProductionRecord, values: readonly unknown[]): void;
export declare function assertSigningTokens(record: Permit2ProductionRecord, values: readonly unknown[]): void;
export declare function assertSigningTime(record: Permit2ProductionRecord, now: Date, block?: Permit2ObservedBlock): void;
