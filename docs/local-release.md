# Local macOS Formula release

This lane prepares exact local bytes without dispatching GitHub Actions. It is for macOS arm64 with Node 24.15.0 and the existing `node@24` Homebrew Formula. It does not require the deferred native app, Developer ID signing or notarization. Linux and Windows remain unsupported.

The local provenance file explicitly records `githubActionsAttestation: false`, an empty signature list and `unsigned_local_build_and_verification`. No git signing key or independently authenticated builder is claimed. Digest verification detects changed retained bytes; it does not authenticate the unsigned builder record. Existing Actions release/attestation workflows remain separate.

Run preparation only from a clean isolated checkout of the exact reviewed version commit, with its already installed locked dependencies and pinned Node directory first in PATH. The script never installs dependencies, bumps a version, creates a tag, publishes an asset, edits the tap or installs a Formula. It refuses any existing GitHub tag or release, including a draft; a failed/authenticated absence check also refuses. A target with a different source package version refuses before building. An unused-version observation is time-bound: repeat immediately before later owner-authorized tag/publication, and never overwrite an existing immutable release.

```sh
# Current read-only target eligibility; OUTPUT must not already exist.
node scripts/local-release.mjs check-version --version 0.5.38 --output /tmp/apn-0.5.38-eligibility

# After the separately reviewed 0.5.38 version commit; COMMIT is its full SHA.
node scripts/local-release.mjs prepare --version 0.5.38 --commit "$COMMIT" --output /tmp/apn-0.5.38-release
node scripts/local-release.mjs verify --version 0.5.38 --commit "$COMMIT" --output /tmp/apn-0.5.38-release
```

The source test command enables Node24's official module-mock API with `--experimental-test-module-mocks` directly on `node --test`; Node24 rejects that flag in `NODE_OPTIONS`. Compiler settings remain unchanged.

Core test concurrency defaults to one worker. For the reviewed local release lane, set `APN_CORE_TEST_CONCURRENCY=4` on `prepare` to run the same complete core file list with four workers. Only `1` and `4` are accepted; an empty or different value refuses before the test child starts. The runner logs the selected concurrency and exact file list into gate-1 evidence, preserves the direct module-mock flag and propagates test failures. All eight preparation gates still run. The child environment retains task variables and removes only Node's internal `NODE_TEST_CONTEXT` marker, which would otherwise skip a nested runner; the requested files must actually execute.

```sh
APN_CORE_TEST_CONCURRENCY=4 node scripts/local-release.mjs prepare --version 0.5.38 --commit "$COMMIT" --output /tmp/apn-0.5.38-release
```

Preparation runs the core/source build and tests, supply-chain/platform tests, all four exact vendor regeneration checks, production low-severity npm audit (`scripts/audit-production.mjs`: `npm audit --omit=dev` failing at low, except the owner-approved dated exceptions listed below) and the same low-severity advisory check over the exact package versions each vendor bundle's provenance says it emitted (`scripts/audit-vendor-emitted.mjs`; the production audit reads the lockfile, which files those packages under dev). It refuses source/dist drift after the build. It performs two script-free npm packs, retains and compares both archives, checks every packed member against reviewed source bytes, checks embedded package/version/macOS arm64 identity, generates the existing production SPDX 2.3 SBOM including emitted vendor packages/licenses, and creates/verifies the existing commit/version/SHA/size release manifest. A failed gate leaves an incomplete directory for inspection and cannot be used as a verified candidate.

## Owner-approved audit exceptions

`scripts/audit-production.mjs` fails on every production finding at low or above except these, each limited to the named
package, major version and install paths (or the production packages that may require it), and refused after its expiry;
`scripts/audit-vendor-emitted.mjs` takes only its own list, limited to advisory, exact versions and bundles:

- GHSA-mrhx-c7xc-m3w5 (npm advisory 1243066, zod `<4.6.6`, memory exhaustion validating oversized constrained
  collections), approved 2026-10-24, expires 2026-11-23: zod 3.x under `node_modules/awal/` and `node_modules/@x402/`.
  APN's own zod is 4.6.7. awal 2.12.x and @x402/* 2.x require zod `^3`, which has no fixed release, and zod 4 breaks their
  APIs. The affected code runs in the awal child process; a hostile seller response could exhaust that child's memory,
  not APN's process or funds. Remove the exception when upstream ships a fix.
