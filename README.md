# Agent Payment Node

APN is an open-source, local-first payment runtime for AI agents. An agent drives it through the `apn` CLI or a local
stdio MCP server; a human owner sets the limits and approves every signature in a foreground terminal. APN keeps each
payment as a durable operation with an idempotency key, so a crash or a lost response never sends the same money twice.

It covers:

- direct transfers of native coins and listed tokens on EVM networks, Solana and TRON;
- standard x402 purchases (EIP-3009 USDC, Permit2, ERC-20 transfer-proof merchants);
- USDC transfers whose gas is paid from the USDC amount (local wallet, MetaMask Agent Wallet, MetaMask Smart Account,
  Coinbase, PayAI facilitator) and Ethereum USDT through a keyless sponsor;
- bridges (LI.FI with Across and Stargate, Relay, Circle CCTP V2, GasZip, NEAR 1Click, direct Stargate V2);
- guarded swaps (Uniswap V3 on Ethereum, SunSwap on TRON, Jupiter and Orca on Solana);
- an owner allowlist that admits each asset, rail and mechanism with per-operation and daily caps.

APN runs on Apple Silicon macOS with Node 24. The [platform support matrix](docs/platform-support.md) records the
boundary and what Linux or Windows would need. A matching version number does not prove that an installed artifact
contains a given source change: check `apn --version`, the release provenance and `apn help --json` together.

## Install

```sh
brew install nuanu-ai/tap/apn
```

The Formula installs `apn` and the Homebrew `node@24` dependency. The first wallet command creates `~/.apn` with mode
`0700` and one encrypted wallet envelope per profile with mode `0600`.

### Discover the installed contract

```sh
apn --help
apn wallet --help
apn help pay transfer prepare-asset
apn help --json
```

Discovery runs before any state, Keychain, wallet, policy, network or signing work. Help is raw text; `apn help --json`
prints one raw `apn.command-manifest.v2` JSON object, the machine source of truth. Every operational command prints
exactly one `apn.cli.v1` JSON envelope with `ok`, `error`, `operation`, `receipt` and `next_actions`. `next_actions`
names the next command to run, or the variable or option to fix.

Manifest v2 merged several v1 commands (the `*-network` twins, `wallet balance-asset`, the Relay route groups). The
manifest's `removed_v1_commands` lists each removed path with its replacement, and running an old path fails with
`APN_UNSUPPORTED_COMMAND` whose first next action is the replacement.

### Verify a release

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

## How APN works

**Profiles.** Every money command names a profile with `--profile`. A profile is either a local wallet that APN creates
(`wallet ensure`, `wallet ensure-solana`, `wallet ensure-tron`) or imports (`wallet import`), or a provider-managed
wallet bound with `wallet connect` (Coinbase Agentic Wallet, MetaMask Agent Wallet, MetaMask Smart Account). APN never
prints or exports a private key.

**Owner limits.** Nothing moves money without limits the owner set. The owner allowlist
([guide](docs/allowlist-policy.md)) admits each exact asset on a rail (`direct`, `x402`, `gasless`, `bridge`, `swap`)
with per-operation and daily caps, plus the exact mechanism (provider and reference) for gasless, x402 and bridges and an
optional `recipients` pin. The owner stages a policy file and activates it in a foreground terminal. Local x402 also uses
the profile policy (`wallet policy set`). APN never fills in a missing cap, account, recipient or amount.

**Prepare, approve, recover.** A `prepare` command freezes one exact effect (chain, asset, amount, recipient, fee budget)
under an idempotency key and signs nothing. An `approve`/`execute` command re-checks the frozen facts and the active policy,
shows the exact terms in a foreground terminal and asks for a typed code before signing. Every send is behind a durable
marker; an ambiguous send is only observed afterwards, never repeated. `operation status`, `operation resume` and
`receipt get` read or advance a saved operation; families with their own lifecycle add `status`/`observe` commands.

**MCP never approves.** `apn mcp config` prints the launch descriptor and `apn mcp serve` runs the stdio server. Its tools
are projected from the same catalog and run the same code as the CLI. Commands that need a human (approve, execute,
abandon, wallet connect, allowlist activate) are not separate tools: one `apn_foreground_handoff` tool validates the
arguments exactly as the CLI does and returns the exact command for the human to run in a terminal. It reads and writes
nothing. `wallet policy set` runs over MCP only for a pure decrease; a new policy or an increase returns the handoff.

