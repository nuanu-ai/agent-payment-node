# USDC transfers with gas paid from the amount

Use an existing local wallet or MetaMask Agent server-wallet profile to send
canonical USDC with the fee included in the amount. The sender needs no native
gas balance. The selected profile determines the supported networks, fee
calculation and recovery rules described below.

This is an unreleased source capability. Real mainnet transfers and receiving
human acceptance remain open for all seven local-wallet and eight MetaMask
networks. `apn gasless capabilities`
reports the exact adapter and acceptance state without reading a wallet,
Keychain, RPC or provider. MetaMask Smart Account and Coinbase Agentic Wallet
remain required work with no executable adapter in this gasless command family.
This same-chain transfer does not establish gasless x402 or bridge support.

## Local wallet networks and configuration

The local path reserves a maximum USDC fee and sends the remainder. Circle's
token paymaster supplies native gas; APN approves and accounts for the fee in
canonical USDC.

Use an existing local EVM wallet profile and an explicit public HTTPS RPC for
the selected numeric chain ID. APN checks the actual chain, deployed bytecode,
proxy implementation slots, linked signature checker, USDC domain and account
state. A changed or unavailable deployment fails closed.

| Network | Chain ID | Required RPC environment | Optional bundler environment |
| --- | --- | --- | --- |
| Ethereum | 1 | `APN_ETHEREUM_RPC_URL` | `APN_ETHEREUM_BUNDLER_RPC_URL` |
| Optimism | 10 | `APN_OPTIMISM_RPC_URL` | `APN_OPTIMISM_BUNDLER_RPC_URL` |
| Unichain | 130 | `APN_UNICHAIN_RPC_URL` | `APN_UNICHAIN_BUNDLER_RPC_URL` |
| Polygon PoS | 137 | `APN_POLYGON_RPC_URL` | `APN_POLYGON_BUNDLER_RPC_URL` |
| Base | 8453 | `APN_BASE_RPC_URL` | `APN_BASE_BUNDLER_RPC_URL` |
| Arbitrum One | 42161 | `APN_ARBITRUM_RPC_URL` | `APN_ARBITRUM_BUNDLER_RPC_URL` |
| Avalanche C-Chain | 43114 | `APN_AVALANCHE_RPC_URL` | `APN_AVALANCHE_BUNDLER_RPC_URL` |

The default bundler is the selected chain's public Pimlico endpoint. The
registry exposes its exact URL. The RPC must support canonical block-hash
state reads and safe-block observation. Credentials in user-info and URL
fragments are rejected. Endpoint identities are frozen into each intent;
changing an endpoint during an operation does not create permission to submit
through the new endpoint.

There is no default chain, arbitrary token option or native-payment fallback.
The USDC address comes from the verified chain registry. USDC has six decimals;
amount inputs use ordinary decimal notation with at most six fractional digits.

## Shared commands

```sh
apn gasless capabilities
apn gasless balance --profile default --chain 8453
apn gasless transfer prepare --profile default --chain 8453 \
  --to <recipient-address> --amount 10 --max-fee 0.2 --min-received 9.8 \
  --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
apn operation status --operation <operation-id>
apn receipt get --operation <operation-id>
```

The example permits a total amount of 10 USDC, a fee no greater than 0.2 USDC
and delivery of at least 9.8 USDC. For a local wallet, preparation computes the conservative fee
budget `F` from the frozen gas fields and current paymaster configuration.
It fixes recipient amount `N = 10 - F`. If the actual fee `A` is lower than
`F`, the unused `F - A` stays with the sender. The sender's successful debit
is `N + A`; APN does not move the spare fee budget to the recipient later.

Preparation does not sign or submit. Approval displays the exact chain, USDC
contract, sender, recipient, total budget, recipient amount, fee ceiling and
permissions. The human types the displayed `APPROVE GASLESS` phrase with the
full operation fingerprint in a foreground terminal. MetaMask additionally
requires the full operation ID in the same phrase. MCP returns that exact
CLI handoff and cannot satisfy this approval with injected automation.

The same global idempotency key and profile guards cover direct transfers,
x402, Solana/TRON, LI.FI and gasless operations. Repeating the identical prepare
returns its saved operation without another quote or signature. Different
inputs with the same key are rejected.

## Local wallet permissions and failures

On first use, approval includes EIP-7702 delegation of the existing address to
the pinned account implementation. Delegation persists after this transfer.
Repeated use reuses that designation without a new authorization tuple. APN
also signs a permit for exactly `F` USDC to the pinned paymaster. The permit
and signed UserOperation have no on-chain expiry; the five-minute APN deadline
limits new APN actions, not the lifetime of already signed material.

The account batch sends exactly `N` USDC and clears the paymaster allowance.
A failed transfer can still pay a USDC fee. The receipt reports the observed
prefund, refund, actual charge and residual allowance separately. A failed
operation with residual permission remains `failed_effects_pending`; APN
keeps the profile guard until safe evidence proves the permission cleared.
There is no automatic revocation, extra cleanup transaction or new payment.

## Local wallet recovery and proof

```sh
apn operation resume --operation <operation-id>
```

Resume performs one bounded continuation or observation; omit `--wait-seconds`.
An approved phase that has never been attempted can continue before the
deadline after fresh checks. Each signing attempt, permit disclosure and
submission has a durable marker. After an interruption, APN loads only the
original seal. It never repeats a marked estimate or send. Missing material,
lost responses and expiry after a signing marker keep an explicit unresolved
state and retain the profile guard.

