# Local macOS Formula release

This lane prepares exact local bytes without dispatching GitHub Actions. It is for macOS arm64 with Node 24.15.0 and the existing `node@24` Homebrew Formula. It does not require the deferred native app, Developer ID signing or notarization. Linux and Windows remain unsupported.

The local provenance file explicitly records `githubActionsAttestation: false`, an empty signature list and `unsigned_local_build_and_verification`. No git signing key or independently authenticated builder is claimed. Digest verification detects changed retained bytes; it does not authenticate the unsigned builder record. Existing Actions release/attestation workflows remain separate.

Run preparation only from a clean isolated checkout of the exact reviewed version commit, with its already installed locked dependencies and pinned Node directory first in PATH. The script never installs dependencies, bumps a version, creates a tag, publishes an asset, edits the tap or installs a Formula. It refuses any existing GitHub tag or release, including a draft; a failed/authenticated absence check also refuses. A target with a different source package version refuses before building. An unused-version observation is time-bound: repeat immediately before later owner-authorized tag/publication, and never overwrite an existing immutable release.

```sh
# Current read-only target eligibility; OUTPUT must not already exist.
node scripts/local-release.mjs check-version --version 0.5.36 --output /tmp/apn-0.5.36-eligibility

# After the separately reviewed 0.5.36 version commit; COMMIT is its full SHA.
node scripts/local-release.mjs prepare --version 0.5.36 --commit "$COMMIT" --output /tmp/apn-0.5.36-release
node scripts/local-release.mjs verify --version 0.5.36 --commit "$COMMIT" --output /tmp/apn-0.5.36-release
```

The source test command enables Node24's official module-mock API with `--experimental-test-module-mocks` directly on `node --test`; Node24 rejects that flag in `NODE_OPTIONS`. Compiler settings remain unchanged.

Preparation runs the core/source build and tests, supply-chain/platform tests, all four exact vendor regeneration checks and production low-severity npm audit. It refuses source/dist drift after the build. It performs two script-free npm packs, retains and compares both archives, checks every packed member against reviewed source bytes, checks embedded package/version/macOS arm64 identity, generates the existing production SPDX 2.3 SBOM including emitted vendor packages/licenses, and creates/verifies the existing commit/version/SHA/size release manifest. A failed gate leaves an incomplete directory for inspection and cannot be used as a verified candidate.

The output directory contains the following concrete review material:

- `nuanu-ai-apn-0.5.36.tgz`, `.spdx.json` and `.release.json`: the three publication assets.
- `nuanu-ai-apn-0.5.36.local-provenance.json`: unsigned local verification metadata, not an Actions attestation.
- `eligibility.json`, `gate-1.log` through `gate-7.log`, `pack-one.json`, `pack-two.json`, and both retained pack archives: audit and reproducibility evidence.

`verify` rechecks the release digests, exact SPDX closure, archive member bytes, source commit/version, retained pack equality, gate-log digests and honest local provenance flags. It accepts a separately fetched published Formula through `--formula`, requiring its exact immutable GitHub asset URL and archive SHA-256. Verification of an already published candidate does not require the tag to remain absent.

After separate final approval of the exact source commit and artifact SHA, publication must use GitHub Release assets, not public npm publication. Preserve the existing release manifest schema. GitHub may supply release immutability; this local lane supplies no Actions/OIDC attestation. Keep publication, tap update and installation as separate proof layers. Before publishing, read-only check the target again in a new eligibility directory. After publishing, download all three published assets, compare each with the approved local bytes and confirm the GitHub release API reports `immutable: true` and the tag resolves to the approved commit. If immutability cannot be established, stop rather than silently claiming the existing release contract.

For published Formula readback and installation proof, retain exact commands and outputs in a separate `distribution-proof.json` with artifact SHA, tag commit, release API immutability, fetched Formula commit/SHA, Formula artifact URL/digest verification, installed `apn --version` output, Homebrew installed version, and Node version. Record pending fields as pending until they are observed. These operations are performed only in the root's separately authorized publication/install step:

```sh
# Read-only published proof, after publication and tap update.
gh release download v0.5.36 --repo nuanu-ai/agent-payment-node --dir /tmp/apn-0.5.36-published
cmp /tmp/apn-0.5.36-release/nuanu-ai-apn-0.5.36.tgz /tmp/apn-0.5.36-published/nuanu-ai-apn-0.5.36.tgz
cmp /tmp/apn-0.5.36-release/nuanu-ai-apn-0.5.36.spdx.json /tmp/apn-0.5.36-published/nuanu-ai-apn-0.5.36.spdx.json
cmp /tmp/apn-0.5.36-release/nuanu-ai-apn-0.5.36.release.json /tmp/apn-0.5.36-published/nuanu-ai-apn-0.5.36.release.json
gh api repos/nuanu-ai/homebrew-tap/contents/Formula/apn.rb --jq .content | base64 --decode > /tmp/apn-0.5.36-published/apn.rb
node scripts/local-release.mjs verify --version 0.5.36 --commit "$COMMIT" --output /tmp/apn-0.5.36-release --formula /tmp/apn-0.5.36-published/apn.rb

# Only after explicit installation authorization; retain actual output.
brew update
brew upgrade nuanu-ai/tap/apn
brew list --versions apn
apn --version
"$(brew --prefix node@24)/bin/node" --version
```

Version/discovery smoke tests prove installed artifact identity without wallet, profile, Keychain or paid operations. They do not replace fresh payment acceptance evidence.
