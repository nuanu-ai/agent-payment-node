# C2-08 Optimism native acceptance evidence — 2026-09-24

This ledger records one completed Optimism native ETH transfer for C2-08. It
counts as one of the eight network rows beyond the original Ethereum, Base and
Arbitrum set; seven other network rows remain open. The required network and
finality matrix is in the [direct EVM runbook](evm-direct-live-acceptance-2026-09-19.md).

## Active policy and transfer

- Network: Optimism Mainnet (`eip155:10`); asset: native ETH.
- Active owner policy: revision 14; digest
  `586932fbdbb3320908cd9dc231ac565714ebf1a02e235aa996e2528e5ee724c5`.
- Transfer: `0.000001 ETH` from buyer to seller (`1000000000000 wei`).
- APN operation: `cf5d913000fd829768dd43c95b646a006a1f20a633540ccedc6925e374be7f17`;
  terminal status `completed`, result `confirmed_exact_native_transfer`,
  finality `inclusion_only`.
- Transaction: `0x1306b4ab218910d1d73eae91ccf567a46e53267d38c1087c3813f66c09a0ec36`,
  included in block `157317610`.
- Exact buyer debit: `1023196212559 wei`; exact seller credit:
  `1000000000000 wei`; actual fee: `23196212559 wei`.
- One approval was recorded; no retry was made.

## RPC request accounting

The trace's logical/physical request accounting recorded 19 RPC requests during
prepare and 41 during approval, against a public endpoint. Merged PR #259 is a
source change that removes a duplicate chain check in approval funding and is
expected to reduce the approval request count from 41 to 39. No post-merge live
run has verified that reduction. Preserve the recorded request counts in a
follow-up audit of the method mix and repeated work; this record does not claim
that the request volume has been optimized or independently explained.

## Remaining C2-08 rows

Optimism is the first accepted network row (1/8). Polygon PoS, BNB Smart Chain,
Avalanche C-Chain, Unichain, Linea, Monad and Sei EVM remain open for their
current-policy prepare and separate receipt at each network's required
finality. C2-08 remains in progress.
