# Verify a release

[Documentation index](README.md) · [Product overview](../README.md)

This section was moved from the APN README without changes to its text.

Release artifacts are built twice with Node 24.15.0 and must be byte-identical. The workflow emits the npm tarball, an
SPDX 2.3 SBOM and a release manifest binding names, sizes and SHA-256 digests to the exact commit; GitHub artifact
attestations bind those bytes to the pinned workflow identity.

```sh
gh attestation verify nuanu-ai-apn-<version>.tgz \
  --repo nuanu-ai/agent-payment-node \
  --signer-workflow nuanu-ai/agent-payment-node/.github/workflows/release.yml \
  --source-ref refs/heads/main \
  --deny-self-hosted-runners

node scripts/verify-supply-chain.mjs verify \
  --artifact nuanu-ai-apn-<version>.tgz \
  --sbom nuanu-ai-apn-<version>.spdx.json \
  --manifest nuanu-ai-apn-<version>.release.json \
  --formula Formula/apn.rb
```

The verifier rejects mutable URLs, version drift and any digest not in the manifest. Releases come only from the
manually dispatched release workflow on a protected `vX.Y.Z` tag; publication and Homebrew updates are separate owner
actions. The archive ships `npm-shrinkwrap.json`, so installation resolves the exact integrity-pinned dependency closure.
