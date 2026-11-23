/**
 * Pure catalog data; never hydrate a wallet or infer live provider availability. One entry per registry row: chain 56
 * lists its USDT and its USDC, each naming the `--asset` its commands need.
 */
export declare function metaMaskGaslessNetworks(): {
    executable_adapter: boolean;
    action_time_verification_required: boolean;
    mainnet_acceptance: string;
    asset_required?: boolean;
    chain_id: 1 | 10 | 8453 | 42161 | 137 | 56 | 59144 | 143 | 1329;
    name: string;
    token: `0x${string}`;
    symbol: import("./registry.js").MetaMaskGaslessSymbol;
    decimals: 18 | 6;
    rpc_environment: string;
    finality_tag: "safe" | "finalized";
    deployment_evidence_hash: string;
}[];
