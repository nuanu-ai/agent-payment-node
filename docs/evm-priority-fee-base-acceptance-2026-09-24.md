# Base ETH priority-fee acceptance — 2026-09-24

This evidence records C2-11 separately at the installed no-money and paid proof layers.

## Active policy

- Profile: `evm-live-buyer`, policy revision 10.
- Seven earlier admissions remain intact.
- Base ETH direct self-test cap: `1e12 wei/day`.

## Installed no-money prepare

- Operation: `9fc41c78c11681cb8c206111f608e0e2c640cb73387d5df3f9aa42163aeef560`.
- Explicit priority tip: `0.1 gwei`.
- Fee budget: `50000000000000 wei`; quote: `2342911669838 wei`.
- This was a prepare observation; it did not make the paid transfer.

## Paid Base transaction

- Transaction: `0x2c5e738683fadc20ea493f022abd2cf5408bd2c5d1e291d65de3357c2a6abfb8`.
- Block: `51717017`; receipt status: `1`.
- Actual total fee: `2212310987002 wei`, including L1 fee.
- APN journal and receipt reached completed state and were verified at inclusion.

No explicit negative over-budget refusal was performed. The observed quote and actual fee were below the recorded fee budget; above-budget refusal behavior remains untested.
