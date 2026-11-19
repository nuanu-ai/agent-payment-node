# Custody and recovery

[Documentation index](README.md) · [Product overview](../README.md)

These three sections were moved from the APN README without changes to their text.

## Custody and threat model

- `~/.apn/wallets/<profile>.json` is a versioned AES-256-GCM envelope. A random 256-bit wrapping secret is stored as the
  generic password `ai.nuanu.apn.wrapping-secret.v1/default` in the ordinary macOS login Keychain, bound to
  `~/Library/Keychains/login.keychain-db`.
- HKDF-SHA-256 derives a per-write key from a random 32-byte salt; profile, address, chain, creation time and binding hash
  are authenticated as GCM additional data. The envelope also keeps exact signed-effect material so recovery never needs a
  second signature.
- State uses owner-only permissions, symlink and hardlink rejection, macOS kernel advisory locks through `/usr/bin/lockf`,
  bounded canonical JSON and fsync-plus-atomic-rename writes. A busy lock is waited for up to five seconds.

This is `local_software_disposable` custody, not savings custody. Encryption protects a copied `~/.apn` without the
Keychain secret; it does not protect against compromise of the same unlocked login session, process, user or host.
Transient key copies in JavaScript memory are not guaranteed to be zeroized. Missing Keychain material, failed
authentication, unsafe permissions or identity mismatch fail closed and never rotate a wallet silently. On first creation
APN writes the generated wrapping secret to `/usr/bin/security -i` on stdin, never in its arguments, so `ps` does not show
it, and reads the item back in the same session to prove the add. The wallet envelope is bounded to 1 MiB; reaching the
bound refuses persistence and submission rather than overwriting anything.

`wallet connect --provider coinbase-agentic-wallet` reads the account email and the one-time verification code on the
foreground terminal and passes each to the pinned `awal` as a command-line argument (`awal auth login <email>`, then
`awal auth verify <code>`): `awal` 2.12.1 takes them nowhere else, neither on stdin nor from the environment. While that
child runs (APN stops it at the 30-second provider timeout), another process of the same user can read the code with
`ps`. It is a one-time code for that one pending sign-in; APN never prints, logs or stores it.

Every `awal` command except `quit`, including the public reads APN runs (`address`, `balance`, `status`), starts awal's
own wallet server (a detached Electron process shown as `bundle-electron.js`, the `payments-mcp-server`) when it is not already
running. That server holds the awal session and keeps running after APN exits, as it does after any `npx awal` command.
APN does not stop it, because the same server answers every awal client of this user. `npx awal@2.12.1 quit`, or
`node "$(brew --prefix apn)/libexec/node_modules/awal/dist/index.js" quit` for the copy APN pins, stops it; the next awal
command starts it again. When an AWAL Solana read (`wallet ensure-solana`, `wallet balance-solana`) fails with an exact
awal failure answer other than `AUTH_REQUIRED`, APN asks `awal status --json`, and only `auth.authenticated: false` there
turns the failure into `APN_PROVIDER_SESSION_REQUIRED` with the `apn wallet connect` step; awal's error text, which its
remote wallet window supplies, decides nothing. `AUTH_REQUIRED` gives that answer directly.

`apn wallet status` and `apn wallet ensure` (CLI and MCP) prove that an existing local wallet's wrapping secret is still
in the Keychain and decrypt nothing. They run `/usr/bin/security find-generic-password -w` once; the bytes it prints are
zeroed when the check ends and are not kept in the per-command copy that signing commands cache. The base64 text also
passes through JavaScript strings, which cannot be zeroed and stay in memory until garbage collection. When the item is
gone they fail with `APN_STATE_CORRUPT` and `details.reason: "wrapping_secret_missing"` instead of answering `ready`.
When the Keychain itself cannot be read (locked, refused, or `/usr/bin/security` failing) they fail with
`APN_NATIVE_REJECTED` and `details.nativeCode: "APN_KEYCHAIN_UNAVAILABLE"`. With a locked login Keychain in a GUI session
macOS may show its unlock prompt; the command then waits up to 15 seconds (the `security` timeout) while holding that
profile's locks, so another command for the same profile waits its five seconds and fails with `APN_STATE_BUSY`.

APN creates a wrapping secret only for a state root that holds nothing encrypted. While the secret is missing and any
record sealed under it exists (a wallet envelope, a Solana or TRON key, a smart-account permission, a profile policy,
saved signed material, or a MetaMask gasless, native, direct or delegation disable request reference), a command that
would create one (`wallet ensure` or `wallet import` for any profile, `wallet ensure-solana`, `wallet ensure-tron`, a
first `wallet policy set`, or the first sealed record of a provider payment, such as a MetaMask gasless prepare, a
MetaMask native transfer or a MetaMask direct transfer approve) fails with the same reason and restore step instead of
minting a secret that would orphan those records and collide with the restored item.

APN never deletes a sealed MetaMask request reference (`metamask-gasless-request-references/`,
`metamask-native-request-references/`, `provider-direct-request-references/`, and from 0.5.109
`metamask-revocation-request-references/` for `apn gasless transfer revoke`), not even after its operation ends. The one
exception is the seal of a disable request whose helper provably stopped before any network call: `revoke` removes it
again at once. A gasless prepare interrupted between its seal and its journal also leaves one that belongs to no
operation. Each counts as sealed custody. So after the first MetaMask gasless, native or direct transfer or delegation
disable that sealed a request ID, a lost wrapping secret makes every command listed above refuse with
`APN_STATE_CORRUPT` / `wrapping_secret_missing`, also in a state root that holds no local wallet, where APN used to
create a new secret. This fails closed. The owner has two options:

