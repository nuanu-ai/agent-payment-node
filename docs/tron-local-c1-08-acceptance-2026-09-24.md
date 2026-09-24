# `tron-local` C1-08 acceptance evidence — 2026-09-24

C1-08 remains in progress. The bounded 0.1 TRX and canonical USDT transfers to fixture B now have terminal solidified receipts and exact receiving evidence. The card's acceptance rubric also calls for interrupted-execution/no-rebroadcast evidence; the records below show one submission for each completed transfer, but do not establish recovery behavior after an interrupted paid execution. The earlier 16 TRX funding operation remains `abandoned_unknown` with usage charged.

## Owner policy and no-money prepare

- The earlier installed no-money 0.1 TRX prepare succeeded under `tron-local` policy revision 3 after merged PR #252 added paced TRON RPC POST spacing. This prepare did not send funds.
- The later 16 TRX fixture activation used policy revision 4, digest `752c5acf78832ac53f20d76aca6de2ad10244d606a0fc076407e40122befbf2a`.

## Accepted TRX transfer

- Sender: `tron-local`, `TCik...`; recipient: fixture B, `TKnb...`.
- Amount: 0.1 TRX; one submission.
- Transaction ID: `265c082ee1922d2ea7562e5b0357a8b4d3a5e4eac96b7f965fe8c095127f7112`.
- Solidified block: `86518352`.
- APN status: `completed`; result: `tron_solidified_transaction_effect`; receipt hash `b492597518771336b3f463e9bf3a8f95b2670d065215cd97417f3bbc62094418`.
- Sender and recipient were verified. Actual fee was 1.1 TRX for activation and bandwidth.

This accepts only the bounded TRX paid transfer; it does not close the USDT half or C1-08.

## Completed fixture A activation

- A separate 16 TRX funding operation activated fixture A: APN operation `e9de65752b79fe1f261c51e4ae20e6cdb7de16a30299b5323cd8886410b3330d`, terminal status `completed`.
- Transaction ID `6195294f785a2073f081666ea1a710b7044ca382913ad87546c88b1f94376235`; solidified block `86520779`.
- One submission completed. Actual fee: 1.1 TRX. The recorded sender balance changed from 42.613251 TRX to 25.513251 TRX.
- This successful operation is distinct from the earlier unknown funding operation below; it does not resolve or replace that journal entry.

## Prior unresolved funding operation

- Earlier funding operation: `0b46bacb98769558ac9a99f3316bb9246bdd53f898238c5c3591f4d6d584eee6`; 16 TRX; transaction ID `b562b3de6401bc796c994f0d4d055c807e05ba6be3eaef5f1cc7cbea9b5ccbc9`.
- It reached `unknown_finality`. After signed-transaction expiry, a fresh solidified lookup returned empty transaction body/info; at that earlier observation, fixture A was still unactivated with 0 TRX.
- Owner acknowledgement recorded `abandoned_unknown` / `owner_acknowledgement_only` with evidence `null`. This operation's 16 TRX policy usage remains charged as `unknown_finality`.

The later successful activation does not prove the earlier transaction had no effect or that its 16 TRX was lost. Do not conflate the two operations.

## Fixture A USDT funding

- Fixture A funded the APN `tron-local` wallet with 0.1 canonical USDT: transaction ID `5503138d5f7ec60431a0bafede46b546c9361d31a17f55629d11190681d9fd58`, solidified block `86521121`.
- Exact token deltas were `-100000` atomic USDT from fixture A and `+100000` to `tron-local`. Actual resource fee was 13.0285 TRX; one broadcast.
- This funded the subsequent APN-local transfer and is not itself the fixture-B acceptance.

## Expired unsigned USDT attempt

- Earlier unsigned operation `02b135...` expired and reached terminal `failed_before_effect`.
- It had no signature and no broadcast. It is a no-effect prepare outcome, separate from the successful paid transfer below.

## Accepted canonical USDT transfer

- Sender: APN `tron-local`, `TCik...`; recipient: fixture B, `TKnb...`.
- Asset and amount: canonical USDT, `100000` atomic units (0.1 USDT). Exact deltas: sender debit `100000`, recipient credit `100000`.
- APN operation: `e8292b61d3a6dad55bddf1df4879089d391d336e4f7e1085cb6d8e9dded1cb07`; terminal status `completed`, result `tron_solidified_transaction_effect`.
- Transaction ID `0c2fb90f451b71653e3a6fd62a6eacd059a1416edd4becbee98371637188998f`; solidified block `86525875`.
- Actual resource fee: 13.0285 TRX, below the 15 TRX cap. One submission; no retry was made.

The TRX and USDT paid-transfer outcomes are recorded, but no interrupted-execution recovery run for either paid transfer is recorded. Keep C1-08 `in_progress` until that rubric item has evidence; the unsigned `failed_before_effect` attempt is not a substitute for interrupted paid-execution recovery evidence.
