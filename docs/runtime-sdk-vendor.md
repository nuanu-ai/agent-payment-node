# Runtime SDK slices

APN ships its MetaMask EVM and Smart Account exports, offline TRON utilities and Relay `getOrderId` as static ESM bundles. The original Agent/Fox SDKs, Smart Account kit, permission types, delegation core, MetaMask x402, Ethereum controllers, TronWeb and settlement SDK remain exact development dependencies for types and generation. The separate MetaMask Agent Wallet CLI stays a runtime dependency.

Original package chains pulled in `bigint-buffer`, SPL decoders, old nested Axios and UUID 9.x. A genuine npm consumer showed that APN's root overrides did not control those resolutions. The slices retain upstream functions while removing these runtime package chains. Signing, monetary caps, RPC budgets, operation ownership and send fences retain their existing contracts.

| Directory | Upstream exports | Manifest SHA256 |
|---|---|---|
| `vendor/metamask-evm-sdk` | Agent SDK 6.1.4 root/base/evm, Fox SDK 2.7.0 EVM/keyring, Ethereum controllers 9.12.0 | `31863561a74b0fdc5ba37afe70fc827ca9e9f171d83d12b56f2b7221dfdd6c1c` |
| `vendor/metamask-smart-account` | Smart Account kit 2.0.0 root/actions/contracts/utils/experimental, permission types 2.0.0, delegation core 3.0.0, MetaMask x402 1.0.0 | `ff253d54bfb8082ebb7e753d4125303aa84a421566dc11490936ece27448ddc3` |
| `vendor/tron-utils` | TronWeb 6.5.0 `utils` | `cbf69134172a065d967339f8c3f432df347e55b944b83bd64cc02459647228a6` |
| `vendor/relay-order-id` | Settlement SDK 0.0.143 `getOrderId` | `1c697732810415f01663bb774256b662c337c9cb8f0f17fbf0e22cb665e991e2` |

Before the first entry import, each loader checks its pinned manifest and every declared executable/legal file's size and SHA256. File and bundle-directory symlinks refuse. Verification is cached for that process; concurrent filesystem changes after verification and unrelated installed dependency bytes are outside this check.

The bundles import Node builtins and their own chunks. Non-builtin dynamic require refuses before parent resolution. Relay's node-fetch optional `encoding` fallback catches that refusal, and a parent canary remains unevaluated. Legacy bare `punycode` imports resolve to the locked userland implementation 2.3.1 during generation, avoiding Node's deprecated builtin. Quiet stderr is required by packaging and actual stdio tests. No Solana wallet, SPL decoder or bigint-buffer input is admitted by the generator.

## Reproduce from the source checkout

Use macOS arm64, Node 24 and a clean installation of the committed lock with lifecycle scripts disabled. The generator pins esbuild 0.28.2 and its darwin-arm64 binary SHA256. It bundles upstream files without importing their runtime code. Smart Account source package name/version/license/repository checks run before bundling.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/build-sdk-vendor.mjs --check
node scripts/build-sdk-vendor.mjs --smart-account --check
node scripts/build-sdk-vendor.mjs --tron-utils --check
node scripts/build-sdk-vendor.mjs --relay-order-id --check
```

Each check regenerates into a temporary directory and compares every vendor file byte-for-byte. Replace `--check` with `--out-dir <new-directory>` to inspect a regeneration; an existing destination refuses. A bundle update requires input review, a new loader manifest pin, rebuilt dist and repeated packaging/consumer checks.

Provenance records upstream input hashes, package versions, external imports and bundler identity. Original LICENSE, COPYING and NOTICE files and emitted `.LEGAL.txt` files are retained. The four roots contain 494 files. `.gitattributes` preserves their bytes, including original CRLF notices.

## Local proof on 8 October 2026

Both TypeScript builds, all 748 production/test executable comparisons and the 500-line source boundary passed. All four bundles regenerated exactly. The final Smart Account packet passed 423 MetaMask/Smart Account checks in 37 files, 584 MCP checks in 33 files and 37 packaging checks, with zero failures or skips and all 1842 inputs unchanged. These cohorts overlap and their counts are not added. The unchanged Relay and TRON components retain separately checked 227/33-file and 64/9-file cohorts from the preceding snapshot.

A fresh npm consumer with no parent overrides installed candidate archive SHA256 `74cc00bf469cf2743691a0ee01711627665c71a2a075c2ea6679ee2f2c85efd3`. All 2763 installed files matched the archive and source. The original SDK packages, MetaMask utility chain, UUID and native decoder packages are absent. CLI version/help/MCP config pass with quiet stderr. This archive precedes the final documentation edit; exact committed-source archive proof is recorded in the closure ledger.

Initial failures remain in private evidence: deprecated builtin punycode also failed with the old MCP client, a genuine consumer exposed undeclared delegation-core imports, and a cross-process material fixture needed its default test-emission path. The corrected generator, export slice and owned test-path alias preserve the assertions. No warning suppression or financial-limit change was used.

## Remaining advisories and licenses

The genuine consumer's production package audit reports zero affected package records. This does not patch or audit every bundled cryptographic function. Existing elliptic advisories remain relevant to upstream code in the EVM/Relay slices. The standalone development graph retains 5 high and 48 low affected records, including original development-only decoder packages. MCP client is pinned to patched 2.3.1; its production server remains 2.0.0 and passed the compatibility checks.

Retained license metadata includes GPL-3.0 `@toruslabs/ffjavascript@6.0.0` in the EVM slice and LGPL-3.0-only `rpc-websockets@9.3.9` in the Relay slice. APN's own MIT license does not replace upstream licenses. Notices and provenance are retained; release-license review remains open. This packet proves source and private offline installation. New paid acceptance, npm/Homebrew publication and global installation remain separate.
