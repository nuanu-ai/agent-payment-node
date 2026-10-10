# Canonical WBTC Across approval continuation

The paid Ethereum approval-only operation `744a5f567bafa888f4dd38b85fb9e344058271bbf5cc01ad1651447cb663942b` exposed a controller budget mismatch. Its included approval observation used 11 physical POSTs. Fresh canonical source/destination WBTC deployment verification and account/simulation consumed 17 more, then the second pre-send guard consumed two. The one permitted send needs another POST: 31 total. The shared physical gate allowed 24, although the independent execution read session allowed 28. Normal resume repeatedly left the bridge unsigned until the five-minute intent expired.

The old operation is preserved as `failed_after_approval`: approval transaction `0x49f5280d05748ac78a327348cd9e5ffb897af1f255522531f495abd1ebfe48c3` is SAFE, bridge submission attempts remain zero, and residual allowance is exactly 1000 atomic at block 26152332. No bridge principal moved. A new prepare can use the reviewed exact existing allowance; the expired intent cannot be revived.

The typed `canonical_wbtc_across_approval_continuation` policy permits at most 33 physical POSTs only for canonical Ethereum/Arbitrum WBTC, Across, the original full-refresh approval policy binding, one marked approval that has not reached SAFE and one unmarked bridge effect, with unchanged registry contract/code/configuration pins. Ethereum to Arbitrum needs 31; Arbitrum to Ethereum needs 33 because its token beacon/implementation history adds two physical POSTs. All other operations retain the 24 POST default. The normal two guards, canonical transaction membership, historical deployment verification, fee/nonce/allowance checks, 750ms pacing, existing read-attempt bounds, and single-send markers remain intact. No serialized intent, receipt or historical pin changes.

The deterministic tests use captured public Ethereum approval/runtime reads and a synthetic offline Arbitrum approval served solely by a test transport. They assert both complete call graphs, failure under the old24 cap before signing/sending, archive batches of at most three, route/pin eligibility, exhausted unsigned recovery, retention of the original approval hash, one bridge send, and no resend. See [physical POST trace](evidence/wbtc-continuation-20261009/physical-post-trace.txt).

Ethereum to Arbitrum is the funding leg. Original C1-09 acceptance remains Arbitrum to Ethereum WBTC and requires its own fresh owner-approved quote and both-chain SAFE receipt. No new financial operation was executed by this source fix.

## Fresh WBTC effect authority

Canonical Across WBTC between Ethereum and Arbitrum now freezes the owner policy's activation digest during normal preparation. Revoking and reactivating the same revision changes that binding. An older WBTC journal without this binding remains readable, cancellable and observable; it cannot approve, sign or send a new financial effect.

Each invocation that can sign or first-send an unattempted WBTC effect requires foreground confirmation. Its private grant starts when that confirmation succeeds and ends after 60 seconds, at the original operation expiry, or at the active policy expiry, whichever comes first. Persisted approval timestamps cannot recreate this grant. Submitted, unknown or unresolved signing effects remain observation-only and do not request another confirmation.

The normal service holds wallet custody, wallet/profile, true policy profile and EVM owner locks through the effect boundary. Policy activation, owner identity and the exact charged usage hold are checked again after wallet loading, before decrypting and signing, and after RPC pacing, DNS and TLS immediately before `request.end`. These file checks add no RPC requests. Existing route pins, fee/nonce checks and the typed 31/33 POST graphs remain unchanged.

Create-only, fsynced SIGN and SEND claims bind each effect to the full intent, fingerprint and envelope; SEND also binds its sealed material and transaction hash. They live outside the mutable operation and usage journals. Restoring those journals or removing a usage hold cannot recreate a financial effect. An ambiguous claim or send stays unavailable for replay.

Fresh preparation still accepts an exact retained allowance of 1000 for an exact 1000 WBTC request and creates one bridge effect. Another nonzero allowance refuses. It does not authorize continuing the expired historical bridge.
