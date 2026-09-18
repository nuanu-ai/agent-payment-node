import type { Address } from "../model.js";
import type { BridgeChainRow } from "./asset-registry.js";
export declare function assertBridgeRegistryListed(registry: Readonly<Record<number, BridgeChainRow>>): void;
/** True only when the frozen list names this exact EVM token deployment on this chain. */
export declare function bridgeTokenListed(caip2: string, token: Address): boolean;
