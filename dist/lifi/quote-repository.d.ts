import { SecureStateStore } from "../secure-state-store.js";
import type { BridgeOwner, BridgeProviderBinding, BridgeRouteRequest } from "./model.js";
import { type BridgeRouteChoice } from "./routes.js";
export interface BridgeQuoteSnapshot {
    readonly schemaVersion: "apn.bridge-quote.v1";
    readonly profileHash: string;
    readonly owner: BridgeOwner;
    readonly providerBinding: BridgeProviderBinding;
    readonly request: BridgeRouteRequest;
    readonly requestHash: string;
    readonly rawResponse: string;
    readonly responseHash: string;
    readonly routes: readonly BridgeRouteChoice[];
    readonly createdAt: string;
    readonly snapshotHash: string;
}
export declare function newBridgeQuote(input: Omit<BridgeQuoteSnapshot, "schemaVersion" | "snapshotHash" | "requestHash" | "responseHash" | "routes">): BridgeQuoteSnapshot;
export declare function validateBridgeQuote(value: unknown): BridgeQuoteSnapshot;
export declare class BridgeQuoteRepository extends SecureStateStore {
    save(quote: BridgeQuoteSnapshot): Promise<void>;
    load(profileHash: string, snapshotHash: string): Promise<BridgeQuoteSnapshot | null>;
    private path;
}
