# Direct Stargate V2 native execution

This release admits one execution lane: Ethereum mainnet native ETH to Unichain mainnet native ETH. The sender and recipient must be the same imported local profile address.

## Frozen protocol identity

- Ethereum chain ID `1`, LayerZero EID `30101`, Stargate native OFT `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931`.
- Unichain chain ID `130`, LayerZero EID `30320`, Stargate native OFT `0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7`.
- ABI source: `IStargate.sol`, `StargateBase.sol`, and LayerZero `IOFT.sol` as imported by `stargate-protocol/stargate-v2@ce598b8d16472cd76ee47d30b8a40bc5c1b667bb`.
- The canonical send is `sendToken(SendParam, MessagingFee, refundAddress)` in taxi mode: empty `oftCmd`, compose message, and extra options.

The source transaction value is exactly principal plus the fresh `quoteSend` native fee. The owner supplied `maxNativeDebit` covers that value plus the complete EIP-1559 gas envelope.

## Execution and recovery

Preparation reads `quoteOFT` and `quoteSend`, freezes the minimum received amount, encodes exact calldata, snapshots the Unichain recipient balance, and records `prepared`. Foreground approval records `approved`. Before signing, APN refreshes the quote and checks source chain ID, runtime code hash, native token identity, local EID, and shared decimals.

APN records `submission_started` and the signed transaction hash before its single `eth_sendRawTransaction` call. Any exception or conflicting response becomes `unknown_finality`. Later calls only observe that transaction and never sign or send again.

Safe source confirmation must contain the exact official `OFTSent` event. Completion requires safe Unichain evidence for the same recipient and GUID through official `OFTReceived`, or a balance delta at least as large as the source event's received amount. The canonical receipt binds the quote, source receipt, destination proof, contract addresses, EIDs, value, and debit cap.

No command in this change initiates a live transaction during tests or packaging.
