# Jupiter historical retirement records (read-only legacy)

APN releases up to 0.5.44 shipped a CLI-only procedure (`swap solana jupiter historical-authenticate` and `historical-retire`) for three fixed Jupiter operations of one owner profile: `67cec83f…`, `ea25d97d…` and `ed04535c…`. All three closed as `expired_unlanded` on 0.5.43 through the generic swap expiry proof (owner check, 2026-10-17). Releases after 0.5.44 remove the authenticator, the canonical future-invalidity scanner, the retirement writer and both hidden commands.

What stays is the reader in `src/legacy/jupiter-historical-retirement/`. A state that holds a `jupiter-historical-retirements/<operationId>.json` record must keep loading its SOL usage bucket, so `AssetUsageLedger` still projects such a record:

- the record is checked against its own `recordHash`, the stored original operation, the original reservation row bytes and the policy calculation recomputed from the registry the record carries. Route identities are frozen literals in `pins.ts`, not live Jupiter constants;
- on its `accountingAt` UTC day the record replaces the original 1,000,000-lamport hold with 6,000,000; on later days it contributes zero and the original hold stays suppressed;
- a reservation bound by a record cannot be transitioned (`asset-usage-ledger.ts`, `transition`).

Nothing in APN writes such a record any more. The module has no writer, key access, RPC, signing or sending. `tests/core/legacy-jupiter-historical-retirement.test.ts` keeps the codec, the usage projection and the refusals covered with sealed fixtures.