- GHSA-gcqx-w48m-w2h4 (npm advisory 1243505, deepmerge `>=4.2.0 <=4.3.1`, prototype poisoning of merged objects),
  accepted 2026-10-29 under the owner's standing APN QA mandate (QA 0.5.77), expires 2026-11-28: deepmerge 4.x while
  `@toruslabs/http-helpers` and `@toruslabs/customauth` (under `@metamask/agent-wallet`) are the only production packages
  that require it, and deepmerge 4.3.1 in the `metamask-evm-sdk` vendor bundle. 4.3.1 is the latest release and upstream
  closed the report without a fix (TehShrike/deepmerge#273). The poisoning needs an attacker's object, such as parsed
  JSON with its own `__proto__` key, as a merge source; these helpers merge only request options and login parameters
  built in their own code, never a response body. In the vendor bundle the one call is the HTTP helper's `get`, whose two
  callers (the gas-estimate fetches) pass literal request options; the `mm` CLI bundles its own copy, so an npm override
  could not change what runs. Remove both when upstream ships a fix or the Torus helpers drop deepmerge.

The output directory contains the following concrete review material:

- `nuanu-ai-apn-0.5.38.tgz`, `.spdx.json` and `.release.json`: the three publication assets.
- `nuanu-ai-apn-0.5.38.local-provenance.json`: unsigned local verification metadata, not an Actions attestation.
- `eligibility.json`, `gate-1.log` through `gate-8.log`, `pack-one.json`, `pack-two.json`, and both retained pack archives: audit and reproducibility evidence.

`verify` rechecks the release digests, exact SPDX closure, archive member bytes, source commit/version, retained pack equality, gate-log digests and honest local provenance flags. It accepts a separately fetched published Formula through `--formula`, requiring its exact immutable GitHub asset URL and archive SHA-256. Verification of an already published candidate does not require the tag to remain absent.

After separate final approval of the exact source commit and artifact SHA, publication must use GitHub Release assets, not public npm publication. Preserve the existing release manifest schema. GitHub may supply release immutability; this local lane supplies no Actions/OIDC attestation. Keep publication, tap update and installation as separate proof layers. Before publishing, read-only check the target again in a new eligibility directory. After publishing, download all three published assets, compare each with the approved local bytes and confirm the GitHub release API reports `immutable: true` and the tag resolves to the approved commit. If immutability cannot be established, stop rather than silently claiming the existing release contract.

For published Formula readback and installation proof, retain exact commands and outputs in a separate `distribution-proof.json` with artifact SHA, tag commit, release API immutability, fetched Formula commit/SHA, Formula artifact URL/digest verification, installed `apn --version` output, Homebrew installed version, and Node version. Record pending fields as pending until they are observed. These operations are performed only in the root's separately authorized publication/install step:

```sh
# Read-only published proof, after publication and tap update.
gh release download v0.5.38 --repo nuanu-ai/agent-payment-node --dir /tmp/apn-0.5.38-published
cmp /tmp/apn-0.5.38-release/nuanu-ai-apn-0.5.38.tgz /tmp/apn-0.5.38-published/nuanu-ai-apn-0.5.38.tgz
cmp /tmp/apn-0.5.38-release/nuanu-ai-apn-0.5.38.spdx.json /tmp/apn-0.5.38-published/nuanu-ai-apn-0.5.38.spdx.json
cmp /tmp/apn-0.5.38-release/nuanu-ai-apn-0.5.38.release.json /tmp/apn-0.5.38-published/nuanu-ai-apn-0.5.38.release.json
gh api repos/nuanu-ai/homebrew-tap/contents/Formula/apn.rb --jq .content | base64 --decode > /tmp/apn-0.5.38-published/apn.rb
node scripts/local-release.mjs verify --version 0.5.38 --commit "$COMMIT" --output /tmp/apn-0.5.38-release --formula /tmp/apn-0.5.38-published/apn.rb

# Only after explicit installation authorization; retain actual output.
brew update
brew upgrade nuanu-ai/tap/apn
brew list --versions apn
apn --version
"$(brew --prefix node@24)/bin/node" --version
```

Version/discovery smoke tests prove installed artifact identity without wallet, profile, Keychain or paid operations. They do not replace fresh payment acceptance evidence.


## 0.5.38 candidate public RPC scope

This candidate includes Jupiter's public pre-freeze lifetime error operands and the existing RPC batch path for independent confirmed fee and height reads. Jupiter also sends its standalone pre-sign and pre-send confirmed height guards as single-item batches through the same transport, with one logical read and one POST per guard. The height meaning, parameters and expiry checks remain unchanged. It preserves the strict 100–151 block window, full executable/account reads, simulation, frozen origin/message, 90-second TTL and logical request caps. No RPC vendor signup or API key is mandatory. Normal Solana has an anonymous public default; a custom HTTPS endpoint is optional. Direct EVM financial commands and LI.FI routes still require their explicit public RPC URL configuration. Optional provider or custody authentication remains separate from that RPC baseline; this candidate changes neither its requirements nor the existing URL parser.

One Source24 normal anonymous PublicNode quote on 10 October 2026 ran from 14:54:23.873347 to 14:54:46.370613 UTC and returned an unsigned exact simulated quote. This proves that invocation passed the existing quote guards; it does not prove a universal provider response shape or availability. Exact lifetime operands were not exposed by that successful output. No prepare, approval, signature or send occurred. The original three signed UNKNOWN Jupiter operations remain held and are never resent by this change.

Source24's local 58-test result and that read-only quote belong to their exact source. Version 0.5.38 still requires its own complete normal release qualification, installed proof and any separately authorized financial acceptance. Existing financial statuses and historical proofs are preserved.
