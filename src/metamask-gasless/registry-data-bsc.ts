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
export const MM_BSC_DEPLOYMENT_SOURCE_FILES = [
  {
    "path": "tests/core/metamask-gasless-contract-fixtures/bsc-deployment-evidence-20261123.json",
    "sha256": "1b53a3d62807e397e72a624d2339fea33370bb3f9368128f37b0bbe49d88a808",
    "bytes": 85944
  }
] as const;

export const MM_BSC_DEPLOYMENTS: readonly MetaMaskGaslessDeployment[] = [
  {
    row: {
      "chainId": 56,
      "network": "bsc",
      "token": "0x55d398326f99059ff775485246999027b3197955",
      "decimals": 18,
      "finalityTag": "safe",
      "protocol": {"manager": {"address": "0xdb9b1e94b5b69df7e401ddbede43491141047db3", "codeHash": "0x0029019e237c175ee74871f3d4eab85c196e4ee826c7578bbb4ae054d62d17c6"}, "delegate": {"address": "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b", "codeHash": "0x2f40923fc79da9330c663341d8a52823ea02372b7da66175a0a9bfc76270d55f"}, "limitedCalls": {"address": "0x04658b29f6b82ed55274221a06fc97d318e25416", "codeHash": "0x3a07a1b31d8f8f29cde4260f88fc5011e003e4bdbd519c8274fc7092d2356468"}, "exactBatch": {"address": "0x1e141e455d08721dd5bcda1baa6ea5633afd5017", "codeHash": "0x53a2556929c5ae83a4c66ae8b704594f5fea1a9a362cdda974445a575e9a941d"}},
      "tokenProxyCodeHash": "0x97a48aa4c129657440dafdacd4c836389734d28cc4a0ca7403e68da660a74a59",
      "tokenImplementationSlot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      "tokenImplementationAddress": "0x0000000000000000000000000000000000000000",
      "tokenImplementationCodeHash": "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      "evidenceBlock": {"numberAtomic": "135274029", "hash": "0xc49d4ae1d685b06065e665ab34926169e84941d543f80783d1e958923c7e0129", "timestampAtomic": "1795438268"},
      "provenance": {"runtime": {"path": "tests/core/metamask-gasless-contract-fixtures/bsc-deployment-evidence-20261123.json", "rowIndex": 0}, "token": {"path": "tests/core/metamask-gasless-contract-fixtures/bsc-deployment-evidence-20261123.json", "rowIndex": 0}, "raw": {"path": "tests/core/metamask-gasless-contract-fixtures/bsc-deployment-evidence-20261123.json", "rowIndex": 0}},
    },
    deploymentEvidenceHash: "d01c13a6fdbeed4362426c1068e89145eb60bfd7ff8823d1f0bdf162c12d7940",
  },
  {
    row: {
      "chainId": 56,
      "network": "bsc",
      "token": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      "decimals": 18,
      "finalityTag": "safe",
      "protocol": {"manager": {"address": "0xdb9b1e94b5b69df7e401ddbede43491141047db3", "codeHash": "0x0029019e237c175ee74871f3d4eab85c196e4ee826c7578bbb4ae054d62d17c6"}, "delegate": {"address": "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b", "codeHash": "0x2f40923fc79da9330c663341d8a52823ea02372b7da66175a0a9bfc76270d55f"}, "limitedCalls": {"address": "0x04658b29f6b82ed55274221a06fc97d318e25416", "codeHash": "0x3a07a1b31d8f8f29cde4260f88fc5011e003e4bdbd519c8274fc7092d2356468"}, "exactBatch": {"address": "0x1e141e455d08721dd5bcda1baa6ea5633afd5017", "codeHash": "0x53a2556929c5ae83a4c66ae8b704594f5fea1a9a362cdda974445a575e9a941d"}},
      "tokenProxyCodeHash": "0x56069ff2fd59ae482f7984aa894b6d3bc84cb910354dcda9cd6c828d61526914",
      "tokenImplementationSlot": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      "tokenImplementationAddress": "0xba5fe23f8a3a24bed3236f05f2fcf35fd0bf0b5c",
      "tokenImplementationCodeHash": "0xd2d7cf7504e1cb572af28476d45907fc30bee1297917bed153e6fbba125821a3",
      "evidenceBlock": {"numberAtomic": "135274029", "hash": "0xc49d4ae1d685b06065e665ab34926169e84941d543f80783d1e958923c7e0129", "timestampAtomic": "1795438268"},
      "provenance": {"runtime": {"path": "tests/core/metamask-gasless-contract-fixtures/bsc-deployment-evidence-20261123.json", "rowIndex": 0}, "token": {"path": "tests/core/metamask-gasless-contract-fixtures/bsc-deployment-evidence-20261123.json", "rowIndex": 1}, "raw": {"path": "tests/core/metamask-gasless-contract-fixtures/bsc-deployment-evidence-20261123.json", "rowIndex": 1}},
    },
    deploymentEvidenceHash: "274c884db446c3a0e533220a70f84597fb2f31b5cd47e96faa751b213b4a071b",
  },
];
