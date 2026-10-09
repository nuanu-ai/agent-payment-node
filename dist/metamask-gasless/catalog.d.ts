/** Pure catalog data; never hydrate a wallet or infer live provider availability. */
export declare function metaMaskGaslessNetworks(): {
    chain_id: 1 | 10 | 1329 | 59144 | 143 | 42161 | 8453 | 137;
    name: string;
    token: `0x${string}`;
    symbol: string;
    decimals: number;
    rpc_environment: string;
    finality_tag: "safe" | "finalized";
    deployment_evidence_hash: string;
    executable_adapter: boolean;
    action_time_verification_required: boolean;
    mainnet_acceptance: string;
}[];
