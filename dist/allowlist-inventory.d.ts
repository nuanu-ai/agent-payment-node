export declare const ALLOWLIST_INVENTORY_SCHEMA: "apn.allowlist-inventory.v1";
export declare const ALLOWLIST_DATASET_SCHEMA: "apn.asset-policy-candidate-dataset.v1";
export declare const ALLOWLIST_DATASET_VERSION: "2026-09-17.market-cap-top-10.1";
export declare const ALLOWLIST_DATASET_SHA256: "2af4736e081f2981d775c8cee72015152dfabe1315b035f87f506500b08625f0";
export declare const ALLOWLIST_DATASET_PATH: "data/allowlist/2026-09-17/dataset.json";
declare const RAILS: readonly ["direct", "gasless", "x402", "bridge", "swap"];
export type CandidateRail = typeof RAILS[number];
export type CandidateFamily = "evm" | "solana" | "tron";
export type CandidateKind = "native" | "token";
export interface CandidateRails {
    readonly direct: false;
    readonly gasless: false;
    readonly x402: false;
    readonly bridge: false;
    readonly swap: false;
}
export interface CandidateAsset {
    readonly chain: string;
    readonly family: CandidateFamily;
    readonly networkName: string;
    readonly kind: CandidateKind;
    readonly identifier: string | null;
    readonly symbol: string;
    readonly decimals: number;
    readonly selectionClass: "top_10" | "native_additional" | null;
    readonly tokenStandard: string | null;
    readonly eligibility: "issuer_native" | null;
    readonly rails: CandidateRails;
    readonly caps: null;
    readonly evidence: Readonly<Record<string, string>>;
    readonly admission: "not_admitted_owner_configuration_missing";
}
export interface CandidateNetwork {
    readonly chain: string;
    readonly family: CandidateFamily;
    readonly name: string;
    readonly assetCount: number;
    readonly deploymentCount: number;
}
export interface CandidateDeployment {
    readonly chain: string;
    readonly family: CandidateFamily;
    readonly networkName: string;
    readonly identifier: string;
    readonly symbol: string;
    readonly decimals: number;
    readonly tokenStandard: string;
    readonly eligibility: "issuer_native";
    readonly evidence: Readonly<Record<string, string>>;
}
export interface AllowlistInventory {
    readonly schemaVersion: typeof ALLOWLIST_INVENTORY_SCHEMA;
    readonly dataset: {
        readonly schemaVersion: typeof ALLOWLIST_DATASET_SCHEMA;
        readonly version: typeof ALLOWLIST_DATASET_VERSION;
        readonly retrievedAt: string;
        readonly path: typeof ALLOWLIST_DATASET_PATH;
        readonly sha256: string;
    };
    readonly policyRegistry: {
        readonly targetSchemaVersion: "apn.asset-policy-registry.v1";
        readonly referenceCommit: string;
        readonly status: "blocked_owner_caps_missing";
        readonly configured: false;
    };
    readonly provenance: {
        readonly source: string;
        readonly requestUrl: string;
        readonly responsePath: string;
        readonly responseSha256: string;
        readonly platformMetadataRequestUrl: string;
        readonly platformMetadataResponsePath: string;
        readonly platformMetadataResponseSha256: string;
        readonly includeRehypothecated: false;
        readonly candidateCount: 10;
    };
    readonly railStates: readonly {
        readonly rail: CandidateRail;
        readonly admitted: false;
    }[];
    readonly networks: readonly CandidateNetwork[];
    readonly assets: readonly CandidateAsset[];
    readonly deployments: readonly CandidateDeployment[];
    readonly inventorySha256: string;
}
export declare function loadAllowlistInventory(): AllowlistInventory;
export declare function compileAllowlistInventory(value: unknown, datasetSha256: string): AllowlistInventory;
export declare function resolveAllowlistAsset(input: {
    readonly chain: string;
    readonly kind: CandidateKind;
    readonly identifier?: string;
}, inventory?: AllowlistInventory): CandidateAsset;
export declare function assertAllowlistExecutionConfigured(input: {
    readonly chain: string;
    readonly kind: CandidateKind;
    readonly identifier?: string;
    readonly rail: CandidateRail;
}, inventory?: AllowlistInventory): never;
export {};