## First journey: a direct Base USDC transfer

```sh
apn wallet ensure --profile agent
apn wallet status --profile agent
```

`wallet status` shows the public address. Fund it manually with a small amount of Base ETH (gas) and Base USDC.

Write a policy file that admits Base USDC on the direct rail for that address (the caps are the owner's choice; 1 USDC is
`1000000` atomic units):

```json
{
  "schemaVersion": "apn.allowlist-policy-file.v1",
  "overlayVersion": "agent.1",
  "accounts": { "evm": "<address from wallet status>" },
  "effectiveAt": "<ISO-8601 instant>",
  "admissions": [
    { "chain": "eip155:8453", "kind": "token", "identifier": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "rail": "direct", "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000" }
  ]
}
```

```sh
apn allowlist policy stage --profile agent --file /absolute/path/policy.json
apn allowlist policy activate --profile agent --revision 1        # foreground terminal, typed code

apn wallet balance --profile agent --chain eip155:8453 --asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --rpc-url https://mainnet.base.org

apn pay transfer prepare-asset --profile agent --chain eip155:8453 \
  --asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --to <recipient-address> --amount 0.01 \
  --max-fee-wei <fee-budget-wei> --idempotency-key first-transfer-0001 --rpc-url https://mainnet.base.org

apn pay transfer approve --operation <operation-id> --rpc-url https://mainnet.base.org   # foreground terminal
apn operation status --operation <operation-id>
apn receipt get --operation <operation-id>
```

Prepare freezes recipient, amount, nonce, gas limit, fee envelope and expiry; the amount counts against the policy caps
and approval reserves it in the shared usage ledger before signing. `--max-fee-wei` is the owner's pre-submission fee
budget. Approval accepts fee movements that keep the frozen transaction executable; it never re-prices a signed
transaction. Completion needs the exact receipt and Transfer log at the network's required finality. The same commands
work for native coins (`--asset native`) and every listed token on the eleven direct EVM networks; see
[EVM asset transfers](docs/evm-assets.md) and [direct transfers under the allowlist](docs/allowlist-direct-integration.md).
Solana and TRON have their own `-solana`/`-tron` commands ([Solana](docs/solana.md), [TRON](docs/tron.md)).

If a transfer stalls, `operation resume --operation <id> --rpc-url <url>` performs only the next legal transition
(`--observe-only true` inspects an already submitted local transfer without custody access). `operation abandon` lets the
owner close an eligible operation whose outcome cannot be proven, after accepting the unresolved risk in the terminal.

## x402 purchases

```sh
apn wallet policy set --profile agent --max-balance-usdc-atomic <limit> --max-x402-amount-atomic <limit> \
  [--max-balance-eth-wei <limit>] [--x402-payees <address,...|unrestricted>]
apn x402 inspect --url https://seller.example/resource
apn x402 fetch prepare --profile agent --url https://seller.example/resource \
  --idempotency-key buy-0001 --rpc-url https://mainnet.base.org
apn x402 fetch approve --operation <operation-id> --rpc-url https://mainnet.base.org
apn operation resume --operation <operation-id> --rpc-url https://mainnet.base.org --wait-seconds 60
```

Creating a policy or raising a limit needs the foreground terminal; a pure decrease does not. `--x402-payees` optionally
pins which sellers may be paid. `wallet policy show/set`, `x402 inspect` and `x402 fetch prepare` take
`--chain <caip2>` (`eip155:8453`, `eip155:1` or `eip155:42161`) to select the local-wallet x402 network; omitting it
means Base, and no network inherits another's limits. `x402 fetch prepare`
uses the owner's maximum, and `--max-amount-atomic` can only lower it for one call. Approval creates exactly one frozen
authorization; `operation resume` owns the paid request, settlement observation and seller-result recovery. `--method`,
`--headers-json` and `--body-base64` send POST and other requests with opaque body bytes bound into the operation.

Avalanche USDT [Permit2 requests](docs/x402-non-usdc.md) (`x402 permit2 *`) and [ERC-20 transfer-proof
merchants](docs/x402-merchant-usdm.md) (`x402 merchant *`, MegaETH USDm first) are CLI commands with foreground approval.
[Offer selection](docs/x402-offer-selection.md) and [settlement fields](docs/x402-settlement-compatibility.md) are
documented separately.

