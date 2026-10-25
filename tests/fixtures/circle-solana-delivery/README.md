# Circle Base to Solana delivery

Public mainnet reads captured on 2026-10-25 for a QA operation (`dec35c91…`), a 170000-atom Base USDC burn
`0x070e963f…186301f` forwarded by Circle to the Solana token account `BJRwCA3C…ubgqy` of `3C2rcV1u…E11Yv`:

- `iris-message-170000.json`: `GET https://iris-api.circle.com/v2/messages/6?transactionHash=0x070e963f27d6f4095f6f91443b1f71f3991f157fc43145a056fda3f6d186301f`.
- `solana-receive-170000.json`: the `result` of `getTransaction` for `2M7FC4Tw…opt5ppV` (Circle's `forwardTxHash`) with
  `encoding: "jsonParsed"`, `commitment: "finalized"`, `maxSupportedTransactionVersion: 0`.
