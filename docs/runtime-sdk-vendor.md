# Runtime SDK slices

APN ships its MetaMask EVM and Smart Account exports, offline TRON utilities and Relay `getOrderId` as static ESM
bundles under `vendor/`. This page is for maintainers and contributors who review, regenerate or audit those bundles.

The original Agent/Fox SDKs, Smart Account kit, permission types, delegation core, MetaMask x402, Ethereum controllers,
TronWeb and settlement SDK remain exact development dependencies, used for types and generation. The separate MetaMask
Agent Wallet CLI stays a runtime dependency.

## Why the SDKs are vendored

The original package chains pulled in `bigint-buffer`, SPL decoders, old nested Axios and UUID 9.x, and APN's root
overrides do not control those resolutions in an npm consumer's installation. The slices retain the upstream functions
APN uses while removing these runtime package chains. Signing, monetary caps, RPC budgets, operation ownership and send
fences keep their existing contracts.

## Bundles

| Directory | Upstream exports | Manifest SHA256 |
|---|---|---|
| `vendor/metamask-evm-sdk` | Agent SDK 6.1.4 root/base/evm, Fox SDK 2.7.0 EVM/keyring, Ethereum controllers 9.12.0 | `05e9601a4ae684223b03efa3d6faa80b5e87c0c734c710baf6090d993539b948` |
| `vendor/metamask-smart-account` | Smart Account kit 2.0.0 root/actions/contracts/utils/experimental, permission types 2.0.0, delegation core 3.0.0, MetaMask x402 1.0.0 | `ff253d54bfb8082ebb7e753d4125303aa84a421566dc11490936ece27448ddc3` |
| `vendor/tron-utils` | TronWeb 6.5.0 `utils` | `b0e919b536ce6cd58b0a7e79403a780a0c099560c9e332cd829ccdd12bb36a8b` |
| `vendor/relay-order-id` | Settlement SDK 0.0.143 `getOrderId` | `2f9961b36d28b97d4a524bb02a0c89e2fa351cd17fb157e1f2f7d13d1f5f3e8e` |

## Load-time integrity

Before the first entry import, each loader checks its pinned manifest and every declared executable/legal file's size
and SHA256. File and bundle-directory symlinks refuse. Verification is cached for that process; concurrent filesystem
changes after verification and unrelated installed dependency bytes are outside this check.

## Runtime isolation

- The bundles import Node builtins and their own chunks. A non-builtin dynamic require refuses before parent
  resolution. Relay's node-fetch optional `encoding` fallback catches that refusal; the packaging test plants an
  `encoding` package in the parent installation and checks that it is never evaluated.
- Legacy bare `punycode` imports resolve to the locked userland implementation 2.3.1 during generation, avoiding Node's
  deprecated builtin.
- Quiet stderr is required by packaging and actual stdio tests.
- The generator admits no Solana wallet, SPL decoder or `bigint-buffer` input.

## Reproduce from the source checkout

Use macOS arm64, Node 24 and a clean installation of the committed lock with lifecycle scripts disabled. The generator
pins esbuild 0.28.2 and its darwin-arm64 binary SHA256. It bundles upstream files without importing their runtime code.
Smart Account source package name/version/license/repository checks run before bundling.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node scripts/build-sdk-vendor.mjs --check
node scripts/build-sdk-vendor.mjs --smart-account --check
node scripts/build-sdk-vendor.mjs --tron-utils --check
node scripts/build-sdk-vendor.mjs --relay-order-id --check
```

Each check regenerates into a temporary directory and compares every vendor file byte-for-byte. The same four checks are
gates 3 to 6 of the [local release preparation](local-release.md#preparation-gates).

Replace `--check` with `--out-dir <new-directory>` to inspect a regeneration; an existing destination refuses. A bundle
update requires input review, a new loader manifest pin, rebuilt dist and repeated packaging/consumer checks.

## Provenance, licenses and SBOM

- Provenance records all analyzed upstream input hashes separately from `emittedPackages` and positive output-byte
  contributions.
- Only packages contributing executable bytes are bundled components in the release SPDX SBOM. Their original LICENSE,
  COPYING and NOTICE files and the emitted `.LEGAL.txt` files are retained. `.gitattributes` preserves original notice
  bytes, including CRLF. Unused analyzed-input notices are excluded from the runtime inventory.
- EVM and Relay generation prefer official ESM modules. Relay selects the upstream `dist/order/index.js` export rather
  than the full SDK root.
- Generation rejects `elliptic`, GPL-3.0 `@toruslabs/ffjavascript` and LGPL-3.0-only `rpc-websockets` if any slice would
  emit them. The official ESM selection and the narrower Relay entry keep their executable code out without replacing
  cryptographic functions. `elliptic` can appear among analyzed EVM inputs but contributes no executable bytes; its
  advisory is not claimed patched.
- APN's MIT license does not replace the licenses of the components it actually ships.
- The release SBOM includes each vendor root's emitted package versions and licenses with `CONTAINS` relationships,
  alongside the production installation graph. The SBOM namespace incorporates the lock and all four provenance files'
  bytes.

Local verification, private installation, publication and paid acceptance remain distinct proof layers.

## Advisory gate for emitted code

The original development graph still carries upstream advisory records, and `npm audit --omit=dev` alone cannot inspect
vendored code because the lockfile files those packages under dev. `scripts/audit-vendor-emitted.mjs` sends the exact
emitted package versions from every vendor provenance to npm's bulk advisory service and fails on low or higher severity.
Release preparation runs it after the production audit. Its dated exceptions are listed in
[Audit gates and dated exceptions](local-release.md#audit-gates-and-dated-exceptions).

Dependency pins that keep the emitted code clear:

- **follow-redirects:** the Relay and TRON bundles emit `follow-redirects`, which GHSA-q3jh-wrc6-jgq8 (array-form
  headers kept credentials across origins) and GHSA-8r9p-f939-6h3c (unescaped sensitive-header names) cover below
  1.16.1, and GHSA-mrwp-f3q8-3g9p (cross-realm `sensitiveHeaders` arrays discarded, custom credentials followed
  redirects) covers 1.16.0 to 1.16.1. A root override resolves it to 1.16.2. APN calls only `getOrderId` and offline
  TRON address, signature and transaction helpers from these bundles, none of which sends an HTTP request.
- **zod in the Fox SDK:** Fox SDK 2.7.0 (and 2.10.0) pins zod 3.23.8, which GHSA-mrhx-c7xc-m3w5 (zod `<4.6.6`, memory
  exhaustion validating oversized constrained collections) affects with no fixed zod 3 release. The Fox SDK uses only
  `z.string`, `z.object`, `z.boolean`, `z.number`, `z.enum` and `.passthrough()`, all present in zod 4, so the
  `@metamask/fox-sdk` override pins its zod to 4.6.7. `vendor/metamask-evm-sdk` emits zod 4.6.7.
- **deepmerge:** `vendor/metamask-evm-sdk` emits deepmerge 4.3.1 (GHSA-gcqx-w48m-w2h4), which has no fixed release. It is
  covered by a dated vendor exception in the release audit.

## MetaMask package resolver deadline

The MetaMask package resolver uses the invocation's original absolute wall and monotonic deadline. A fractional timer
callback that arrives before that epoch re-arms against the same deadline; it cannot mint a new budget or launch a child.
The resolver's deadline diagnostic comes from its private timer rejection identity. A provider error with the same public
message or code remains an ordinary refusal before expiry. All child launch checks keep the original bound.