## Provider wallets

```sh
apn wallet connect --profile provider-one --provider coinbase-agentic-wallet
apn wallet connect --profile mm --provider metamask-agent-wallet [--auth-method browser]
apn wallet connect --profile sa --provider metamask-smart-account --auth-method browser \
  --permission-cap-usdc-atomic <cap> --permission-expires-at <unix-seconds> --idempotency-key sa-connect-0001
```

Authentication stays in the foreground terminal (MetaMask Smart Account consent opens the browser). APN binds the exact
address the completed provider session reports and fails closed if a later session selects another one
(`APN_PROFILE_DRIFT`, rebind with `--expected-revision`). It never receives QR payloads, browser credentials, provider
tokens, seed phrases or private keys.

- **Coinbase Agentic Wallet** (`awal@2.12.1`): APN durably marks `started` before invoking the provider once; any
  possible effect without proof becomes a no-replay `ambiguous_effect`, and completion needs an independent Base receipt
  with the exact USDC Transfer.
- **MetaMask Agent Wallet** (`@metamask/agent-wallet@6.1.5`, Guard server wallet): direct transfers and x402 use the same
  operation contract; Guard MFA returns `provider_pending` and `operation resume --wait-seconds` watches only that request.
  `operation recover-provider-request` binds an independently known request to an ambiguous transfer without replaying it.
- **MetaMask Smart Account**: APN keeps one encrypted session account and the ERC-7715 grant; each transfer derives one
  exact child delegation after foreground approval. `wallet permission list|sync|disable|forget` manage the binding.

Provider balance is never spending authority; the owner allowlist and profile policy still apply.

## Families

