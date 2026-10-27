# Circle Base to Solana delivery

Public mainnet reads captured on 2026-10-25 for two QA operations, Base USDC burns forwarded by Circle to Solana:

| Burn | Base transaction | Solana receive (`forwardTxHash`) | Recipient token account |
|---|---|---|---|
| 170000 atoms (`dec35c91…`) | `0x070e963f…186301f` | `2M7FC4Tw…opt5ppV`, slot 458899277 | `BJRwCA3C…ubgqy` (existed) |
| 1000000 atoms (`0e6829d4…`) | `0xf4fa51b6…2e3378` | `5kbzTzCC…mqZUSmrg`, slot 459196902 | `gYgbhjCM…feuVr7` (created by the receive) |

- `base-receipt-<amount>.json`: the `result` of `eth_getTransactionReceipt` for the Base transaction (captured
  2026-10-27); its one `MessageSent` from MessageTransmitterV2 `0x81d40f21…4b64` (log 183 and 575) is the attested message
  with nonce and executed finality still zero.
- `iris-message-<amount>.json`: `GET https://iris-api.circle.com/v2/messages/6?transactionHash=<Base transaction>`.
- `solana-receive-<amount>.json`: the `result` of `getTransaction` for the receive with `encoding: "jsonParsed"`,
  `commitment: "finalized"`, `maxSupportedTransactionVersion: 0`.
- `used-nonce-signatures-170000.json`: the `result` of `getSignaturesForAddress` for the message's used-nonce account
  `HQmwr7wL…NYvvnM` (PDA `["used_nonce", nonce]` of MessageTransmitterV2) with `commitment: "finalized"`, `limit: 8`.
