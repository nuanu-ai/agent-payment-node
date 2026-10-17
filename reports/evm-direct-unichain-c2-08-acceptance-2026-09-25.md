# C2-08 Unichain direct USDC acceptance — 2026-09-25

This record documents one accepted 0.1 USDC direct transfer on Unichain mainnet (`eip155:130`). With Optimism, Avalanche and Linea, C2-08 now has four accepted networks out of eight. The network and finality matrix is in the [direct EVM runbook](evm-direct-live-acceptance-2026-09-19.md).

## Source and CI evidence

These source changes are separate from the live prepare and payment evidence below:

- [PR #286](https://github.com/nuanu-ai/agent-payment-node/pull/286) adds direct-read batching. Its deterministic transport test models 22 logical reads as 9 physical POSTs, versus 22 scalar POSTs; this is a source test, not live telemetry for the paid transfer.
- [PR #287](https://github.com/nuanu-ai/agent-payment-node/pull/287) standardizes direct JSON-RPC headers.
- [PR #288](https://github.com/nuanu-ai/agent-payment-node/pull/288) makes `unknown_finality` recovery observation-only, without another send.
- The [post-main Supply chain run #36057798113](https://github.com/nuanu-ai/agent-payment-node/actions/runs/36057798113) passed build and artifact attestation. This is build/attestation evidence, not the paid receipt.

## Active policy and no-money prepare

- Active owner policy: revision 17, digest `b9831f612e3c9468a93141cdef63e952a8f1f0bf1058cda6366ff15f17c25127`; it preserved 14 prior grants and contains five direct-transfer entries.
- Asset: canonical Unichain USDC, token `0x078D782b760474a361dDA0AF3839290b0EF57AD6`.
- Prepared amount: `100000` atomic USDC (`0.1 USDC`). APN operation: `56cd43e74a7662aee3fdf4667e32a4fcad20e3e9a4c739f450f39fa33170505f`.
- The PublicNode prepare used 9 physical batch POSTs. Its quoted total was `140105880345 wei`, below the `8000000000000 wei` native debit budget. This quote is an upper estimate, not an actual gas charge; no actual gas fee is claimed here.

## Paid receipt and observation-only recovery

There was one foreground approval/send attempt and no retry. APN initially reported `unknown_finality`. A later observation-only resume read the receipt and transfer evidence, then recorded terminal `completed`; it did not sign, send or rebroadcast.

- Transaction: [`0xaf26fc29abd202714dbba290d104f42e06fa35a4b47771857706179ed66b4b7d`](https://uniscan.xyz/tx/0xaf26fc29abd202714dbba290d104f42e06fa35a4b47771857706179ed66b4b7d), successful receipt in block `59533305`, block hash `0x24b68001595d3f90064e81f0e55cf870394f8a6a09ab098f13895aecd5438ab0`.
- APN result/proof: `completed`, `included_transfer_event_and_block_balance_deltas`; finality remains `inclusion_only`.
- The exact canonical USDC `Transfer` log records the `100000` atomic transfer. On adjacent blocks, the buyer changed from `944747` to `844747` atomic USDC and the seller from `0` to `100000`, as read through the official [Unichain mainnet RPC](https://mainnet.unichain.org/).
- APN receipt integrity hash: `e794fe4b4d2e0426fa8747c339b2fcf740955fd879440470d5f5cb6f4b7b852c`.
- Usage lease/reservation `06ff27562404ab5cab1f1ddb81b877ee25212f064d62b096bf8e18903c90ebc7` finalized once for `100000` atomic USDC.
- A separate later `safe`-tag observation advanced beyond block `59533305`; APN's recorded finality remains `inclusion_only`, so this record does not claim safe finality.

## Remaining C2-08 networks

Optimism, Avalanche, Linea and Unichain are accepted (4/8). Polygon PoS, BNB Smart Chain, Monad and Sei EVM remain open for their individual current-policy prepare and accepted receipt. See the [Optimism ledger](evm-direct-optimism-c2-08-acceptance-2026-09-24.md), [Avalanche ledger](evm-direct-avalanche-c2-08-acceptance-2026-09-24.md), and [Linea ledger](evm-direct-linea-acceptance-2026-09-24.md).