| Family | Commands | Guide |
| --- | --- | --- |
| Direct EVM transfers | `wallet balance`, `pay transfer prepare-asset`, `pay transfer approve` | [EVM assets](docs/evm-assets.md) |
| Solana / TRON transfers | `wallet ensure-*`, `wallet balance-*`, `policy admit-*`, `pay transfer prepare-*` | [Solana](docs/solana.md), [TRON](docs/tron.md) |
| Portfolio | `wallet portfolio` | [below](#portfolio) |
| USDC with gas from the amount | `gasless capabilities`, `gasless balance`, `gasless transfer quote/prepare/approve/approve-sealed` | [Gasless](docs/gasless.md) |
| Ethereum USDT gasless | `gasless usdt prepare/execute/resume/observe/status/execution-status` | [Gasless USDT](docs/gasless-usdt.md) |
| MetaMask native-fee USDC transfer | `wallet metamask native-transfer[-status/-observe]` | [MetaMask native](docs/metamask-native-cli-sourceprep.md) |
| LI.FI bridges, GasZip, NEAR 1Click | `bridge *`, `mega funding *`, `sei funding *`, `oneclick source *` | [LI.FI](docs/lifi.md) |
| Relay bridges | `relay prepare/execute/observe/status/retire` | [Relay](docs/relay.md) |
| Circle CCTP V2 | `circle evm *`, `circle approval *`, `circle source submit` | [Circle V2 EVM](docs/circle-v2-evm-fast.md) |
| Stargate V2 direct | `stargate native *`, `stargate token *` | [quote](docs/stargate-v2-direct-quote.md), [native](docs/stargate-v2-native-execution.md), [token](docs/stargate-v2-token-native-drop.md) |
| Swaps | `swap ethereum uniswap[-token] *`, `swap tron sunswap *`, `swap solana jupiter/orca *` | [Uniswap](docs/uniswap.md), [SunSwap](docs/sunswap.md), [Jupiter](docs/jupiter.md), [Orca](docs/orca.md) |
| x402 | `x402 inspect`, `x402 fetch *`, `x402 permit2 *`, `x402 merchant *` | [above](#x402-purchases) |

Each guide states its commands, recovery rules and which mainnet acceptance rows are proven or still open. Source tests
are not live payment proof.

## RPC configuration

APN needs no RPC account or API key. A command gets its RPC in one of two ways, and an error names the one to fix:

1. **An explicit flag on the command.** `--rpc-url` on direct EVM transfers and `wallet balance`, `x402 fetch`, `x402
   permit2`, `gasless transfer quote`, `operation resume` and `operation recover-transaction-settlement`; `--rpc-url`
   (source) and `--destination-rpc-url` on `relay execute` and `relay observe`. These commands have no environment
   fallback. Solana and TRON operations are the exception: their `pay transfer approve` and `operation resume` use
   `APN_SOLANA_RPC_URL` and `APN_TRON_RPC_URL`.
2. **`APN_<CHAIN>_RPC_URL` environment variables** for every other family: bridges, GasZip, 1Click, Stargate, Circle,
   gasless, MetaMask native transfers, swaps, Solana, TRON and the portfolio. The variable names the chain:

| Chain | Variable | Keyless default |
| --- | --- | --- |
| Ethereum | `APN_ETHEREUM_RPC_URL` | portfolio only |
| Base | `APN_BASE_RPC_URL` | portfolio only |
| Arbitrum One | `APN_ARBITRUM_RPC_URL` | portfolio; Circle CCTP source |
| OP Mainnet, Polygon, BNB, Avalanche, Unichain | `APN_OPTIMISM_RPC_URL`, `APN_POLYGON_RPC_URL`, `APN_BNB_RPC_URL`, `APN_AVALANCHE_RPC_URL`, `APN_UNICHAIN_RPC_URL` | portfolio only |
| Linea, Monad, Sei | `APN_LINEA_RPC_URL`, `APN_MONAD_RPC_URL`, `APN_SEI_RPC_URL` | portfolio; Circle CCTP destination |
| MegaETH | `APN_MEGA_RPC_URL` | none (x402 merchants use their pinned MegaETH endpoint) |
| Solana | `APN_SOLANA_RPC_URL` | every Solana command: `https://api.mainnet-beta.solana.com` |
| TRON | `APN_TRON_RPC_URL` | portfolio only |

Where a family has no default, a missing variable refuses with `APN_RPC_CONFIG` and a next action naming the variable;
APN never substitutes another endpoint. An empty variable counts as unset; an invalid value refuses and is never replaced
by a default. Every endpoint must be credential-free public HTTPS; APN checks the chain id or genesis, pins DNS to public
addresses and paces physical requests per provider across processes. Optional roles exist for bridges
(`APN_<CHAIN>_RECEIPT_RPC_URL`, `APN_<CHAIN>_ARCHIVE_RPC_URL`; no bridge command requires them), the Uniswap token lane
(`APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS`, a JSON array of up to three primaries) and Local gasless recovery
(`operation resume --observation-rpc-env <VARIABLE>`). Public RPCs can rate-limit: a 429 is reported as
`APN_RPC_RATE_LIMITED`, and rerunning the same command is safe because prepared operations are idempotent.

## Portfolio

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

## Command reference

Generated from the catalog; `apn help <command>` and `apn help --json` give options, effects, approval, states and recovery.

<!-- BEGIN APN COMMAND CATALOG -->
```text
apn x402 permit2 approve --url <https-url> --rpc-url <https-rpc> [--profile <profile>] --idempotency-key <key>
apn x402 permit2 observe --operation <operation-id> --rpc-url <https-rpc> [--profile <profile>] [--transaction <hash> | --expired-unused]
apn x402 permit2 preflight --profile <profile> --payment-required <base64-header> --expected-challenge-hash <hash> --expected-index <index> --expected-terms <base64-json> --rpc-url <avalanche-rpc>
apn x402 permit2 status --profile <profile> --operation <operation-id>
apn x402 merchant prepare --profile <profile> --url <https-url> [--asset <token>] --max-native-fee-wei <wei> [--native-fee-reserve-wei <wei>] --idempotency-key <key>
apn x402 merchant approve --operation <operation-id>
apn x402 merchant observe --operation <operation-id> [--deliver]
apn x402 merchant retire-unsent --operation <operation-id>
apn x402 merchant status --operation <operation-id>
apn relay prepare --profile <profile> --source-chain <caip2> --asset <usdc|native> --destination-chain <caip2> --recipient <address> --amount-atomic <source-atomic> --min-output-atomic <destination-atomic> --max-deposit-network-fee-wei <wei> [--max-approval-network-fee-wei <wei>] [--payer <address> --max-provider-fee-atomic <usdc> --quote-file <absolute-json-path>] --idempotency-key <key>
apn relay execute --profile <profile> --operation <operation-id> --rpc-url <source-rpc>
apn relay observe --profile <profile> --operation <operation-id> --rpc-url <source-rpc> [--destination-rpc-url <destination-rpc>]
apn relay retire --profile <profile> --operation <operation-id>
apn relay status --profile <profile> --operation <operation-id>
apn stargate native prepare --profile <profile> --amount-atomic <wei> --max-native-debit-atomic <wei> --idempotency-key <key>
apn stargate native execute --operation <operation-id>
apn stargate native observe --operation <operation-id>
apn stargate native status --operation <operation-id>
apn stargate native receipt --operation <operation-id>
apn stargate token prepare --profile <profile> --amount-atomic <usdc> [--native-drop-atomic <wei>] --min-output-atomic <usdc> --max-native-debit-atomic <wei> [--max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>] --idempotency-key <key>
apn stargate token execute --operation <operation-id>
apn stargate token cleanup --operation <operation-id>
apn stargate token observe --operation <operation-id>
apn stargate token status --operation <operation-id>
apn stargate token receipt --operation <operation-id>
apn wallet balance --profile <profile> [--chain <caip2> --asset <native-or-contract> [--decimals <integer>]] --rpc-url <https-url>
apn pay transfer prepare-asset --profile <profile> --chain <caip2> --asset <native-or-contract> --rpc-url <https-url> [--decimals <integer>] --to <address> --amount <decimal> --max-fee-wei <wei> [--priority-fee-wei <wei>] --idempotency-key <key>
apn --version
apn mcp serve
apn mcp config
apn doctor keychain [--profile <profile>]
apn wallet ensure [--profile <profile>]
apn wallet import --profile <profile> --key-file <absolute-path> --key-name <env-name> --expected-address <checksummed-address>
apn wallet connect --profile <profile> --provider <provider-id> [--auth-method <method>] [--expected-revision <positive-integer>] [--permission-cap-usdc-atomic <atomic>] [--permission-expires-at <unix-seconds>] [--idempotency-key <key>]
apn wallet permission list --profile <profile>
apn wallet permission sync --profile <profile> --expected-revision <positive-integer>
apn wallet permission disable --profile <profile> --expected-revision <positive-integer>
apn wallet permission forget --profile <profile> --expected-revision <positive-integer>
apn wallet metamask native-transfer --profile <profile> --chain <chain> --recipient <address> --amount-atomic <usdc> --idempotency-key <key>
apn wallet metamask native-transfer-status --operation <id>
apn wallet metamask native-transfer-observe --operation <id>
apn wallet status [--profile <profile>]
apn wallet policy show --profile <profile> [--chain <caip2>]
apn wallet policy set --profile <profile> [--chain <caip2>] --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic> [--max-balance-eth-wei <wei>] [--x402-payees <address,...|unrestricted>]
apn x402 inspect [--chain <caip2>] --url <https-url> [--method <method>] [--headers-json <json>] [--body-base64 <base64>] [--payer <address>]
apn x402 fetch prepare --profile <profile> [--chain <caip2>] --url <https-url> --idempotency-key <key> --rpc-url <https-url> [--max-amount-atomic <atomic>] [--method <method>] [--headers-json <json>] [--body-base64 <base64>]
apn x402 fetch approve --operation <operation-id> --rpc-url <https-url>
apn pay transfer prepare --profile <profile> --idempotency-key <key> --to <address> --amount-usdc <decimal> --rpc-url <https-url>
apn pay transfer approve --operation <operation-id> [--rpc-url <https-url>]
apn operation status --operation <operation-id>
apn operation abandon --operation <operation-id>
apn operation resume --operation <operation-id> [--rpc-url <https-url>] [--wait-seconds <1..300>] [--observe-only true] [--coinbase-observation-rpc publicnode-base] [--observation-rpc-env <APN_ENV_RPC_URL>]
apn operation recover-provider-request --operation <operation-id> --provider-request-id <provider-request-id>
apn operation recover-transaction-settlement --operation <operation-id> --transaction-hash <transaction-hash> --idempotency-key <key> --rpc-url <https-url>
apn receipt get --operation <operation-id>
apn wallet ensure-solana --profile <profile> --provider <local-or-coinbase-awal> [--accept-risk true]
apn wallet balance-solana --profile <profile> --asset <sol-usdc-or-usdt>
apn wallet capabilities-solana [--profile <profile>]
apn policy admit-solana --profile <profile> --asset <sol-usdc-or-usdt> --max-per-transfer <decimal> --daily-limit <decimal> --max-fee-sol <decimal>
apn pay transfer prepare-solana --profile <profile> --asset <sol-usdc-or-usdt> --to <solana-address> --amount <decimal> --max-fee-sol <decimal> --idempotency-key <key>
apn wallet ensure-tron --profile <profile> --provider local --accept-risk true
apn wallet balance-tron --profile <profile> --asset <trx-or-usdt>
apn wallet capabilities-tron [--profile <profile>]
apn policy admit-tron --profile <profile> --asset <trx-or-usdt> --max-per-transfer <decimal> --daily-limit <decimal> --max-fee-trx <decimal>
apn pay transfer prepare-tron --profile <profile> --asset <trx-or-usdt> --to <tron-address> --amount <decimal> --max-fee-trx <decimal> --idempotency-key <key>
apn wallet portfolio [--profile <profile>] [--refresh]
apn operation repair-deployment --operation <operation-id>
apn bridge capabilities [--profile <profile>]
apn bridge inventory
apn bridge routes --profile <profile> --from-chain <caip2> --to-chain <caip2> --from-token <address> --to-token <address> --amount <decimal> --to <address> --min-output <decimal> --max-native-debit-wei <uint> --max-route-fee <decimal> --slippage-bps <uint>
apn bridge prepare --profile <profile> --quote <snapshot-hash> --route <route-id> --idempotency-key <key>
apn bridge approve --operation <operation-id>
apn circle approval prepare --profile <profile> --cap-atomic <USDC atomic> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei>
apn circle approval execute --operation <approval-id>
apn circle approval status --operation <approval-id>
apn circle source submit --profile <profile> --expected-payer <base-address> --recipient-owner <solana-address> --recipient-setup <existing_ata|create_ata> --amount-atomic <uint> --max-source-fee-atomic <uint> --max-allowance-atomic <uint> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei> --idempotency-key <key>
apn sei funding prepare --profile <profile> --expected-payer <address> --amount-atomic <wei> --minimum-output-atomic <sei-wei> --maximum-fee-atomic <wei> --idempotency-key <key>
apn sei funding approve --operation <operation-id>
apn sei funding status --operation <operation-id>
apn circle evm prepare --profile <profile> --destination-profile <profile> --destination-chain <string> --idempotency-key <idempotency_key> --beneficiary <address> --gross-atomic <atomic_usdc> --max-issuer-fee-atomic <atomic_usdc> --min-mint-atomic <atomic_usdc>
apn circle evm approve-source --operation <operation_id>
apn circle evm adopt-external-mint --operation <operation_id> --transaction-hash <string>
apn circle evm approve-mint --operation <operation_id>
apn circle evm observe --operation <operation_id>
apn circle evm refresh-attestation --operation <operation_id>
apn circle evm cleanup --operation <operation_id>
apn circle evm cleanup-nonce --operation <operation_id>
apn circle evm cleanup85-prepare --operation <operation_id>
apn circle evm cleanup85-cancel --operation <operation_id>
apn circle evm cleanup86-approve --operation <operation_id>
apn circle evm status --operation <operation_id>
apn mega funding prepare --profile <profile> --expected-payer <address> --amount-atomic <wei> --minimum-output-atomic <mega-wei> --maximum-fee-atomic <wei> --idempotency-key <key>
apn mega funding approve --operation <operation-id>
apn mega funding status --operation <operation-id>
apn oneclick source submit --lane <lane> --profile <profile> --expected-payer <evm-address> --recipient <tron-or-solana-address> --amount-atomic <origin atomic> --min-output-atomic <destination atomic> --max-quoted-loss-atomic <lane loss atomic> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei> --idempotency-key <key>
apn oneclick source status --operation <operation-id>
apn gasless usdt prepare --profile <profile> --to <address> --amount <gross-USDT> --max-fee <USDT> --min-received <USDT> --idempotency-key <key>
apn gasless usdt status --profile-hash <hash> --operation <operation-id>
apn gasless usdt resume --profile-hash <hash> --operation <operation-id>
apn gasless usdt execute --profile-hash <hash> --operation <operation-id>
apn gasless usdt execution-status --profile-hash <hash> --operation <operation-id>
apn gasless usdt observe --profile-hash <hash> --operation <operation-id>
apn gasless capabilities [--profile <profile>]
apn gasless balance --profile <profile> --chain <chain-id>
apn gasless transfer quote --profile <profile> --chain 1 --owner <address> --to <address> --amount <gross-USDC> --max-fee <USDC> --min-received <USDC> --rpc-url <public-ethereum-rpc> [--rpc-max-batch-items <2-30>]
apn gasless transfer prepare --profile <profile> --chain <chain-id> --to <address> (--amount <gross-USDC> --max-fee <USDC> --min-received <USDC> | --net-amount-atomic <net> --max-gross-atomic <gross-cap> --max-fee-atomic <fee-cap>) --idempotency-key <key>
apn gasless transfer approve --operation <operation-id>
apn gasless transfer approve-sealed --operation <operation-id>
apn allowlist inventory
apn allowlist resolve --chain <exact-network-identity> --kind <native|token> [--identifier <exact-token-identifier>]
apn allowlist policy prepare --profile <profile> --account <canonical-account> --overlay-version <version> --chain <network> --kind <native|token> [--identifier <token>] --rail <rail> --max-per-transfer-atomic <atomic> --daily-limit-atomic <atomic> --effective-at <ISO-instant> [--expires-at <ISO-instant>] [--mechanism-provider <provider> --mechanism-reference <reference>] [--expected-revision <revision>]
apn allowlist policy stage --profile <profile> --file <absolute-policy-file> [--expected-revision <revision>]
apn allowlist policy activate --profile <profile> --revision <revision>
apn allowlist policy revoke --profile <profile> --revision <revision>
apn allowlist policy status --profile <profile>
apn swap ethereum uniswap inventory
apn swap ethereum uniswap quote --profile <profile> --account <address> --to <address> --output-token <address> --amount <wei> --slippage-bps <string> --owner-slippage-cap-bps <string> --deadline <string> --max-gas-limit <wei> --max-fee-per-gas <wei> --max-priority-fee-per-gas <wei>
apn swap ethereum uniswap prepare --profile <profile> --quote <string> --idempotency-key <idempotency_key>
apn swap ethereum uniswap status --operation <operation_id>
apn swap ethereum uniswap approve --operation <operation_id>
apn swap ethereum uniswap execute --operation <operation_id>
apn swap ethereum uniswap-token inventory
apn swap ethereum uniswap-token quote --profile <profile> --account <address> --to <address> --source-token <address> --output-token <address> --amount <string> --minimum-output <string> --approval-cap <string> --deadline <string> --max-approval-gas-limit <wei> --max-swap-gas-limit <wei> --max-cleanup-gas-limit <wei> --max-fee-per-gas <wei> --max-priority-fee-per-gas <wei> --max-native-debit <wei>
apn swap ethereum uniswap-token prepare --profile <profile> --quote <string> --idempotency-key <idempotency_key>
apn swap ethereum uniswap-token status --operation <operation_id>
apn swap ethereum uniswap-token approve --operation <operation_id>
apn swap ethereum uniswap-token execute --operation <operation_id>
apn swap ethereum uniswap-token cleanup --operation <operation_id>
apn swap tron sunswap inventory
apn swap tron sunswap quote --profile <profile> --account <string> --to <string> --amount <wei> --slippage-bps <string> --owner-slippage-cap-bps <string> --fee-limit-sun <wei> --deadline <string>
apn swap tron sunswap prepare --profile <profile> --quote <string> --idempotency-key <idempotency_key>
apn swap tron sunswap status --operation <operation_id>
apn swap tron sunswap approve --operation <operation_id>
apn swap tron sunswap execute --operation <operation_id>
apn swap solana jupiter inventory
apn swap solana jupiter quote --profile <profile> --account <string> --to <string> --amount <wei> --slippage-bps <string> --owner-slippage-cap-bps <string>
apn swap solana jupiter prepare --profile <profile> --quote <string> --idempotency-key <idempotency_key>
apn swap solana jupiter status --operation <operation_id>
apn swap solana jupiter approve --operation <operation_id>
apn swap solana jupiter execute --operation <operation_id>
apn swap solana orca stable-inventory
apn swap solana orca stable-quote --amount <atomic_usdc> --slippage-bps <string> --maximum-price-impact-bps <string>
apn swap solana orca stable-prepare --profile <profile> --policy-revision <string> --owner <string> --amount <atomic_usdc> --slippage-bps <string> --maximum-price-impact-bps <string> --compute-unit-limit <string> --compute-unit-price <string> --create-usdt-ata <string> --maximum-ata-rent <string> --maximum-total-fee <string> --idempotency-key <idempotency_key>
apn swap solana orca stable-status --operation <operation_id>
apn swap solana orca stable-approve --operation <operation_id>
apn swap solana orca stable-execute --operation <operation_id>
apn swap solana orca stable-release --operation <operation_id>
apn swap solana orca stable-recover-no-send --operation <operation_id>
apn swap solana orca stable-observe --operation <operation_id>
apn swap solana orca inventory
apn swap solana orca quote --profile <profile> --account <string> --amount <wei> --slippage-bps <string> --owner-slippage-cap-bps <string> --compute-unit-limit <string> --compute-unit-price <string>
apn swap solana orca prepare --profile <profile> --quote <string> --idempotency-key <idempotency_key>
apn swap solana orca status --operation <operation_id>
apn swap solana orca approve --operation <operation_id>
apn swap solana orca execute --operation <operation_id>
```
<!-- END APN COMMAND CATALOG -->

## Custody and threat model

- `~/.apn/wallets/<profile>.json` is a versioned AES-256-GCM envelope. A random 256-bit wrapping secret is stored as the
  generic password `ai.nuanu.apn.wrapping-secret.v1/default` in the ordinary macOS login Keychain, bound to
  `~/Library/Keychains/login.keychain-db`.
- HKDF-SHA-256 derives a per-write key from a random 32-byte salt; profile, address, chain, creation time and binding hash
  are authenticated as GCM additional data. The envelope also keeps exact signed-effect material so recovery never needs a
  second signature.
- State uses owner-only permissions, symlink and hardlink rejection, macOS kernel advisory locks through `/usr/bin/lockf`,
  bounded canonical JSON and fsync-plus-atomic-rename writes. A busy lock is waited for up to five seconds.

This is `local_software_disposable` custody, not savings custody. Encryption protects a copied `~/.apn` without the
Keychain secret; it does not protect against compromise of the same unlocked login session, process, user or host.
Transient key copies in JavaScript memory are not guaranteed to be zeroized. Missing Keychain material, failed
authentication, unsafe permissions or identity mismatch fail closed and never rotate a wallet silently. On first creation
APN passes the generated wrapping secret to `/usr/bin/security` as an argument, which another process of the same user
could observe during that short window. The wallet envelope is bounded to 1 MiB; reaching the bound refuses persistence
and submission rather than overwriting anything.

Foreground approval requires stdin and stderr attached to real TTYs and an exact operation-bound code within 60 seconds;
a timeout or interruption writes nothing. It is a human-confirmation boundary, not protection against a compromised user
session.

Raw private keys, wrapping secrets, signed transaction bytes, x402 signatures and payment headers never appear in command
output, public operation state or receipts.

## Recovery guarantees

Idempotency keys resolve to one durable operation. Local execution persists the effect binding before submission and
recovers only the exact encrypted signed transaction or authorization. Provider-atomic execution persists a no-replay
start before invoking the provider. Lost outcomes are ambiguous and need independent receipt evidence; they are never
resent. Status and receipts survive restart, reinstall and upgrades because Homebrew does not own `~/.apn`.

An operation that is not terminal blocks new money operations only on its own network and sending account; the refusal
names the blocking operation. Another chain, another wallet, or the Solana or TRON account of the same profile stays
available. Wallet lifecycle changes wait for every operation in the profile.

## Proof boundary

The test suite covers encryption, permissions, concurrency, restart, byte-identical recovery, idempotency, receipts and
every family's journeys without public network traffic or money. Deterministic tests are source proof, not live provider
acceptance or payment proof. Live mainnet acceptance, public release and Homebrew delivery are separate gates recorded
per family in its guide. Hub, contracts, remote MCP and Stellar are outside this repository.

Licensed under the MIT License.
