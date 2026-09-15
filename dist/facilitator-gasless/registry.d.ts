import type { Address, Hex } from "../model.js";
export declare const AVALANCHE_FACILITATOR: {
    readonly chainId: 43114;
    readonly network: "eip155:43114";
    readonly rpcEnv: "APN_AVALANCHE_RPC_URL";
    readonly finalityTag: "finalized";
    readonly token: Address;
    readonly tokenDomain: {
        readonly name: "USD Coin";
        readonly version: "2";
    };
    readonly domainSeparator: Hex;
    readonly decimals: 6;
    readonly facilitatorUrl: "https://facilitator.payai.network";
    readonly facilitatorOrigin: string;
    readonly facilitatorEndpointHash: string;
    readonly approvedSigners: readonly Address[];
    readonly maxTimeoutSeconds: 60;
    readonly validitySeconds: 120;
    readonly transferTopic: Hex;
    readonly authorizationUsedTopic: `0x${string}`;
    readonly authorizationStateSelector: Hex;
};
export type FacilitatorRegistry = typeof AVALANCHE_FACILITATOR;
