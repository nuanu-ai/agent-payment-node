# Local macOS Formula release

This lane prepares and verifies exact local release bytes for the Homebrew Formula without dispatching GitHub Actions.
It is for maintainers. It runs on macOS arm64 with Node 24.15.0 and serves the existing `node@24` Homebrew Formula. It
does not require the deferred native app, Developer ID signing or notarization. Linux and Windows remain unsupported
(see the [platform support matrix](platform-support.md)).

## What the local provenance claims

The local provenance file explicitly records `githubActionsAttestation: false`, an empty signature list and
`unsigned_local_build_and_verification`. It also records `published: false` and `installed: false`.

- No git signing key or independently authenticated builder is claimed.
- Digest verification detects changed retained bytes; it does not authenticate the unsigned builder record.
- The existing GitHub Actions release and attestation workflows remain separate.

## Requirements

Run preparation only from a clean isolated checkout of the exact reviewed version commit, with its already installed
locked dependencies and the pinned Node directory first in `PATH`. `prepare` and `verify` refuse unless:

- the `origin` remote is `https://github.com/nuanu-ai/agent-payment-node.git` or
  `git@github.com:nuanu-ai/agent-payment-node.git`;
- `HEAD` equals `--commit`, a full 40-character SHA;
- there are no tracked changes and no untracked files other than `node_modules`;
- `package.json` is `@nuanu-ai/apn` at exactly `--version`. A target with a different source package version refuses
  before building.

`prepare` also requires the `darwin`/`arm64` platform and exactly Node `v24.15.0`. `check-version` and `prepare` require
an `--output` directory that does not exist yet; `verify` reads the directory `prepare` wrote.

The tag and release absence check uses the `gh` CLI.

The script never installs dependencies, bumps a version, creates a tag, publishes an asset, edits the tap or installs a
Formula.

### Version eligibility

`check-version` and `prepare` refuse any existing GitHub tag or release for `v<version>`, including a draft. An absence
check that fails or cannot be verified also refuses. An unused-version observation is time-bound: repeat it immediately
before a later authorized tag or publication, and never overwrite an existing immutable release.

## Commands

```text
node scripts/local-release.mjs <check-version|prepare|verify> --version X.Y.Z --output <new-directory> [--commit <full-sha>] [--formula <path>]
```

Set `VERSION` to the target version, `COMMIT` to the full SHA of the separately reviewed version commit, and choose new
output directories:

```sh
# Read-only target eligibility; the output directory must not already exist.
node scripts/local-release.mjs check-version --version "$VERSION" --output "$ELIGIBILITY_DIR"

# After the separately reviewed version commit.
node scripts/local-release.mjs prepare --version "$VERSION" --commit "$COMMIT" --output "$RELEASE_DIR"
node scripts/local-release.mjs verify --version "$VERSION" --commit "$COMMIT" --output "$RELEASE_DIR"
```

`prepare` ends by running the same verification as `verify`.

### Core test concurrency

Core test concurrency defaults to one worker. Set `APN_CORE_TEST_CONCURRENCY=4` on `prepare` to run the same complete
core file list with four workers:

```sh
APN_CORE_TEST_CONCURRENCY=4 node scripts/local-release.mjs prepare --version "$VERSION" --commit "$COMMIT" --output "$RELEASE_DIR"
```

- Only `1` and `4` are accepted; an empty or different value refuses before the test child starts.
- The runner logs the selected concurrency and the exact file list into the gate 1 log, preserves the direct
  module-mock flag and propagates test failures. All eight preparation gates still run.
- The child environment retains task variables and removes only Node's internal `NODE_TEST_CONTEXT` marker, which would
  otherwise make a nested runner skip its files; the requested files must actually execute.

The source test command enables Node 24's official module-mock API with `--experimental-test-module-mocks` directly on
`node --test`; Node 24 rejects that flag in `NODE_OPTIONS`.

## Preparation gates

`prepare` runs eight gates in order. Each gate's combined output is retained as `gate-<n>.log`, including a refused
gate's output.

| Gate | Command | Checks |
| --- | --- | --- |
| 1 | `npm run test:core` | Core/source build and tests |
| 2 | `node --test tests/packaging/supply-chain.test.mjs tests/packaging/platform-support.test.mjs` | Supply-chain and platform tests |
| 3 | `npm run build:metamask-sdk:check` | Exact vendor regeneration (MetaMask EVM SDK) |
| 4 | `npm run build:tron-utils:check` | Exact vendor regeneration (TRON utilities) |
| 5 | `npm run build:relay-order-id:check` | Exact vendor regeneration (Relay order ID) |
| 6 | `npm run build:smart-account:check` | Exact vendor regeneration (Smart Account) |
| 7 | `node scripts/audit-production.mjs` | Production npm audit at low severity, with the dated exceptions below |
| 8 | `node scripts/audit-vendor-emitted.mjs` | The same low-severity advisory check over vendor-emitted package versions |

After the gates, preparation:

1. refuses source/dist drift after the build;
2. performs two script-free npm packs, retains and compares both archives;
3. checks every packed member against reviewed source bytes, and the embedded package name, version and macOS arm64
   identity;
4. generates the production SPDX 2.3 SBOM, including emitted vendor packages and licenses;
5. creates and verifies the commit/version/SHA/size release manifest;
6. writes the unsigned local provenance file.

A failed gate leaves an incomplete directory for inspection; it cannot be used as a verified candidate.

## Audit gates and dated exceptions

`scripts/audit-production.mjs` runs `npm audit --omit=dev` against the shrinkwrapped lockfile and fails on every
production finding at low or above, except the dated exceptions below. Each production exception is limited to the named
package and major version and to either its install paths or the production packages that may require it, and is refused
from its expiry onward. A package flagged only through excepted packages is covered too.

