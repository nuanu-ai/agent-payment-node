# Getting started

[Documentation index](README.md) · [Product overview](../README.md)

This page holds the install and command-discovery sections of the APN README, moved here word for word. After it, pick a
workflow: [first journey](first-journey-reference.md) (a direct Base USDC transfer), [x402 purchases](x402-purchases.md)
or [provider wallets](provider-wallets.md). To connect an agent, see [MCP](mcp.md).

## Install

```sh
brew install nuanu-ai/tap/apn
```

The Formula installs `apn` and the Homebrew `node@24` dependency. The first wallet command creates `~/.apn` with mode
`0700` and one encrypted wallet envelope per profile with mode `0600`.

`apn` runs on the first `node` on `PATH`, and Homebrew keeps `node@24` off `PATH` (keg-only). On a Node.js outside
`>=24 <27`, `apn` and `apn mcp serve` load nothing else: they print one `APN_NODE_UNSUPPORTED` line naming the required
range and the running version on stderr, write nothing to stdout and exit 1. Put `/opt/homebrew/opt/node@24/bin` first
on `PATH` then.

## Discover the installed contract

```sh
apn --help
apn wallet --help
apn help pay transfer prepare-asset
apn help --json
```

Discovery runs before any state, Keychain, wallet, policy, network or signing work. Help is raw text; `apn help --json`
prints one raw `apn.command-manifest.v2` JSON object, the machine source of truth. Every operational command prints
exactly one `apn.cli.v1` JSON envelope with `ok`, `error`, `operation`, `receipt` and `next_actions`. `next_actions`
names the next command to run, or the variable or option to fix; optional `closed_blockers`: see Recovery guarantees.

Manifest v2 merged several v1 commands (the `*-network` twins, `wallet balance-asset`, the Relay route groups) and
removed the historical Circle v1 and LI.FI recovery commands, whose operations are all terminal. The manifest's
`removed_v1_commands` lists each removed path with its replacement, or with `replacement: null` and a reason when it
has none. Running an old path fails with `APN_UNSUPPORTED_COMMAND`: its first next action is the replacement, and a
removal without a successor names the reason.
