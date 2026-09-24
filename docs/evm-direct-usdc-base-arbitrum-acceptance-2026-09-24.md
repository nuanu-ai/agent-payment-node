# Base and Arbitrum USDC direct acceptance evidence — 2026-09-24

This ledger records paid transfer and finality evidence for C1-12. It does not establish completion of the full 9-network no-money prepare matrix or the separate Base gasless proof. The Base transfer is completed proof for one direct lane. The Arbitrum transfer is an on-chain inclusion whose APN operation has not reached safe finality; this ledger does not close C1-12.

## Base USDC transfer

- Owner policy: `evm-live-buyer` revision 11; digest `c85c830adef4b3c28fec6e47a32cc720ac8edea9bcac7e644dd0da12169d0770`.
- APN operation: `eed769b1e4449af2ae5d835388c62e81debb99b1cf6103ffbf5a126930c10d0f`; terminal status `completed`.
- Transaction: `0x8491435e282131bd99ab3dac228da3e236f834dd7f4d9bfe8cc6c7401a993877`.
- Exact sender debit and recipient credit: `10000` atomic units.
- Actual total fee: `271248100875 wei`.

## Arbitrum USDC transfer

- Current owner policy: revision 12 preserves nine revision-11 admissions and adds Arbitrum USDC at `10000` atomic units per day.
- APN operation: `b50b98f32df72b536d9b65dfb4bb9e7cea64e64139f442a653f9925a570cd809`; current status `unknown_finality`.
- Transaction: `0x83d399ca8f775d34f0a513e1f997c54dda558c04678056fce1997e45054ca774`; successful inclusion observed at block `508339240`.
- Transfer: `10000` atomic units; fee `1257987710000 wei`.
- At the final 24 Sep 2026 05:04:41 UTC observation, safe head remained `508338798`, 442 blocks below receipt block `508339240`. The APN operation is not complete at safe finality and this transfer is not counted as accepted completed proof.

C1-12 remains open for the remaining direct network acceptance and separate Base gasless receipt.
