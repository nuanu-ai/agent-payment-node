import type { MetaMaskGaslessDeployment } from "./model.js";
/**
 * BNB Smart Chain (eip155:56), read by APN itself on 2026-11-23 with unsigned public reads only, from two public RPCs at
 * finalized blocks pinned by hash. MetaMask's relay lists chain 56 in all three of its public network lists (the
 * Sentinel row with relayTransactions true, slug bsc-mainnet), and the pinned SDK carries chain 56 in its Sentinel slugs
 * and its delegation-framework 1.3.0 deployments. LimitedCalls and ExactExecutionBatch have the same runtime as on every
 * 2026-09-09 chain; DelegationManager and EIP7702StatelessDeleGator equal the proven Ethereum runtimes with only their
 * two EIP-712 immutables (cached chain id 56 and the domain separator recomputed for chain 56) changed. Binance-Peg USDT
 * is no proxy: both EIP-1967 slots read zero and its runtime has no DELEGATECALL, CALLCODE or SELFDESTRUCT. Binance-Peg
 * USDC is an EIP-1967 proxy. Both tokens report 18 decimals. Runtime action-time checks remain mandatory; MetaMask's
 * fee-token list for chain 56 needs a session, so each quote proves it or refuses.
 */
export declare const MM_BSC_DEPLOYMENT_SOURCE_FILES: readonly [{
    readonly path: "tests/core/metamask-gasless-contract-fixtures/bsc-deployment-evidence-20261123.json";
    readonly sha256: "1b53a3d62807e397e72a624d2339fea33370bb3f9368128f37b0bbe49d88a808";
    readonly bytes: 85944;
}];
export declare const MM_BSC_DEPLOYMENTS: readonly MetaMaskGaslessDeployment[];
