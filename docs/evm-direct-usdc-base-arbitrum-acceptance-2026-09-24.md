# EVM direct token acceptance evidence — 2026-09-24

This ledger records paid transfer evidence for C1-12. It does not establish completion of the full 9-network no-money prepare matrix or the separate Base gasless proof. The Base and Arbitrum routes have completed APN paid receipts, with Arbitrum at `rpc_safe_inclusion`; the Ethereum route has a completed APN receipt at `inclusion_only`. This ledger does not close the full C1-12 row.

## Base USDC transfer

- Owner policy: `evm-live-buyer` revision 11; digest `c85c830adef4b3c28fec6e47a32cc720ac8edea9bcac7e644dd0da12169d0770`.
- APN operation: `eed769b1e4449af2ae5d835388c62e81debb99b1cf6103ffbf5a126930c10d0f`; terminal status `completed`.
- Transaction: `0x8491435e282131bd99ab3dac228da3e236f834dd7f4d9bfe8cc6c7401a993877`.
- Exact sender debit and recipient credit: `10000` atomic units.
- Actual total fee: `271248100875 wei`.

## Arbitrum USDC transfer

- Owner policy: revision 12 preserves nine revision-11 admissions and adds Arbitrum USDC at `10000` atomic units per day.
- APN operation: `b50b98f32df72b536d9b65dfb4bb9e7cea64e64139f442a653f9925a570cd809`; terminal status `completed`, confirmation `confirmed_exact_erc20_transfer`, finality `rpc_safe_inclusion`.
- Transaction: `0x83d399ca8f775d34f0a513e1f997c54dda558c04678056fce1997e45054ca774`; successful inclusion at block `508339240`; receipt hash `5850bec974e5e902cfa95503b5b2048dd63359904d126ee964a13734fbfbf603`.
- Exact buyer debit and seller credit: `10000` USDC atomic units.
- Actual inclusive fee from the live receipt: `1257987710000 wei`.
- One safe-head read at `2026-09-24T05:13:01Z` returned block `508342093`, 2853 blocks above receipt block `508339240`. One observation-only resume then confirmed terminal APN status. No rebroadcast occurred.

## Ethereum USDT direct transfer

- Active owner policy: `evm-live-buyer` revision 13; digest `2d5a6fb56369a65a204841d60991b0ec7f55f2402669a9d7cc1c993cf3fe5fa6`. It preserves 10 revision-12 admissions and adds only Ethereum (`eip155:1`) canonical USDT direct at `10000` atomic units per operation per day.
- An installed prepare succeeded before the single paid submission.
- APN operation: `49da47ace543c45880dbf4757548301eed1761943b2289a9e9fe27a6abbe636f`; terminal status `completed`, confirmation `confirmed_exact_erc20_transfer`, proof `included_transfer_event_and_block_balance_deltas`, finality `inclusion_only`.
- Transaction: `0x7657c2803fa984f1fe788b0b1db1e675c6a3f368969c76af3d475d0dc56e8ef6`; block `26045404`; receipt hash `f7ab453b23bbf1aaf8b465ff9b16caa41568b578100ed315b293880afb570f32`.
- Verified exact buyer debit and seller credit: `10000` atomic USDT; transfer log and block-balance deltas were verified.
- Actual fee: `4622519241340 wei` (`0.00000462251924134 ETH`), below the `50000000000000 wei` budget.
- One submission occurred. The first resume reported `unknown_finality`; one observation-only Pocket read and APN resume reconciled the receipt. No resend occurred. Finality remains `inclusion_only`, not safe-finalized.

C1-12 remains in progress for remaining no-money prepares, direct network acceptance, and the separate Base gasless receipt.
