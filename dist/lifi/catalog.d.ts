import type { LifiResponse } from "./ports.js";
export declare function bridgeCapabilities(profile?: string): {
    chains: {
        chain: string;
        name: string;
        native_coin: {
            symbol: string;
            coin_key: string;
            decimals: 18;
            bridgeable_principal: boolean;
            role: string;
        };
        tokens: {
            token: `0x${string}`;
            symbol: string;
            coin_key: string;
            decimals: number;
            upgradeability: "immutable" | "legacy_proxy" | "beacon_proxy";
            tools: string[];
            peers: string[];
        }[];
    }[];
    tools: {
        tool: string;
        variant: string;
        decoder_implemented: boolean;
    }[];
    route_executable: string;
    profiles: ({
        provider: string;
        custody: string;
        execution_owner: string;
        retry_owner: string;
        evidence_owner: string;
        implemented: boolean;
        unavailable_reason: null;
        prerequisites: string[];
    } | {
        provider: string;
        custody: string;
        execution_owner: string;
        retry_owner: string;
        evidence_owner: string;
        implemented: boolean;
        unavailable_reason: string;
        prerequisites: string[];
    })[];
    rpc_environment: {
        [k: string]: string;
    };
    inventory_only: ({
        tool: string;
        reason: string;
        asset?: never;
    } | {
        asset: string;
        reason: string;
        tool?: never;
    })[];
    fee_control: string;
    fee_headroom: {
        policy: "apn.bridge-fee-headroom.v1";
        headroom_bps: number;
        statement: string;
    };
    mainnet_acceptance: {
        complete: boolean;
        passed: number;
        required: number;
        named_human_acceptance: string;
    };
    next_actions: string[];
    profile?: string;
    profile_binding_inspected?: boolean;
    schema_version: string;
};
export declare function bridgeInventory(responses: Readonly<Record<"chains" | "tokens" | "tools" | "connections", LifiResponse>>): {
    schema_version: string;
    provider: string;
    origin: string;
    observed: {
        [k: string]: {
            response_hash: string;
            provider_inventory: unknown;
            executable_capability: boolean;
        };
    };
    capability: {
        chains: {
            chain: string;
            name: string;
            native_coin: {
                symbol: string;
                coin_key: string;
                decimals: 18;
                bridgeable_principal: boolean;
                role: string;
            };
            tokens: {
                token: `0x${string}`;
                symbol: string;
                coin_key: string;
                decimals: number;
                upgradeability: "immutable" | "legacy_proxy" | "beacon_proxy";
                tools: string[];
                peers: string[];
            }[];
        }[];
        tools: {
            tool: string;
            variant: string;
            decoder_implemented: boolean;
        }[];
        route_executable: string;
        profiles: ({
            provider: string;
            custody: string;
            execution_owner: string;
            retry_owner: string;
            evidence_owner: string;
            implemented: boolean;
            unavailable_reason: null;
            prerequisites: string[];
        } | {
            provider: string;
            custody: string;
            execution_owner: string;
            retry_owner: string;
            evidence_owner: string;
            implemented: boolean;
            unavailable_reason: string;
            prerequisites: string[];
        })[];
        rpc_environment: {
            [k: string]: string;
        };
        inventory_only: ({
            tool: string;
            reason: string;
            asset?: never;
        } | {
            asset: string;
            reason: string;
            tool?: never;
        })[];
        fee_control: string;
        fee_headroom: {
            policy: "apn.bridge-fee-headroom.v1";
            headroom_bps: number;
            statement: string;
        };
        mainnet_acceptance: {
            complete: boolean;
            passed: number;
            required: number;
            named_human_acceptance: string;
        };
        next_actions: string[];
        profile?: string;
        profile_binding_inspected?: boolean;
        schema_version: string;
    };
    mainnet_acceptance: string;
};
