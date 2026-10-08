# Runtime SDK slices

APN ships the EVM functions it uses from MetaMask, the offline TRON utilities and Relay's `getOrderId` as static ESM bundles. A normal consumer installation no longer needs the original Agent SDK, Fox SDK, TronWeb, settlement SDK or Ethereum controllers package. Their exact versions remain development dependencies for type checking and reproducible generation.

The original Agent/Fox dependency graph pulled in `bigint-buffer` and SPL decoders. A real npm consumer also selected old Axios through TronWeb, including the settlement SDK's TronWeb dependency. Root overrides inside APN did not control that consumer's resolutions. The slices preserve the existing upstream exports and remove these runtime package chains; payment logic, RPC limits, signing and monetary caps are unchanged.

| Directory | Upstream entry points | Manifest SHA256 |
|---|---|---|
| `vendor/metamask-evm-sdk` | Agent SDK 6.1.4 root/base/evm, Fox SDK 2.7.0 EVM/keyring, Ethereum controllers 9.12.0 | `b5de0a094a32f1b22b8e2e428cac5b6716e7ae726d5a1a3f38375b32b2a0df13` |
| `vendor/tron-utils` | TronWeb 6.5.0 `utils` | `87526ab76191501ab3571c3ce6395ad9f3e28b6780944ca29f854a43e2cb0e65` |
| `vendor/relay-order-id` | Settlement SDK 0.0.143 `getOrderId` | `97a5f15af76987ee71e0490abf49a5c401d0b7b94e9c984e7325f1644ceac4a6` |

Before the first entry import, each APN loader checks its pinned manifest and every declared executable/legal file's size and SHA256. It rejects substitutions and symlinked files or bundle directories. Verification is cached for that process. This protects the initial load; it does not attest every installed dependency byte or prevent concurrent filesystem modification after verification.

The bundles import Node builtins and their own chunks. Non-builtin dynamic `require` calls refuse before parent resolution. Relay retains node-fetch's optional `encoding` fallback, whose upstream catch handles this refusal. A parent `encoding` canary remains unevaluated in packaging tests. No Solana wallet, SPL decoder or `bigint-buffer` input is admitted by the generator.

## Reproduce from the source checkout

Use macOS arm64, Node 24 and a clean installation of the committed lock with lifecycle scripts disabled. The generator pins esbuild 0.28.2 and its darwin-arm64 binary SHA256. It reads and bundles upstream files without importing their runtime code.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/build-sdk-vendor.mjs --check
node scripts/build-sdk-vendor.mjs --tron-utils --check
node scripts/build-sdk-vendor.mjs --relay-order-id --check
```

Each check regenerates into a temporary directory and compares all vendor files, including provenance and notices, byte-for-byte. To inspect a proposed regeneration, replace `--check` with `--out-dir <new-directory>`; the generator refuses to overwrite an existing destination. Updating a bundle requires reviewing its inputs, updating its loader's manifest pin, rebuilding `dist`, and repeating packaging and genuine-consumer checks.

`provenance.json` records package versions, upstream input hashes, external imports and bundler identity. `licenses/` retains original upstream LICENSE, COPYING and NOTICE files, and emitted `.LEGAL.txt` files retain bundled notices. The three roots contain 421 files in total.

## Verified scope on 8 October 2026

A fresh clean producer reproduced all three bundles and all 747 production JS files. The source boundary passed, as did 25 packaging checks for imports, metadata, tampering and symlinks. Focused checks passed 205 MetaMask tests, 100 TRON/SunSwap/LI.FI tests and 227 Relay tests across 33 Relay files, with zero failures or skips. Relay was split into 15/15/3-file batches after the combined producer hit its aggregate timeout; production limits and individual assertions were retained.

A fresh npm consumer with no parent overrides installed the local archive with scripts disabled. All 2686 installed files matched the tested candidate archive, whose SHA256 is `216745b9504be492a122852768cfe070d13c8088e97d70f4f59c78e7148ba4b2`. CLI version/help/MCP config passed. Its actual installed helper passed five modes on all eight supported EVM networks using synthetic transport, with zero network, native or child-process attempts. A second real consumer deliberately included the original decoder packages; all six ESM/CommonJS loads refused before evaluation, while the 40 helper checks still passed. These are offline installation proofs, separate from paid network acceptance.

## Advisories and upstream licenses

Bundling does not patch upstream cryptography or erase upstream license obligations. The final standalone lock audit still reports 6 high and 48 low affected package records, including development-only MCP client and decoder dependencies. The genuine consumer's production audit reports 0 high and 8 moderate affected records from `uuid` below 11.1.1 through MetaMask utilities. Portable remediation of this chain remains open. `elliptic` advisories also remain relevant to bundled upstream code even when npm cannot see that code as a separate installed package.

Retained metadata includes `@toruslabs/ffjavascript@6.0.0` under GPL-3.0 in the EVM slice and `rpc-websockets@9.3.9` under LGPL-3.0-only in the Relay slice. APN's own MIT license does not replace the licenses of vendored portions. Upstream notices and provenance are retained; release-license review remains open. This source change has not been published to npm/Homebrew or installed globally.
