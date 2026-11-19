# How APN works

[Documentation index](README.md) · [Product overview](../README.md)

This section was moved from the APN README without changes to its text.

**Profiles.** Every money command names a profile with `--profile`. A profile is either a local wallet that APN creates
(`wallet ensure`, `wallet ensure-solana`, `wallet ensure-tron`) or imports (`wallet import`), or a provider-managed
wallet bound with `wallet connect` (Coinbase Agentic Wallet, MetaMask Agent Wallet, MetaMask Smart Account). APN never
prints or exports a private key.

**Owner limits.** Nothing moves money without limits the owner set. The owner allowlist
([guide](allowlist-policy.md)) admits each exact asset on a rail (`direct`, `x402`, `gasless`, `bridge`, `swap`)
with per-operation and daily caps, plus the exact mechanism (provider and reference) for gasless, x402 and bridges and an
optional `recipients` pin. The owner stages a policy file and activates it in a foreground terminal. Local x402 also uses
the profile policy (`wallet policy set`). APN never fills in a missing cap, account, recipient or amount.

**Prepare, approve, recover.** A `prepare` command freezes one exact effect (chain, asset, amount, recipient, fee budget)
under an idempotency key and signs nothing. An `approve`/`execute` command re-checks the frozen facts and the active policy,
shows the exact terms in a foreground terminal and asks for a typed code before signing. Every send is behind a durable
marker, and an ambiguous send is observed before anything else. Whether recovery can then pass the same signed bytes
to the network again depends on the family. A local EVM transfer can, under exact conditions; it never signs a second
transaction ([conditions](evm-assets.md#safety-and-recovery)). `operation status`, `operation resume`,
`operation abandon` and `receipt get` take a saved operation of any family and run that family's own code; a family
whose recovery or exit is a separate command (Circle, x402 merchant, Permit2, Relay, GasZip funding, Uniswap token,
Stargate token cleanup) answers with it.

**MCP never approves.** `apn mcp config` prints the launch descriptor and `apn mcp serve` runs the stdio server. Its tools
are projected from the same catalog and run the same code as the CLI. Commands that need a human (approve, execute,
abandon, wallet connect, allowlist activate) are not separate tools: one `apn_foreground_handoff` tool validates the
arguments exactly as the CLI does and returns the exact command for the human to run in a terminal. It reads and writes
nothing. `wallet policy set` runs over MCP only for a pure decrease; a new policy or an increase returns the handoff.
The handoff covers every foreground command of a family MCP exposes, `gasless usdt execute` and `x402 permit2 approve`
included. Ten foreground commands have no handoff because MCP exposes no prepare, quote or status tool of their family,
so an agent never holds their inputs or operations; these families are CLI only: `stargate native execute`,
`stargate token execute`, `stargate token cleanup`, `relay execute`, `relay retire`, `wallet metamask native-transfer`,
`circle approval execute`, `circle source submit`, `sei funding approve` and `mega funding approve`.
