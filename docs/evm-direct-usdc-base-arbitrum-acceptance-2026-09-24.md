# Base and Arbitrum USDC direct acceptance evidence — 2026-09-24

This ledger records paid transfer and finality evidence for C1-12. It does not establish completion of the full 9-network no-money prepare matrix or the separate Base gasless proof. The Base transfer is completed proof for one direct lane. The Arbitrum transfer has terminal APN confirmation at `rpc_safe_inclusion` for that route; this ledger does not close the full C1-12 row.

## Base USDC transfer

- Owner policy: `evm-live-buyer` revision 11; digest `c85c830adef4b3c28fec6e47a32cc720ac8edea9bcac7e644dd0da12169d0770`.
- APN operation: `eed769b1e4449af2ae5d835388c62e81debb99b1cf6103ffbf5a126930c10d0f`; terminal status `completed`.
- Transaction: `0x8491435e282131bd99ab3dac228da3e236f834dd7f4d9bfe8cc6c7401a993877`.
- Exact sender debit and recipient credit: `10000` atomic units.
- Actual total fee: `271248100875 wei`.

## Arbitrum USDC transfer

- Current owner policy: revision 12 preserves nine revision-11 admissions and adds Arbitrum USDC at `10000` atomic units per day.
- APN operation: `b50b98f32df72b536d9b65dfb4bb9e7cea64e64139f442a653f9925a570cd809`; terminal status `completed`, confirmation `confirmed_exact_erc20_transfer`, finality `rpc_safe_inclusion`.
- Transaction: `0x83d399ca8f775d34f0a513e1f997c54dda558c04678056fce1997e45054ca774`; successful inclusion at block `508339240`; receipt hash `5850bec974e5e902cfa95503b5b2048dd63359904d126ee964a13734fbfbf603`.
- Exact buyer debit and seller credit: `10000` USDC atomic units.
- Actual inclusive fee from the live receipt: `1257987710000 wei`.
- One safe-head read at `2026-09-24T05:13:01Z` returned block `508342093`, 2853 blocks above receipt block `508339240`. One observation-only resume then confirmed terminal APN status. No rebroadcast occurred.

C1-12 remains in progress for remaining no-money prepares, direct network acceptance, and the separate Base gasless receipt.
