# USDm merchant adapter source evidence

Worktree: `worktrees/apn-usdm-vendor-x402-20261009`; baseline `0bf2c917a1bebba6a1175f2f353e20df1e4abcf5`. Central active cherry-pick was not edited. No live policy/profile/install/payment/custody/signing/broadcast/merchant proof action occurred.

The finite merchant adapter separates one exact ERC20 payment from external merchant delivery. Normal CLI prepare/approve/observe/status paths and explicit MCP foreground handoff are discoverable; generic EIP-3009/Permit2 codec and network selection stay separate. Shared operation conflict/idempotency integration and strict owner policy mechanism admission protect the normal account boundaries.

Read-only public MegaETH probes saved token/implementation code for tests and verified finalized-block compatibility and empty default owner code. These probes contain no financial effect. The token code fixture is in `tests/core/merchant-code-fixture.json` with its source URL and timestamp.

`merchant-tests.log` records the fixture suite; `build-test.log`, `build.log`, `regressions.log`, `shipping-surface.log` and `cli-help.txt` record source/shipping checks. Tests use temporary private state and synthetic RPC/HTTP/custody dependencies. The positive fixture uses a trusted synthetic custody verifier; it does not claim an actual signature by the real default wallet. Production custody always verifies the recovered owner and full frozen signed envelope, clears imported key material, and stores create-only AES-256-GCM signed bytes.

Paid acceptance remains required: a genuine canonical finalized exact USDm Transfer and genuine upstream HTTP 200 Bitcoin-price delivery, both recorded through these ordinary commands. Funding and exact owner policy activation are separate root-owned work.

Final QA: official production and test TypeScript builds passed; 32/32 merchant fixture tests and 110/110 legacy/discovery/conflict/policy/x402 regression tests passed. The forbidden shipping surface and 500-line scan passed across 760 files. A repeated production build produced identical SHA-256 bytes for all 2,280 dist files; `build-parity.log` records the rebuild and `dist-parity.json` records the count. `git diff --check` passed.
