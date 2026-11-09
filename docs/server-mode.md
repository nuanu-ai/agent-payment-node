# Server mode (branch `linux-defi-corporate`)

Server mode turns APN into cloud infrastructure for a company: it runs on Linux (or macOS), serves thousands of
profiles from one state root, and needs no person at a terminal. The open-source build asks the owner to type a code
before every signature; in server mode the owner policy that the operator configures once is that consent. Every
other guard stays as it is: the allowlist, per-operation and daily caps, frozen terms re-checked before signing,
durable send markers, idempotency keys and recovery.

This branch is separate from the open-source APN and is never merged into `main`.

## What changes in server mode

| Area | Open-source build | Server mode |
| --- | --- | --- |
| Consent | Typed code in a foreground terminal | Granted by the server policy; one JSON line `apn_server_consent` on stderr per consent |
| Owner allowlist | Staged and activated per profile | One global policy file for every profile; per-profile `allowlist policy stage/activate` is refused |
| Local x402 wallet policy | `wallet policy set` per profile | `walletPolicies` rows of the global file |
| Solana/TRON direct admission | `policy admit-solana/-tron` per profile | `chainPolicies` rows of the global file |
| MCP | Approve/execute only through a handoff to a human | Every command is a tool except `wallet connect` (a provider's own login) and every command that writes owner policy, so an agent cannot raise its own caps |
| HTTP | none | `apn serve http`: tools in the OpenAI format plus calls, behind a bearer token |
| Wrapping secret | macOS login Keychain | A file (`APN_WRAPPING_SECRET_FILE`) on any platform |
| Kernel lock | `/usr/bin/lockf` | `/usr/bin/flock` (util-linux) on Linux |
| Operation lookups | Walk every profile folder | One operation-index entry |
| Index reconcile | Walks every record store on each admission | Walks once per state root, then admission keeps the index exact |
| Index locking | One lock for the whole state root around every admission; each admission reads every open operation | One lock per claim taken (the profile, the account on its network); each admission reads only the operations holding the claims it wants. Different profiles never wait for each other |
| EVM owner scan | Reads every profile on each EVM money operation | Not repeated: generated keys are unique and imports are checked once |
| RPC pacing | One POST per 750 ms per RPC host for the whole machine | Unpaced for the hosts in `APN_RPC_UNPACED_HOSTS` (the operator's own nodes) |

Provider-managed wallets (MetaMask, Coinbase) still need their provider's own human login, so a server uses local
wallets: `wallet ensure`, `wallet ensure-solana`, `wallet ensure-tron`.

## Configuration

Every variable is explicit; none has a default.

| Variable | Meaning |
| --- | --- |
| `APN_SERVER_MODE=1` | Turns server mode on (`0` or unset: the open-source behaviour) |
| `APN_STATE_ROOT` | Canonical absolute path of the state root (otherwise `~/.apn` of the OS user) |
| `APN_WRAPPING_SECRET_FILE` | Base64 of 32 random bytes, mode 0600/0400, owned by the APN user. Created on first use with `O_EXCL` if absent |
| `APN_GLOBAL_POLICY_FILE` | The global policy below; owned by the APN user or root, writable by no one else |
| `APN_HTTP_LISTEN` | `host:port` for `apn serve http` |
| `APN_HTTP_TOKEN_FILE` | First line is the bearer token (32+ characters) |
| `APN_RPC_UNPACED_HOSTS` | Comma-separated RPC hostnames that take no cross-process pacing |
| `APN_<CHAIN>_RPC_URL`, `APN_SOLANA_RPC_URL`, `APN_TRON_RPC_URL` | As in the open-source build |

## Global policy file

The file is an ordinary allowlist policy without `accounts`: each profile is bound to its own public addresses when
the policy is read. Admissions for a family the profile has no wallet in are skipped for that profile. Each profile
keeps its own daily caps. An edit takes effect at the next read; operations prepared under the previous file are
refused at approval because their frozen policy digest no longer matches, and must be prepared again.

```json
{
  "schemaVersion": "apn.global-allowlist-policy.v1",
  "overlayVersion": "server.1",
  "effectiveAt": "2026-11-09T00:00:00.000Z",
  "admissions": [
    { "chain": "eip155:8453", "kind": "token", "identifier": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "rail": "direct", "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000" }
  ],
  "walletPolicies": [
    { "chain": "eip155:8453", "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "maxBalanceAtomic": "50000000", "maxX402AmountAtomic": "1000000" }
  ],
  "chainPolicies": [
    { "rail": "solana", "asset": "usdc", "maximumPerTransfer": "3", "dailyLimit": "10", "maximumFee": "0.01" }
  ]
}
```

`admissions` rows are exactly the rows of [the allowlist guide](allowlist-policy.md) (rails `direct`, `x402`,
`gasless`, `bridge`, `swap`, mechanisms and recipient pins). `walletPolicies` rows take `chain`, `asset`,
`maxBalanceAtomic`, `maxX402AmountAtomic`, optional `maxBalanceNativeWei` and `x402Payees`. `chainPolicies` rows take
`rail` (`solana`/`tron`), `asset` (`sol`, `usdc`, `usdt`, `trx`) and decimal `maximumPerTransfer`, `dailyLimit`,
`maximumFee`.

## Running on Linux

Requirements: Node 24–26, util-linux `flock` at `/usr/bin/flock` (Debian, Ubuntu, RHEL ship it), a dedicated user.

```sh
sudo useradd --system --create-home --home-dir /var/lib/apn apn
sudo install -d -o apn -g apn -m 0700 /var/lib/apn/state /etc/apn
sudo -u apn sh -c 'umask 077; openssl rand -base64 32 > /etc/apn/wrapping-secret; openssl rand -hex 32 > /etc/apn/http-token'
sudo install -o apn -g apn -m 0600 policy.json /etc/apn/global-policy.json
```

`/etc/systemd/system/apn.service`:

```ini
[Unit]
Description=Agent Payment Node (server mode)
After=network-online.target

[Service]
User=apn
Environment=APN_SERVER_MODE=1
Environment=APN_STATE_ROOT=/var/lib/apn/state
Environment=APN_WRAPPING_SECRET_FILE=/etc/apn/wrapping-secret
Environment=APN_GLOBAL_POLICY_FILE=/etc/apn/global-policy.json
Environment=APN_HTTP_LISTEN=127.0.0.1:8402
Environment=APN_HTTP_TOKEN_FILE=/etc/apn/http-token
ExecStart=/usr/bin/node /opt/apn/bin/apn.js serve http
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/apn/state /etc/apn

[Install]
WantedBy=multi-user.target
```

Keep the wrapping secret out of backups of the state root: the state holds only envelopes encrypted under it.

## HTTP API

```
GET  /v1/health                         → { ok, version }
GET  /v1/tools[?names=apn_wallet_status,…] → { tools: [{ type: "function", function: { name, description, parameters } }] }
POST /v1/tools/call  { name, arguments } → one apn.cli.v1 envelope
```

Every request needs `Authorization: Bearer <token>`. `arguments` may be an object or the JSON string an OpenAI-style
tool call carries. Every argument value is a string, amounts included; a number is refused rather than rounded. At
most 32 calls run at once; the 33rd answers 503 `APN_HTTP_BUSY`.

The tool list is 109 tools (about 130 KB). Pass `?names=` with the tools an agent needs to keep each model request small.

## A model through OpenRouter

`scripts/openrouter-agent.mjs` is one complete agent loop: it reads the tools from `/v1/tools`, sends them to an
OpenRouter model (Qwen, DeepSeek, Kimi, GLM and others), runs each tool call through `/v1/tools/call` and feeds the
envelope back. Keys come from files, never argv.

```sh
OPENROUTER_API_KEY_FILE=/etc/apn/openrouter-key APN_HTTP_URL=http://127.0.0.1:8402 APN_HTTP_TOKEN_FILE=/etc/apn/http-token \
  node scripts/openrouter-agent.mjs --model qwen/qwen3-max \
  --tools apn_wallet_status,apn_wallet_balance,apn_pay_transfer_prepare_asset,apn_pay_transfer_approve,apn_operation_status \
  --task "Pay 0.01 USDC on Base from profile treasury-7 to 0x…; confirm it landed."
```

## Limits known today

- A server state root must always run with `APN_SERVER_MODE=1`: the foreground build refuses it, because only server
  mode keeps the per-claim markers of the operation index. Records written into the state root by hand are not
  indexed after the first walk.
- MetaMask gasless, facilitator and Smart Account families read every record of their family on create; they need
  provider logins and are not a server path.
- One process serves HTTP; run several behind a balancer only on one shared state root with a POSIX file system.
