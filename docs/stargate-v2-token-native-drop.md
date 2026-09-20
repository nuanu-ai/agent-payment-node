# Direct Stargate V2 USDC with Polygon native drop

This lane is finite and pinned: Optimism chain `10`, EID `30111`, USDC `0x0b2C...Ff85`, pool `0xcE8C...B7D0` to Polygon chain `137`, EID `30109`, USDC `0x3c49...3359`, pool `0x9Aa0...7fe4`. The LayerZero Optimism Executor is `0x2D2e...666e`. Full addresses, ABI provenance, Type-3 layout, and the `dstConfig` cap getter are recorded in `data/stargate/2026-09-20/official-registry-and-abi.json`.

The first admitted route is self only. Omit `--native-drop-atomic` for a token-only transfer; it defaults to zero and emits no LayerZero options. It requires an active owner allowlist policy admitting Optimism USDC on the `bridge` rail. Preparation reads the onchain Executor native cap, then performs same-request `quoteOFT` and `quoteSend` with the exact Type-3 native-drop bytes. It freezes the principal, quoted minimum output, owner minimum output, native drop, LayerZero fee, nonce, gas, EIP-1559 fees, and total native debit cap.

ERC20 approval is a separate durable effect. A zero allowance creates an exact principal approval; an existing exact-principal allowance skips it. Any other nonzero allowance refuses preparation and requires explicit cleanup. APN writes an attempt marker before each approval or bridge broadcast. A crash or ambiguous RPC result changes the operation to observation only and never resends. Completion requires zero residual allowance.

Source completion requires exactly one safe `OFTSent` from the pinned Optimism pool with the exact destination EID, GUID, sender, sent amount, and quoted received amount. Destination completion requires the matching safe `OFTReceived` from the pinned Polygon pool with the same GUID, source EID, recipient, and amount, plus Polygon USDC and native POL balance deltas covering the delivery and requested drop. `status` and `receipt` read only the local owner journal and require no RPC configuration.

Set credential-free `APN_OPTIMISM_RPC_URL` and `APN_POLYGON_RPC_URL`. The authorized initial candidate can be prepared without signing or broadcasting:

```sh
apn stargate token prepare \
  --profile owner \
  --amount-atomic 100000 \
  --native-drop-atomic 50000000000000000 \
  --min-output-atomic 100000 \
  --max-native-debit-atomic <owner-cap-wei> \
  --idempotency-key op-usdc-pol-20260920
```

The recipient comes from the imported profile and must equal `0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7` for that live candidate. Review the prepared record before any owner-authorized execution:

```sh
apn stargate token status --operation <operation-id>
apn stargate token execute --operation <operation-id>
apn stargate token observe --operation <operation-id>
apn stargate token receipt --operation <operation-id>
```

`execute` is the only foreground TTY signing surface. `observe` can advance only a previously attempted operation and cannot sign or broadcast.
