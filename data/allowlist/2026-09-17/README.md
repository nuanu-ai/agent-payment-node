# APN Card2 allowlist candidate freeze — 2026-09-17

This directory is a reproducible owner-level candidate dataset. It is **not an active allowlist**.

- Selection: exactly the first 10 rows from the frozen CoinGecko global circulating market-cap request, with `includeRehypothecated=false`. Native gas assets marked `native_additional` are required target-network inventory and do not extend or alter those ten ranks.
- Networks: Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Smart Chain, Avalanche C-Chain, Unichain, Linea, Monad, Sei EVM, TRON, and Solana.
- Eligibility: native coins, plus issuer-native token deployments verified against Circle or Tether primary registries and read-only chain state.
- Safety: all rail flags are `false`; caps are `null`; the dataset cannot satisfy or be sealed as `apn.asset-policy-registry.v1` until the owner supplies caps and explicitly admits rails.
- Refusal: missing deployments stay absent. Wrapped or same-symbol third-party assets are never substituted.

## Frozen evidence

`raw/coingecko/coins-markets.json` is the exact `/coins/markets` response. `raw/coingecko/coins-list.json` is the exact `include_platform=true` response, and `top10-platforms.json` is its deterministic top-10 extraction. Each live chain identity and token-decimal read stores the request, endpoint, and response. `raw/SHA256SUMS` covers every raw evidence file.

The primary Tether page was frozen as HTML. The Circle registry and decimal specification were verified through primary Circle web documentation, but direct HTTPS download from the execution host failed; this limitation is recorded in `raw/primary/circle-direct-fetch-unavailable.json`. Included Circle addresses were also independently checked by read-only chain calls.

## Validate

```sh
npm ci
npm run validate:allowlist-dataset
```

The validator checks the exact request, market rows and timestamps, platform metadata extraction, exhaustive SHA-256 provenance, the fixed target-chain and issuer deployment projections, canonical EVM/TRON/Solana identifiers, exact network identities, on-chain decimals, disabled rails, absent owner caps, and required refusals. Negative tests prove that market tampering, unsupported chains or deployments, same-symbol substitution, enabled rails, supplied caps, and ambiguous native-addition classification are rejected.
