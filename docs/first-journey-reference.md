# First journey: a direct Base USDC transfer

[Documentation index](README.md) · [Product overview](../README.md)

This section was moved from the APN README without changes to its text.

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
transaction. Completion needs the exact receipt and Transfer log at the network's required finality. `receipt get` names
the frozen profile, chain, token, sender (`wallet_address`), recipient and amount, as `operation status` does. The same commands
work for native coins (`--asset native`) and every listed token on the eleven direct EVM networks; see
[EVM asset transfers](evm-assets.md) and [direct transfers under the allowlist](allowlist-direct-integration.md).
Solana and TRON have their own `-solana`/`-tron` commands ([Solana](solana.md), [TRON](tron.md)).

If a transfer stalls, `operation resume --operation <id> --rpc-url <url>` performs only the next legal transition
(`--observe-only true` inspects an already submitted local EVM transfer without custody access; Solana and TRON refuse it: their plain resume never resends a possibly broadcast transfer, but sends an approved, never-sent one for the first time).
A plain resume of a local EVM transfer sends a signature APN never dispatched, once. After a dispatch it can pass the
same signed transaction to the RPC again, only when the RPC holds neither a receipt nor the transaction for the saved
hash and the sender's finalized nonce is not past the frozen nonce. The hash and nonce are the same, so at most one copy
can be included; APN never signs a second transfer. `operation abandon` lets the
owner close an eligible operation whose outcome cannot be proven, after accepting the unresolved risk in the terminal.
A saved record APN can no longer read blocks only the accounts it names; `operation abandon` releases those claims after
the same terminal consent and leaves the file and any usage-ledger reservation as they are, so the amount stays charged.