1. Restore the login Keychain item from a backup of the login Keychain (the restore step). Every sealed record opens
   again and nothing else changes.
2. When the item is lost for good and the state holds nothing else sealed (no local wallet, chain key, policy,
   permission or saved signed material), move the four request-reference directories out of the APN state root and keep
   them. The next command creates a new wrapping secret. The moved references open only under the old item, which can no
   longer be restored beside the new one: both share the Keychain name. A resolved operation never opens its reference
   again and is not affected. An unresolved one keeps its state and status: a MetaMask native observe or direct resume
   refuses with `provider_request_reference_unmatched`, a gasless approve refuses until its deadline ends it, and a
   gasless resume reports a failed provider read and still observes the chain. A gasless resume no longer lists the
   moved disable requests. Its exit is
   `apn operation abandon --operation <operation-id>` once its window has passed. When other sealed records exist,
   moving the references does not help: only option 1 does.

`apn doctor keychain` reports the same two failures and also decrypts the wallet, so a secret that exists but does not
unwrap it fails with `APN_STATE_CORRUPT` without that reason. Its successful answers carry `wrapping_secret: "present"`;
without a wallet it answers `status: "absent"` with `wrapping_secret: "present"` or `"missing"`, and for a missing secret
it suggests `apn wallet ensure` only when nothing encrypted exists, otherwise the restore step.

`wallet ensure` and `wallet import` seal the key in `wallets/<profile>.json` first and write the public record
(`wallets/<profile-hash>/wallet.json`) after it. A run interrupted between the two leaves an incomplete wallet:
`wallet status` answers `status: "incomplete"` with `reason: "sealed_key_without_public_record"` and one next action,
`apn wallet ensure --profile <profile>`, for the profile asked about (an absent wallet's next action names it too). That
command completes the wallet from the sealed key alone. It decrypts the envelope once, under the same locks as a first
`wallet ensure`, the key must derive the address the envelope records, and then it writes the public record and local
profile a first run would have written. It creates no key and mints no wrapping secret; a missing secret fails with
`wrapping_secret_missing` and the restore step, which `wallet status` also reports for such a wallet. A retried
`wallet import` into that profile completes it the same way only when the key file holds that very key; any other key
is refused with `APN_PROFILE_DRIFT` and `details.reason: "incomplete_wallet_key_differs"`, since an import never replaces
a sealed key. Until it is completed, a first provider binding of that profile (`wallet connect` with any provider, or
`wallet ensure-solana --provider coinbase-awal`) is refused before any provider contact, consent or write, with
`APN_PROFILE_DRIFT`, the same reason and the same one next action; another profile's scan of local wallets that meets
its empty record directory fails with `APN_STATE_CORRUPT` and that reason too.

`wallet import --key-file` reads only an owner-only (mode 0600), single-link regular file of at most 64 KiB, reached
without symbolic links. A FIFO, device, socket or directory is refused at once from its `lstat`, before any open, with
`APN_STATE_SECURITY`, `details.reason: "key_file_not_regular"` and `details.file_type`; nothing waits for a writer and no
key is written. The open itself is non-blocking and must reach the same regular file.

Foreground approval requires stdin and stderr attached to real TTYs and an exact operation-bound code within 60 seconds;
a timeout or interruption writes nothing. It is a human-confirmation boundary, not protection against a compromised user
session.

Raw private keys, wrapping secrets, signed transaction bytes, x402 signatures and payment headers never appear in command
output, public operation state or receipts.

## Recovery guarantees

Idempotency keys resolve to one durable operation. Local execution persists the effect binding before submission and
recovers only the exact encrypted signed transaction or authorization. Provider-atomic execution persists a no-replay
start before invoking the provider. Lost outcomes are ambiguous and need independent receipt evidence; they are never
resent. Status and receipts survive restart, reinstall and upgrades because Homebrew does not own `~/.apn`.

An operation that is not terminal blocks new money operations only on its own network and sending account; the refusal
names the blocking operation. Another chain, another wallet, or the Solana or TRON account of the same profile stays
available. Wallet lifecycle changes wait for every operation in the profile.

A prepare refused by such a blocker first runs the blocker's own bounded observation once (no signature, send or
consent) and runs again once when it proves the blocker terminal; that answer lists it in optional `closed_blockers`.
Otherwise the first refusal returns, its details adding `blocker_observation` and, when the observation failed,
`blocker_error_code`, `blocker_error_message` and `blocker_error_reason` ([docs/evm-assets.md](evm-assets.md)).

## Proof boundary

The test suite covers encryption, permissions, concurrency, restart, byte-identical recovery, idempotency, receipts and
every family's journeys without public network traffic or money. Deterministic tests are source proof, not live provider
acceptance or payment proof. Live mainnet acceptance, public release and Homebrew delivery are separate gates recorded
per family in its guide. Hub, contracts, remote MCP and Stellar are outside this repository.

Licensed under the MIT License.
