import type { CommandDefinition } from "../command-catalog.js";
export declare const TRON_COMMANDS: readonly CommandDefinition[];
export declare function tronCapabilities(): {
    rail: string;
    network: string;
    assets: import("../direct-rail-ports.js").ChainAsset[];
    x402: {
        available: boolean;
    };
    sponsorship: {
        available: boolean;
    };
    bridge: {
        available: boolean;
    };
    profiles: ({
        provider: string;
        direct: boolean;
        execution: string;
        requires: string[];
        blocker?: never;
    } | {
        provider: string;
        direct: boolean;
        blocker: string;
        execution?: never;
        requires?: never;
    })[];
};
