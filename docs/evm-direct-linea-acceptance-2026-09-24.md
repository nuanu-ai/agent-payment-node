# Linea native direct acceptance — 2026-09-24

## Accepted paid operation

The active owner policy revision 16 admitted this bounded Linea native transfer. One prepare created one operation and one send created one transaction. APN recorded the operation as completed with proof class included_native_transaction_and_receipt. A second read-only resume reconciled the receipt; there was no rebroadcast.

- Chain: Linea, eip155:59144
- Operation: c11ad55bee52aa55615a28affa7aa0f4c9068270ec18904b94e8ac65cc632d61
- Transaction: 0xb3d8bbd0d4d054f9801d6fa56cc8e3025190dcb82004e01065c7f339ac44cc02
- Receipt block: 32132324
- Transfer amount: 1000000000000 wei
- Buyer debit: 2050000147000 wei
- Seller credit: 1000000000000 wei
- Actual fee: 1050000147000 wei
- APN receipt integrity hash: c001494a1e419577ff3825958309cae56ce4244f57c29f799c24346db8096349
- Usage reservation: 730ce8b2ed1227e6a3147ff38de1c56a3f7262c8d941e8b49d720680daf8fb3c, finalized
- Owner policy digest: f854682c5187bc829d014ae827e9ba10199029257b1e4c8fd589e9d62b6d6699
- Finality: inclusion_only. This record does not claim safe finality.

Machine-local APN evidence files (no signing material):

- Operation: /Users/tony/.apn/operations/8692e4b95d088a0e95bcab3edf8a641f8d04f54ed4b1d26af61f7a9e344f58bd/c11ad55bee52aa55615a28affa7aa0f4c9068270ec18904b94e8ac65cc632d61.json
- Receipt: /Users/tony/.apn/receipts/8692e4b95d088a0e95bcab3edf8a641f8d04f54ed4b1d26af61f7a9e344f58bd/c11ad55bee52aa55615a28affa7aa0f4c9068270ec18904b94e8ac65cc632d61.json
- Finalized usage reservation: /Users/tony/.apn/asset-usage/1475f6d14b6b4b1e957c6acd87d3a870047651c2be3de119daaaf56654ec02be/730ce8b2ed1227e6a3147ff38de1c56a3f7262c8d941e8b49d720680daf8fb3c.json

## Source and telemetry boundary

Merged PR #271 (main commit 265c4258296376010f6b9a06ccfb8bcefea5a0bd) adds an opt-in Linea native prepare read mode. Its verification covers 17 logical reads grouped into 8 modeled physical POSTs, a ten-attempt ceiling, and 49 focused tests passed; typecheck, build and test-build were also run. GitHub build checks passed, with one attestation passed and a second skipped. No live physical POST telemetry was collected. The modeled eight-POST count is not an observed count for the paid operation and does not establish that this operation used the opt-in batch mode. The source/test/CI evidence is separate from this operation receipt, and does not assert a newer released or installed APN package.

An earlier scalar Pocket prepare error is recorded only as a session observation. It occurred before operation creation; no funds moved in that attempt. The buyer balance observed then was 189201412636551 wei. This observation is separate from the successful operation above.

## Historical Across receipt reference

The completed native Across Ethereum-to-Base bridge operation is separate from the selected Stargate route in C2-09. It is not Stargate evidence.

- Operation: e62fa9a2c8c05e735d9b2fd7ccad761bac0fdb1821c45a7e69b362c02d160e10
- APN receipt hash: 2c61fcc6505afb224cd6a827107771a5ceca23a893b4ea383551690ba1652e9f
- Source transaction: 0xa1bd63c4477000dde3b5634ee783446fdd53a1f2cb4c5753cbf04c6011cda0dd (Ethereum block 26027581)
- Destination transaction: 0x1f0c8bc7dcada001cdeb16b3dcf0b67b3fa0de4d3841a3f30f3827e82190f3fd (Base block 51612434)
- State and proof: completed, rpc_safe_correlated

Machine-local APN evidence files:

- Operation: /Users/tony/.apn/bridge-operations/8692e4b95d088a0e95bcab3edf8a641f8d04f54ed4b1d26af61f7a9e344f58bd/e62fa9a2c8c05e735d9b2fd7ccad761bac0fdb1821c45a7e69b362c02d160e10.json
- Receipt: /Users/tony/.apn/bridge-receipts/8692e4b95d088a0e95bcab3edf8a641f8d04f54ed4b1d26af61f7a9e344f58bd/e62fa9a2c8c05e735d9b2fd7ccad761bac0fdb1821c45a7e69b362c02d160e10.json
