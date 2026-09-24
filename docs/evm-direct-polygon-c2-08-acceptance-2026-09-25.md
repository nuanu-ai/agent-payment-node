# C2-08 Polygon USDC acceptance evidence — 2026-09-24 UTC / 2026-09-25 Bali local

This ledger records one accepted Polygon PoS USDC transfer for C2-08. The
network receipt and APN observation are separate from source/CI and the
pre-send attempts below. C2-08 remains in progress at 5/8 networks.

## Code and CI

The run used APN main commit `ca4d3fb2d3ba88397248155bf01fc32b264515af`,
which includes merged [PR #293](https://github.com/nuanu-ai/agent-payment-node/pull/293)
for observation-only direct-transfer resume. PR #293 source and CI evidence
are separate from this paid transfer acceptance.

## No-money pre-send attempts

The initial PublicNode `approve` returned a protocol error before send. One
PublicNode resume then stopped before send on a malformed block. Neither
attempt broadcast a transaction or moved USDC.

## Paid transfer and receipt

- Active owner policy: revision 17; digest
  `b9831f612e3c9468a93141cdef63e952a8f1f0bf1058cda6366ff15f17c25127`.
- Network: Polygon PoS (`eip155:137`). Asset: canonical USDC,
  `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` (6 decimals).
- Transfer: `50000` atomic (`0.05` USDC) from buyer
  `0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7` to seller
  `0x991e254B5C8e0AAf6c244eaa2706BAd059809b04`.
- One dRPC resume made the first accepted broadcast. APN operation:
  `612feee22a0fb4db339408bff51aef20ecd11883bc19f353504094eed27be21b`.
- Transaction:
  `0xd07c3d6fb90847b68832f1ce9a5230b3ef358fafa583f82b16655f7993ab5a69`.
  Receipt status `1`, block `94387120`, block hash
  `0x0fa7451433b40abb6fdcb170dd85073b8ced74576f6fe23ee9cb924b71050f15`.
- The ERC-20 Transfer event records exactly `50000` atomic from buyer to
  seller. Adjacent-block USDC balances changed from `99989` to `49989` atomic
  for the buyer and from `200000` to `250000` atomic for the seller.
- Prepare quoted maximum execution cost `32973256737299062 wei`
  (`0.032973256737299062 POL`) under a `50000000000000000 wei` (`0.05 POL`)
  fee budget. The quote is a pre-submission upper estimate, not the fee paid.
  Actual receipt gas cost was `12690759713428059 wei`
  (`0.012690759713428059 POL`).

## APN observation and finality

After CI, one observation-only resume at `2026-09-24 22:01:04 UTC` moved the
already-submitted operation from `submitted_pending` to `completed` using
`included_transfer_event_and_block_balance_deltas`; it finalized the usage
reservation once. This performed no new signature or broadcast. APN finality
is `inclusion_only`, matching the required Polygon `Inclusion` entry in the
[direct runbook](evm-direct-live-acceptance-2026-09-19.md). No safe or finalized
status is claimed.

Polygon is accepted as the fifth C2-08 network. BNB Smart Chain, Monad and
Sei EVM remain open for their own current-policy prepare and accepted receipt.
