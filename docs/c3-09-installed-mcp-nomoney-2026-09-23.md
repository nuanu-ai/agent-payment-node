# C3-09 installed MCP no-money check — 2026-09-23

## Identity and boundary

Source: `origin/main` `5b4ec24fc7b06c0572438aa3b9feeeaf2e362d36` (PR #237 merge). Candidate: `@nuanu-ai/apn` `0.5.26`, packed with `npm pack --ignore-scripts --json`; local tarball `nuanu-ai-apn-0.5.26.tgz` SHA-256 `cee56ad29385627d9bad8eeed8a59d902eb0e17fa75f643fc99795c37efb05d5`. The tarball was installed under `/private/tmp/apn-c309-installed-nomoney-20260923-prefix`, without changing Homebrew or `~/.apn`.

The packaged binary's `mcp config` returned the stdio descriptor. An official MCP client connected to that binary, listed 92 tools including all seven Ethereum Uniswap token tools, and received `APN_FOREGROUND_APPROVAL_REQUIRED` plus exact CLI handoffs for `approve`, `execute`, and `cleanup`. Those binary calls used an arbitrary valid operation ID and were intercepted before runtime dispatch.

The package's installed MCP/runtime modules were then exercised with an official in-memory MCP client, an isolated state root, synthetic profile/key/policy, fixed clock, deterministic RPC port, and stubbed code-pin verifier. This is a package-byte execution, but the quote/prepare/status path is not a subprocess CLI run. It made zero public RPC requests and no paid effect.

| Action | Result | Physical RPC | Logical items | Journal cap | Broadcasts |
| --- | --- | ---: | ---: | ---: | ---: |
| USDT→USDC quote | `ok`, expected output `1000000` atomic; hash `64639378c8d1e525e7d2a61d0f47b3fa867c61e96e98ffb2fdd68133fa7f9e24` | 4 | 7 | 8 | 0 |
| Prepare | `prepared`, operation `1a39bca608df4b84e08f67238dd85bd7a197a6cf5708678fc5e2efd0fd4a3680`; approval/swap attempts null | 5 | 10 | 9 | 0 |
| Status | `prepared` | 0 | 0 | 0 | 0 |
| Approve/execute/cleanup | Each refused with `APN_FOREGROUND_APPROVAL_REQUIRED` and exact `apn swap ethereum uniswap-token <action> --operation <id>` handoff | 0 | 0 | n/a | 0 |

The RPC journal recorded attempts equal to physical requests (4, 5, 0) and zero budget rejects. Mock transport observed zero `eth_sendRawTransaction` calls. Signing/sealing were not directly instrumented; the MCP effect actions were intercepted before dispatch and operation attempts remained null. This does not prove signer behavior in a foreground CLI run.

## Current owner policy read

A separate read copied only `~/.apn/allowlist-policies` and `~/.apn/allowlist-activations` into another temporary state root; it did not open or copy wallet secrets. At `2026-09-23T07:41:16.449Z`, `evm-live-buyer` active revision 8 had digest `dcdd15c939ae013dbb33d68746eb5c258f66691018c54f1e4eefb5312bb17a64` and expiry `2026-10-01T12:00:00.000Z`. Ethereum USDT and USDC were admitted for swap at maximum `3000000` atomic each. A packaged-module MCP USDT→USDC quote against this copied policy and the deterministic RPC port returned `ok` with 4 physical/7 logical reads, zero sends. The exact current policy and account were loaded from the copied activation; the account is not recorded here.

Current-owner-policy **prepare is not accepted** by this check: the isolated state has no owner wallet/keychain material for `evm-live-buyer`, and importing it would cross the no-real-credentials boundary. The synthetic prepare above does not stand in for that step. Live provider/code-pin behavior and paid execution also remain open.

## Reproduce

From a clean worktree at the source commit, use a fresh temporary prefix and the versioned harnesses:

```sh
npm pack --ignore-scripts --json > /private/tmp/apn-c309-pack.json
shasum -a 256 nuanu-ai-apn-0.5.26.tgz
npm install --prefix /private/tmp/apn-c309-installed-nomoney-20260923-prefix --ignore-scripts --no-audit --no-fund ./nuanu-ai-apn-0.5.26.tgz
npm install --prefix /private/tmp/apn-c309-installed-nomoney-20260923-prefix --ignore-scripts --no-audit --no-fund @modelcontextprotocol/client@2.0.0
cp tests/packaging/fixtures/installed-c309.mjs /private/tmp/apn-c309-installed-nomoney-20260923-prefix/installed-c309.mjs
cp tests/packaging/fixtures/current-policy-quote.mjs /private/tmp/apn-c309-installed-nomoney-20260923-prefix/current-policy-quote.mjs
node /private/tmp/apn-c309-installed-nomoney-20260923-prefix/installed-c309.mjs
APN_OWNER_STATE_ROOT=/Users/tony/.apn node /private/tmp/apn-c309-installed-nomoney-20260923-prefix/current-policy-quote.mjs
```

The first harness is deterministic and needs no owner state. The second is a time-sensitive read of Tony's current policy and should be rerun after any policy activation. Both clean up their temporary state copies. The temporary npm prefix is disposable; the user's installed APN is unchanged.
