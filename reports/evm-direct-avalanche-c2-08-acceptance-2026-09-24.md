# C2-08 Avalanche native acceptance evidence — 2026-09-24

This ledger records one completed Avalanche C-Chain native AVAX transfer for
C2-08. Together with the Optimism transfer, this is two of the eight required
network rows; six remain open.

## Active policy and transfer

- Network: Avalanche C-Chain (`eip155:43114`); asset: native AVAX.
- Active owner policy: revision 15; digest
  `7cc8de316df1e86df6003081e1bff18335d877f9c68108b282b941c2ac2da954`.
  It preserved 12 prior admissions and allows native AVAX up to `1000000000000`
  wei per operation and per day.
- Transfer: `1000000000000 wei` from buyer to seller.
- APN operation:
  `3731574964b92f8982786b3b049303bb6cd1c56fb5d6d372958f432fb332b0da`;
  terminal status `completed`, result `confirmed_exact_native_transfer`.
- Transaction:
  `0x260d24cc0faefca7e3d3b41fec3adcde8943fc05692b39eaf1fff0f6207711a9`,
  receipt block `96050399`.
- APN finality label: `inclusion_only`. Separate safe-head evidence reached at
  least the receipt block; this observation does not change the APN label.
- Exact buyer debit: `2750467915000 wei`; exact seller credit:
  `1000000000000 wei`; actual fee: `1750467915000 wei`.
- One send; no retry. The APN operation trace made 60 physical JSON-RPC calls.
  Two additional read-only RPC batches were separate from that operation trace.

## Remaining C2-08 rows

Optimism and Avalanche are accepted (2/8). Polygon PoS, BNB Smart Chain,
Unichain, Linea, Monad and Sei EVM remain open for their current-policy
prepare and separate receipt at each network's required finality. C2-08 remains
in progress.
