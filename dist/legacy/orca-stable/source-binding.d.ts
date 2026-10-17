import { SOLANA_GENESIS } from "../../chain-policy.js";
export declare const ORCA_STABLE_SOURCE_BINDING_SCHEMA: "apn.orca-stable-rpc-source.v1";
/** Frozen reader: the RPC origin a released stable preparation was sealed to; its finishers observe through the same origin. */
export interface OrcaStableSourceBinding {
    readonly schemaVersion: typeof ORCA_STABLE_SOURCE_BINDING_SCHEMA;
    readonly rpcOriginHash: string;
    readonly genesisHash: typeof SOLANA_GENESIS;
}
export declare function validateStableSourceBinding(value: unknown): OrcaStableSourceBinding;
