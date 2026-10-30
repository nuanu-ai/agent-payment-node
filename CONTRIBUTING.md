# Contributing to APN

APN moves real money for AI agents, so changes are held to a high bar: every payment path must stay
idempotent, fail closed and keep the owner's limits. Thank you for helping.

## Before you start

- Report a suspected vulnerability privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.
- For a bug, open an issue with the APN version (`apn --version`), the command, the redacted output and what you
  expected. Never paste wallet secrets, private keys, recovery material, approval codes or payment headers.
- For a larger change, open an issue first so the design can be agreed before you write it.

## Environment

APN supports Apple Silicon macOS only (see [docs/platform-support.md](docs/platform-support.md)). You need:

- Node.js 24 (the package accepts `>=24 <27`; release builds use a pinned Node 24 version);
- npm, and Rust only if you touch the native code under `native/`.

```sh
npm ci --ignore-scripts
npm run typecheck
```

## Build and test

```sh
npm run build          # TypeScript to dist/
npm run build:test     # tests and their fixtures to dist-test/
APN_CORE_TEST_CONCURRENCY=4 node scripts/run-core-tests.mjs dist-test/tests/core/<name>.test.js
npm test               # the full core suite plus packaging checks
```

The core runner accepts a concurrency of 1 or 4. Tests never touch your real `~/.apn`, Keychain or funds: they use
temporary state roots, synthetic keys and recorded chain fixtures.

`dist/` is committed. After changing `src/`, run `npm run build` and commit the regenerated `dist/` files with your
change; release preparation refuses a tree whose `dist/` differs from a fresh build.

## Rules the checks enforce

- No source file may exceed 500 lines, and some APIs are forbidden outside reviewed adapter files
  (`node scripts/core-forbidden-surface.mjs`).
- No silent defaults: an amount, recipient, chain, RPC endpoint or fee ceiling is always explicit.
- A change to a money path comes with tests for its refusal and recovery cases, not only the success case.
- Vendored SDK bundles under `vendor/` are rebuilt only with the `build:*:check` scripts
  ([docs/runtime-sdk-vendor.md](docs/runtime-sdk-vendor.md)); do not edit them by hand.

## Pull requests

Keep a pull request to one change with its tests and documentation. Describe what changes for a user and how you
verified it. CI must pass before review. Releases are prepared and published by the maintainers
([docs/local-release.md](docs/local-release.md)); notable changes are listed in [CHANGELOG.md](CHANGELOG.md).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