`scripts/audit-vendor-emitted.mjs` sends the exact package versions each vendor bundle's provenance says it emitted to
npm's bulk advisory service and fails at low or above. It exists because the production audit reads the lockfile, which
files those packages under dev. It takes only its own exception list, limited to advisory, exact versions and bundles.

| Advisory | Package | Gate | Scope | Approved | Expires (00:00 UTC) |
| --- | --- | --- | --- | --- | --- |
| GHSA-mrhx-c7xc-m3w5 (npm advisory 1243066) | zod `<4.6.6`, major 3 | Production | zod 3.x installed under `node_modules/awal/` and `node_modules/@x402/` | 2026-10-24 | 2026-11-23 |
| GHSA-gcqx-w48m-w2h4 (npm advisory 1243505) | deepmerge `>=4.2.0 <=4.3.1`, major 4 | Production | deepmerge 4.x while `@toruslabs/http-helpers` and `@toruslabs/customauth` (under `@metamask/agent-wallet`) are the only production packages that require it | 2026-10-29 | 2026-11-28 |
| GHSA-gcqx-w48m-w2h4 (npm advisory 1243505) | deepmerge 4.3.1 | Vendor-emitted | The `metamask-evm-sdk` vendor bundle | 2026-10-29 | 2026-11-28 |

### zod (GHSA-mrhx-c7xc-m3w5)

Memory exhaustion when validating oversized constrained collections. APN's own zod is 4.6.7. awal 2.12.x and `@x402/*`
2.x require zod `^3`, which has no fixed release, and zod 4 breaks their APIs. The affected code runs in the awal child
process; a hostile seller response could exhaust that child's memory, not APN's process or funds. Remove the exception
when upstream ships a fix.

### deepmerge (GHSA-gcqx-w48m-w2h4)

Prototype poisoning of merged objects. 4.3.1 is the latest release, and upstream closed the report without a fix
(TehShrike/deepmerge#273). The poisoning needs an attacker's object, such as parsed JSON with its own `__proto__` key, as
a merge source.

- Production: the Torus helpers merge only request options and login parameters built in their own code, never a
  response body.
- Vendor bundle: the one call is the HTTP helper's `get`, whose two callers (the gas-estimate fetches) pass literal
  request options.
- The `mm` CLI bundles its own copy, so an npm override could not change what runs.

Remove both exceptions when upstream ships a fix or the Torus helpers drop deepmerge.

## Output directory

| File | Purpose |
| --- | --- |
| `nuanu-ai-apn-<version>.tgz`, `nuanu-ai-apn-<version>.spdx.json`, `nuanu-ai-apn-<version>.release.json` | The three publication assets |
| `nuanu-ai-apn-<version>.local-provenance.json` | Unsigned local verification metadata, not an Actions attestation |
| `eligibility.json` | The tag and release absence check |
| `gate-1.log` through `gate-8.log` | Retained gate output |
| `pack-one.json`, `pack-two.json`, `pack-one/`, `pack-two/` | Both npm pack results and retained archives |

## Verify

`verify` rechecks the release digests, exact SPDX closure, archive member bytes, source commit/version, retained pack
equality, gate-log digests and honest local provenance flags. It accepts a separately fetched published Formula through
`--formula`, requiring its exact immutable GitHub asset URL and archive SHA-256. Verification of an already published
candidate does not require the tag to remain absent.

## Publication and installation proof

Publication, tap update and installation are separate proof layers, each performed only after its own explicit
authorization:

1. After separate final approval of the exact source commit and artifact SHA, publish GitHub Release assets, not a public
   npm package. Preserve the existing release manifest schema.
2. Before publishing, check the target again read-only in a new eligibility directory.
3. After publishing, download all three published assets, compare each with the approved local bytes, and confirm that
   the GitHub release API reports `immutable: true` and that the tag resolves to the approved commit. GitHub may supply
   release immutability; this local lane supplies no Actions/OIDC attestation. If immutability cannot be established,
   stop rather than silently claiming the existing release contract.

For published Formula readback and installation proof, retain exact commands and outputs in a separate
`distribution-proof.json`: artifact SHA, tag commit, release API immutability, fetched Formula commit/SHA, Formula
artifact URL/digest verification, installed `apn --version` output, Homebrew installed version, and Node version. Record
pending fields as pending until they are observed.

```sh
# Read-only published proof, after publication and tap update.
gh release download "v$VERSION" --repo nuanu-ai/agent-payment-node --dir "$PUBLISHED_DIR"
cmp "$RELEASE_DIR/nuanu-ai-apn-$VERSION.tgz" "$PUBLISHED_DIR/nuanu-ai-apn-$VERSION.tgz"
cmp "$RELEASE_DIR/nuanu-ai-apn-$VERSION.spdx.json" "$PUBLISHED_DIR/nuanu-ai-apn-$VERSION.spdx.json"
cmp "$RELEASE_DIR/nuanu-ai-apn-$VERSION.release.json" "$PUBLISHED_DIR/nuanu-ai-apn-$VERSION.release.json"
gh api repos/nuanu-ai/homebrew-tap/contents/Formula/apn.rb --jq .content | base64 --decode > "$PUBLISHED_DIR/apn.rb"
node scripts/local-release.mjs verify --version "$VERSION" --commit "$COMMIT" --output "$RELEASE_DIR" --formula "$PUBLISHED_DIR/apn.rb"

# Only after explicit installation authorization; retain the actual output.
brew update
brew upgrade nuanu-ai/tap/apn
brew list --versions apn
apn --version
"$(brew --prefix node@24)/bin/node" --version
```

Version and discovery smoke tests prove installed artifact identity without wallet, profile, Keychain or paid
operations. They do not replace fresh payment acceptance evidence.
