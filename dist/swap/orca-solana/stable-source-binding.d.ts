import { SOLANA_GENESIS } from "../../chain-policy.js";
export declare const ORCA_STABLE_SOURCE_BINDING_SCHEMA: "apn.orca-stable-rpc-source.v1";
export interface OrcaStableSourceBinding {
    readonly schemaVersion: typeof ORCA_STABLE_SOURCE_BINDING_SCHEMA;
    readonly rpcOriginHash: string;
    readonly genesisHash: typeof SOLANA_GENESIS;
}
export declare function stableSourceBinding(rpcOriginHash: string): OrcaStableSourceBinding;
export declare function validateStableSourceBinding(value: unknown): OrcaStableSourceBinding;
