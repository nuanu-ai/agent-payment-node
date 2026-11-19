# Portfolio

[Documentation index](README.md) · [Product overview](../README.md)

This section was moved from the APN README without changes to its text.

`apn wallet portfolio --profile <profile> [--refresh]` reads the native coin and every listed token
(`data/allowlist/2026-09-17/dataset.json`) for the profile's EVM wallet and its Solana and TRON accounts. It never signs or
moves funds and needs no policy. Each network uses its `APN_<CHAIN>_RPC_URL` or the pinned keyless default (Ethereum
`https://ethereum-rpc.publicnode.com`, Base `https://mainnet.base.org`, Arbitrum `https://arb1.arbitrum.io/rpc`, OP
`https://mainnet.optimism.io`, Polygon `https://polygon-bor-rpc.publicnode.com`, BNB `https://bsc-rpc.publicnode.com`,
Avalanche `https://api.avax.network/ext/bc/C/rpc`, Unichain `https://mainnet.unichain.org`, Linea `https://rpc.linea.build`,
Monad `https://rpc.monad.xyz`, Sei `https://evm-rpc.sei-apis.com`, TRON `https://api.trongrid.io`, Solana
`https://api.mainnet-beta.solana.com`). A read sends the profile's public addresses to those endpoints; set the variables
to keep lookups on your own nodes.

A full read is 16 HTTP requests: one Multicall3 batch per EVM network (its runtime code hash is pinned), one Solana batch
and four TRON requests. 429, 5xx and timeouts are retried twice; a failed network is `unavailable` with a reason, never
zero. Successful results are cached privately for 15 seconds (`--refresh` bypasses the cache); money-moving commands never
use the cache.
