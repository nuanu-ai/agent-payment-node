# `tron-local` C1-08 acceptance evidence — 2026-09-24

C1-08 remains open. This ledger separates the completed TRX acceptance from the unresolved USDT funding path.

## Owner policy and no-money prepare

- Active `tron-local` owner policy revision 3 admits 0.1 TRX and 0.1 USDT per operation with a 0.2 daily cap; it expires 1 Oct 2026.
- After merged PR #252 added paced TRON RPC POST spacing, one installed no-money 0.1 TRX prepare succeeded. This prepare did not send funds.

## Accepted TRX transfer

- Sender: `tron-local`, `TCik...`; recipient: fixture B, `TKnb...`.
- Amount: 0.1 TRX; one submission.
- Transaction ID: `265c082ee1922d2ea7562e5b0357a8b4d3a5e4eac96b7f965fe8c095127f7112`.
- Solidified block: `86518352`.
- APN status: `completed`; result: `tron_solidified_transaction_effect`; receipt hash `b492597518771336b3f463e9bf3a8f95b2670d065215cd97417f3bbc62094418`.
- Sender and recipient were verified. Actual fee was 1.1 TRX for activation and bandwidth.

This accepts only the bounded TRX paid transfer; it does not close the USDT half or C1-08.

## Unresolved USDT funding path

- Local profile balance: 0 USDT. Fixture A: 2.095165 USDT, unactivated, 0 TRX.
- Attempted funding operation: `0b46bacb98769558ac9a99f3316bb9246bdd53f898238c5c3591f4d6d584eee6`; amount 16 TRX; transaction ID `b562b3de6401bc796c994f0d4d055c807e05ba6be3eaef5f1cc7cbea9b5ccbc9`.
- The operation reached `unknown_finality`. After signed-transaction expiry, a fresh solidified lookup returned empty transaction body/info while fixture A remained unactivated with 0 TRX.
- Owner acknowledgement recorded `abandoned_unknown` / `owner_acknowledgement_only` with evidence `null`. The 16 TRX policy usage remains charged as `unknown_finality`.

These observations do not prove the funding transaction had no effect or that 16 TRX was lost. No replacement payment is represented as completed. C1-08 still needs a resolved funding path and a separate APN-local USDT transfer/receipt.
