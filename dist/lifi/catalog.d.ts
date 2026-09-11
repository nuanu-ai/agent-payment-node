import type { LifiResponse } from "./ports.js";
export declare function bridgeCapabilities(profile?: string): {
    chains: {
        chain: string;
        token: `0x${string}`;
        decimals: number;
        symbol: string;
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
        "eip155:1": string;
        "eip155:8453": string;
        "eip155:42161": string;
    };
    inventory_only: {
        tool: string;
        reason: string;
    }[];
    fee_control: string;
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
            token: `0x${string}`;
            decimals: number;
            symbol: string;
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
            "eip155:1": string;
            "eip155:8453": string;
            "eip155:42161": string;
        };
        inventory_only: {
            tool: string;
            reason: string;
        }[];
        fee_control: string;
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
