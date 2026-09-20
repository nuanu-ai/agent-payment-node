# Direct Stargate V2 native execution

This release admits one execution lane: Ethereum mainnet native ETH to Unichain mainnet native ETH. The sender and recipient must be the same imported local profile address.

## Frozen protocol identity

- Ethereum chain ID `1`, LayerZero EID `30101`, Stargate `StargatePoolNative` `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931`.
- Unichain chain ID `130`, LayerZero EID `30320`, Stargate `StargatePoolNative` `0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7`.
- ABI source: `IStargate.sol`, `StargateBase.sol`, and LayerZero `IOFT.sol` as imported by `stargate-protocol/stargate-v2@ce598b8d16472cd76ee47d30b8a40bc5c1b667bb`.
- The canonical send is `sendToken(SendParam, MessagingFee, refundAddress)` in taxi mode: empty `oftCmd`, compose message, and extra options.

The source transaction value is exactly principal plus the fresh `quoteSend` native fee. The owner supplied `maxNativeDebit` covers that value plus the complete EIP-1559 gas envelope.

## Execution and recovery

Set credential-free `APN_ETHEREUM_RPC_URL` and `APN_UNICHAIN_RPC_URL`, then use `apn stargate native prepare`, `execute`, `observe`, `status`, and `receipt`. `status` is a local journal read. `observe` is the explicit network operation that may advance an already attempted operation from safe chain evidence; it never signs or resends. Preparation reads `quoteOFT` and `quoteSend`, rejects any principal that the pool would round down, freezes the minimum received amount, encodes exact calldata, snapshots the Unichain recipient balance, and records `prepared`. Foreground approval records `approved`. Before signing, APN refreshes the quote; checks both chain IDs, code hashes, native token identity, local EIDs, pool type, status, source path credit and shared decimals; verifies the current balance and nonce; simulates the exact frozen call with the frozen value and fee envelope; requires a fresh gas estimate to remain within the frozen gas limit; and reopens the encrypted signer profile to verify its address.

APN records `submission_started` and the signed transaction hash before its single `eth_sendRawTransaction` call. Any exception or conflicting response becomes `unknown_finality`. Later calls only observe that transaction and never sign or send again.

New preparations use operation schema v2 and require the pinned policy plus `pinned_v2` provenance. A raw-integrity-valid legacy v1 record is accepted only for the exact historical Ethereum to Unichain lane and is normalized in memory to the explicit all-`safe` legacy policy with `derived_legacy_v1` provenance; the raw saved integrity is verified before normalization. Current records missing the policy, or any policy or route drift, are corrupt before effects.

The journal uses owner-only paths, atomic rename, file and directory `fsync`, and the repository's kernel advisory operation lock. The kernel releases the lock on process death while its stable owner-only lock file remains reusable. Safe source confirmation must contain the exact official `OFTSent` event. Completion requires a safe Unichain `OFTReceived` emitted by the pinned destination pool and bound to the exact source EID, GUID, recipient and frozen received amount. A balance delta is recorded only as corroboration and never terminalizes delivery. The versioned route finality policy is frozen in the operation and canonical receipt: Ethereum and Unichain both use `safe`. The selected tag is never weakened to `latest` or `pending`. The canonical receipt binds that policy, the quote, source receipt, destination transaction/log proof, contract addresses, EIDs, value, and debit cap.

No command in this change initiates a live transaction during tests or packaging.