The bundler supplies only a candidate transaction location. Completion needs
independent canonical RPC evidence: authenticated outer transaction and block
membership, the exact EntryPoint event, USDC prefund/refund/delivery logs,
consumed nonces, expected delegation and zero safe allowance. Another owner's
batched operation is allowed; multiple operations for this owner in the same
transaction are ambiguous and cannot close this payment. A reverted outer
transaction does not prove that signed permissions can no longer be used.

If only the permit and optional delegation authorization were disclosed, the
owner can invalidate them separately and then resume the same operation. APN
closes it as `failed_permissions_invalidated` only after canonical safe and
current state prove the old permit nonce consumed, authorization nonce invalid,
zero paymaster allowance, unchanged EntryPoint nonce and no pending transaction.
The original bootstrap seal must be known, and no final UserOperation signing
attempt may exist. Missing or conflicting proof keeps the guard.

This outcome records cleared permissions and that no final payment was
submitted. Transfer delivery, token fee/debit and native cost stay unknown;
any externally paid cleanup is separate. It preserves the original operation
history and permits a new transfer only through a new prepare and approval.
APN does not perform the external revocation or start another payment.

Canonical recovery scans at most 256 safe blocks per resume, using log requests
of at most ten blocks each. Failed requests and invalid logs never advance the
cursor; a reorganization can rewind it. The next observation cannot skip an
unread range.

`operation status` and `receipt get` read saved evidence locally. Receipts
contain hashes and public accounting, without permits, signatures, raw
UserOperations, encrypted keys or provider response text.

## MetaMask Agent server wallet

Use a profile already bound to the intended MetaMask Agent server-wallet address
and its existing production session. The current selected wallet must resolve
to that same address. This path does not create a wallet, change selection,
refresh a login or request MFA automatically. If the session is unavailable,
complete the normal provider login separately and continue the saved operation.

| Network | Chain ID | Required RPC environment | Finality |
| --- | --- | --- | --- |
| Ethereum | 1 | `APN_ETHEREUM_RPC_URL` | safe |
| Optimism | 10 | `APN_OPTIMISM_RPC_URL` | safe |
| Polygon PoS | 137 | `APN_POLYGON_RPC_URL` | finalized |
| Monad | 143 | `APN_MONAD_RPC_URL` | safe |
| Sei | 1329 | `APN_SEI_RPC_URL` | safe |
| Base | 8453 | `APN_BASE_RPC_URL` | safe |
| Arbitrum One | 42161 | `APN_ARBITRUM_RPC_URL` | safe |
| Linea | 59144 | `APN_LINEA_RPC_URL` | safe |

MetaMask supplies the relay; no bundler configuration is used. The explicit
public HTTPS RPC must provide canonical block-hash state reads, the listed
finality tag, complete transaction/receipt membership and bounded log queries.
APN checks protocol and USDC implementation code at preparation and settlement.
Unichain and Avalanche belong to the local-wallet path above.

For MetaMask, `--amount` is the exact successful sender debit `G`. APN freezes
the provider's USDC fee `F` and recipient amount `N`, requiring `G = N + F`,
`F <= --max-fee` and `N >= --min-received`. It makes at most three quote attempts
to reach that equality. Before dispatch, the quote must still match exactly.
There is no unused amount or refund for a successful MetaMask batch. The
recipient and fee recipient must both differ from the sender and each other.

```sh
apn gasless balance --profile metamask --chain 8453
apn gasless transfer prepare --profile metamask --chain 8453 \
  --to <recipient-address> --amount 10 --max-fee 0.2 --min-received 9.8 \
  --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
```

Preparation does not sign or submit. Approval displays the exact USDC debit,
recipient amount, fee and persistent permission, then requires this full phrase:

```text
APPROVE GASLESS <operation-id> <full-fingerprint>
```

The provider signs and executes the two transfers as one exact batch. It may
install or preserve the pinned EIP-7702 designation on the same wallet address.
That designation can remain afterward. The permission allows one successful
batch and has no onchain expiry. APN's five-minute deadline limits only the first
dispatch; a timeout, revert or later expiry does not revoke the permission or
guarantee that no payment can occur.

APN records a durable dispatch marker before making its single provider POST.
After that marker, repeated approval or `operation resume` only observes the
original request and delegation. Lost responses, provider failures and pending
MFA remain unresolved. A canonical revert is `failed_effects_pending` and
retains the profile guard because the permission may still be redeemed later.
Only independently proved completion or failure before any effect is terminal.

Continue with `apn operation resume --operation <operation-id>`, without
`--wait-seconds`, including after the APN deadline. A provider status or hash
is only a hint. Completion requires the independently authenticated transaction,
canonical receipt and finality, exact two-call batch, consumed permission,
USDC delivery/fee/debit and outer gas payer. A temporarily unusable clock or
full history preserves the saved guard and cannot authorize another dispatch.

`operation status` and `receipt get` read saved evidence locally. Public output
contains hashed provider identities and accounting, without the private
request UUID, session token, unsigned wire or provider response. Unresolved
operations block competing payments and wallet lifecycle changes for the profile.

## Existing state and upgrades

The gasless journal, receipts and encrypted effects use separate files under
the existing APN state directory. The original wallet and prior operation
formats are preserved. Reinstalling or upgrading must preserve that directory
and its existing wrapping secret. Recover an unresolved operation with the
same verified archive or a compatible newer archive. An older binary does not
provide gasless recovery; do not delete unresolved state or create a replacement
payment to work around it.

Synthetic source and temporary-installed tests establish software behavior.
They do not establish real-wallet, mainnet, receiving-human or public-release
acceptance. Those checks require their own explicit approval and evidence.
