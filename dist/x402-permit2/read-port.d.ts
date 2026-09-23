import type { AssetUsageLedger } from "../asset-usage-ledger.js";
import type { EvmRpcCall } from "../evm-ports.js";
import { type GaslessTransport } from "../gasless/https.js";
import type { Address } from "../model.js";
import type { Permit2PrepareReadPort } from "./prepare.js";
/** A configured RPC source and the authenticated APN state are required; no signer or sender is accepted. */
export interface Permit2ProductionReadOptions {
    readonly profile: string;
    readonly stateRoot: string;
    /** Resolve the current local-wallet address from the authenticated wallet binding. */
    readonly localAccount: () => Promise<Address>;
    readonly usage: AssetUsageLedger;
    readonly rpc: EvmRpcCall;
    readonly transport?: GaslessTransport;
    readonly now?: () => Date;
}
/** Production read adapter for the existing unsigned prepare boundary. It never creates an operation or reservation. */
export declare function createPermit2ProductionReadPort(options: Permit2ProductionReadOptions): Permit2PrepareReadPort;
