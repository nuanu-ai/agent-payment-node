# Provider wallets

[Documentation index](README.md) · [Product overview](../README.md)

This section was moved from the APN README without changes to its text.

```sh
apn wallet connect --profile provider-one --provider coinbase-agentic-wallet
apn wallet connect --profile mm --provider metamask-agent-wallet [--auth-method browser]
apn wallet connect --profile sa --provider metamask-smart-account --auth-method browser \
  --permission-cap-usdc-atomic <cap> --permission-expires-at <unix-seconds> --idempotency-key sa-connect-0001
```

Authentication stays in the foreground terminal (MetaMask Smart Account consent opens the browser). APN binds the exact
address the completed provider session reports and fails closed if a later session selects another one
(`APN_PROFILE_DRIFT`, rebind with `--expected-revision`). It never receives QR payloads, browser credentials, provider
tokens, seed phrases or private keys.

- **Coinbase Agentic Wallet** (`awal@2.12.1`): APN durably marks `started` before invoking the provider once; any
  possible effect without proof becomes a no-replay `ambiguous_effect`, and completion needs an independent Base receipt
  with the exact USDC Transfer.
- **MetaMask Agent Wallet** (`@metamask/agent-wallet@6.1.5`, Guard server wallet): direct transfers and x402 use the same
  operation contract; Guard MFA returns `provider_pending` and `operation resume --wait-seconds` watches only that request.
  `operation recover-provider-request` binds an independently known request to an ambiguous transfer without replaying it.
  The request ID of a direct transfer is sealed under the login-Keychain wrapping secret in
  `provider-direct-request-references/<profile-hash>/<operation-id>.json`, and the operation record keeps only its hash
  (provider effect reference `apn.provider-effect-reference.v2`, `recoveryTokenHash`); output shows that hash as
  `provider_request_reference_hash`, as before. Approve reads the wrapping secret before the owner is asked, so a secret
  missing over sealed state or a refusing Keychain leaves the transfer `awaiting_approval`, with no approval code asked
  and nothing sent. Resume opens the sealed ID before it watches the request; an ID that cannot be opened refuses that
  resume precisely (`APN_STATE_CORRUPT` with `provider_request_reference_unmatched` or `wrapping_secret_missing`, or
  `APN_NATIVE_REJECTED`) and changes nothing. Records written by 0.5.106 and earlier keep their plaintext reference
  (`v1`) and are never migrated; 0.5.106 and earlier cannot read a `v2` reference, so do not downgrade once one exists.
  A delegated Smart Account send keeps its `v1` reference: its ID is the APN operation ID.
  A watch that `mm` answers with `REQUEST_NOT_FOUND` records where it missed the request, never an outcome:
  `metamask_request_not_in_local_state` (its local request list, emptied by a new `mm login`),
  `metamask_request_not_found_on_server`, or `provider_request_not_found`.
  A native-fee transfer (`wallet metamask native-transfer`) and a gasless delegation disable are not handed to
  `mm wallet send-transaction`: APN names the request ID itself (a native transfer seals and journals it first) and sends
  the same request through its sandboxed SDK helper; `mm` stays for the sign-in and the reads
  ([MetaMask native](metamask-native-cli-sourceprep.md#the-hand-off)).
- **MetaMask Smart Account**: APN keeps one encrypted session account and the ERC-7715 grant; each transfer derives one
  exact child delegation after foreground approval. `wallet permission list|sync|disable|forget` manage the binding.
  `sync`, `disable` and `forget` take `--expected-revision`, the `revision` that `wallet permission list` shows; a stale
  one is refused with `APN_PROFILE_REVISION_CONFLICT` (`details.current_revision`), and the next actions are that list
  command and the same command again with the revision it shows, never a new `wallet connect`.
  A consent that stops in the browser names where in `error.details`: `consent_step` is the page's last step
  (`provider_choice`, the wallet method whose call or answer stopped it, or `owner_match` when a sync selects another
  account), and when that wallet call itself threw, `provider_error_code` and `provider_error_message` are the
  wallet's own code and message (printable ASCII, at most 160 characters, unverified). `consent_permission_requested`
  is true when the page had already sent MetaMask the permission request: unless MetaMask answered with a rejection
  (4001), it may then hold a grant for this session. A retry of the same `wallet connect` first reads the permissions
  this origin holds (`wallet_getGrantedExecutionPermissions`): one granted to the intent's session account is taken as
  the answer and checked like a new one, with no new request; only when none is held does MetaMask show a new request,
  which you can reject (4001) to leave nothing granted. A failed read stops before any request; `wallet permission
  forget` then deletes the pending intent with its session key, so a grant MetaMask may still hold for that key can no
  longer be used, and the next connect starts a new intent. A first consent skips the read: its new session account
  holds no grant. The page shows the same step.
  MetaMask lists a permission only to the page origin that requested it, so each permission keeps one consent origin,
  `http://127.0.0.1:<port>`: the port is saved before its first consent and reused by every retry of the same
  `wallet connect` (which also reuses the pending intent and its session) and by `wallet permission sync`. A busy port
  refuses with `consent_port_in_use` before the browser opens; free it and retry. A permission connected before 0.5.91
  has no recorded origin, and `wallet permission sync` refuses it with `consent_origin_unrecorded` without changing
  it.

Provider balance is never spending authority; the owner allowlist and profile policy still apply.
