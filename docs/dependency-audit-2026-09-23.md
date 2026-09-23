# Dependency audit — 2026-09-23

## Reproduction and scope

On `origin/main` at `59a6c1c` (APN `0.5.26`), Node `v26.7.0` and npm `11.19.0`:

```sh
npm ci --no-audit --no-fund
npm audit --omit=dev --json
npm audit --json
```

`package-lock.json` and `npm-shrinkwrap.json` are byte-identical. Both audit modes report **55 affected package records: 5 high, 2 moderate, 48 low, 0 critical**. These records collapse to **three underlying advisories**. The development audit adds no vulnerable records, so all reported packages are in the production dependency graph. An npm dependency path establishes installation and potential loadability; it does not prove that APN calls the vulnerable function with attacker-controlled input.

| Advisory | Installed package | Affected records | Production path and current status |
| --- | --- | --- | --- |
| [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), buffer overflow in `toBigIntLE()` | `bigint-buffer@1.1.5` | 5 high | Root `@metamask/fox-sdk@2.7.0` (also via root `@metamask/agent-sdk@6.1.4`) → `@solana/spl-token@0.4.14` → `@solana/buffer-layout-utils@0.2.0` → `bigint-buffer`. npm reports `fixAvailable: false`; `1.1.5` is the latest published `bigint-buffer`. |
| [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x), quadratic work in nested JSON filters | `stream-json@1.9.1` | 2 moderate | Root `@metamask/fox-sdk@2.7.0` → `@solana/web3.js@1.98.4` → `jayson@4.3.0` → `stream-json`. The fixed `stream-json` range starts at `3.5.0`; `jayson@4.3.0` requires `^1.9.1`. npm's `fixAvailable: true` applies to the transitive package, but that version is outside the parent range. |
| [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84), risky elliptic cryptographic primitive | `elliptic@6.6.1` | 48 low | Several production paths from MetaMask and Fox SDK, including `@metamask/agent-sdk` → `@metamask/bridge-controller` → `@metamask/transaction-controller` → `@ethersproject/signing-key` → `elliptic`, and Fox SDK → Polymarket ethers v5 packages → `@ethersproject/signing-key` → `elliptic`. npm reports `fixAvailable: false`; `6.6.1` is the latest published `elliptic`. |

APN loads the MetaMask SDK and Fox SDK for its gasless EVM helper (`src/metamask-gasless/client/service.ts` and `session.ts`). The high advisory travels through the Fox SDK's Solana dependency even though APN's helper imports EVM and keyring entry points. We have not established that `toBigIntLE()` is invoked by the supported EVM flow. The `jayson` finding likewise describes installed code; its vulnerable filters need a separate call-path and input-boundary review before an exploitability claim.

## Remediation work

1. Track upstream MetaMask/Fox SDK releases that remove or replace the vulnerable Solana and ethers v5 dependency chains. Fox SDK `2.8.0` still pins `@solana/spl-token@0.4.14`, so a direct Fox SDK bump alone does not remove the high finding.
2. Obtain a fixed `bigint-buffer` release or a compatible upstream removal of `@solana/buffer-layout-utils`/`bigint-buffer`. `@solana/spl-token@0.4.15` changes to buffer-layout-utils `^0.3.0`, but `0.3.0` still depends on `bigint-buffer@^1.1.5`; overriding Fox SDK's exact `0.4.14` pin would therefore add compatibility risk without clearing the advisory.
3. Ask `jayson`/`@solana/web3.js` upstream to migrate to `stream-json >=3.5.0`, or assess replacing that path. Do not override `stream-json` across a major-version gap without compatibility tests of Jayson request parsing and APN's affected flows.
4. For `elliptic`, track upstream migration away from ethers v5 and legacy crypto chains; do not force a major replacement below MetaMask SDK.
5. Repeat both audit modes after each upstream change. Require a clean `npm ci`, build, typecheck, relevant tests, and identical package lock and shrinkwrap before treating the advisory as resolved. Separately inspect runtime call paths and attacker-controlled input boundaries for the three vulnerable functions.

The existing five-high sprint figure is still current. This document closes the measurement task and leaves dependency remediation open.
