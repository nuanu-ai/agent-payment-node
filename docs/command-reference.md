# Command reference

[Documentation index](README.md) · [Product overview](../README.md)

This section was moved from the APN README without changes to its text. The block between the `BEGIN`/`END APN COMMAND CATALOG` markers is generated from the command catalog.

Generated from the catalog; `apn help <command>` and `apn help --json` give options, effects, approval, states and recovery.

<!-- BEGIN APN COMMAND CATALOG -->
```text
apn x402 permit2 approve --url <https-url> --rpc-url <https-rpc> [--profile <profile>] --idempotency-key <key>
apn x402 permit2 observe --operation <operation-id> --rpc-url <https-rpc> [--profile <profile>] [--transaction <hash> | --expired-unused]
apn x402 permit2 preflight --profile <profile> --payment-required <base64-header> --expected-challenge-hash <hash> --expected-index <index> --expected-terms <base64-json> --rpc-url <https-rpc>
apn x402 permit2 status --profile <profile> --operation <operation-id>
apn x402 solana pay --profile <profile> --url <https-url> --asset <mint> --max-amount <atomic> --idempotency-key <key>
apn x402 solana observe --operation <operation-id>
apn x402 solana status --operation <operation-id>
apn x402 permit2 allowance set --profile <profile> --chain <caip2> --asset <token> --amount <atomic> --rpc-url <https-rpc> --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --idempotency-key <key>
apn x402 permit2 allowance revoke --profile <profile> --chain <caip2> --asset <token> --rpc-url <https-rpc> --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --idempotency-key <key>
apn x402 permit2 allowance observe --operation <operation-id> --rpc-url <https-rpc>
apn x402 permit2 allowance status --operation <operation-id>
apn wallet allowance revoke --profile <profile> --chain eip155:<id> --asset <token-address> --spender <address> --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>
apn wallet allowance status --profile <profile> --chain eip155:<id> --asset <token-address> --spender <address>
apn x402 merchant prepare --profile <profile> --url <https-url> [--asset <token>] --max-native-fee-wei <wei> [--native-fee-reserve-wei <wei>] --idempotency-key <key>
apn x402 merchant approve --operation <operation-id>
apn x402 merchant observe --operation <operation-id> [--deliver]
apn x402 merchant retire-unsent --operation <operation-id>
apn x402 merchant status --operation <operation-id>
apn relay prepare --profile <profile> --source-chain <caip2> --asset <usdc|native> --destination-chain <caip2> --recipient <address> --amount-atomic <source-atomic> --min-output-atomic <destination-atomic> --max-deposit-network-fee-wei <wei> [--max-approval-network-fee-wei <wei>] [--payer <address> --max-provider-fee-atomic <usdc> --quote-file <absolute-json-path>] --idempotency-key <key>
apn relay execute --profile <profile> --operation <operation-id> --rpc-url <source-rpc>
apn relay observe --profile <profile> --operation <operation-id> --rpc-url <source-rpc> [--destination-rpc-url <destination-rpc>]
apn relay retire --profile <profile> --operation <operation-id>
apn relay status --profile <profile> --operation <operation-id>
apn stargate native prepare --profile <profile> --amount-atomic <wei> --max-native-debit-atomic <wei> --idempotency-key <key>
apn stargate native execute --operation <operation-id>
apn stargate native observe --operation <operation-id>
apn stargate native status --operation <operation-id>
apn stargate native receipt --operation <operation-id>
apn stargate token prepare --profile <profile> --amount-atomic <usdc> [--native-drop-atomic <wei>] --min-output-atomic <usdc> --max-native-debit-atomic <wei> [--max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>] --idempotency-key <key>
apn stargate token execute --operation <operation-id>
apn stargate token cleanup --operation <operation-id>
apn stargate token observe --operation <operation-id>
apn stargate token status --operation <operation-id>
apn stargate token receipt --operation <operation-id>
apn wallet balance --profile <profile> [--chain <caip2> --asset <native-or-contract> [--decimals <integer>]] --rpc-url <https-url>
apn pay transfer prepare-asset --profile <profile> --chain <caip2> --asset <native-or-contract> --rpc-url <https-url> [--decimals <integer>] --to <address> --amount <decimal> --max-fee-wei <wei> [--priority-fee-wei <wei>] --idempotency-key <key>
apn --version
apn mcp serve
apn mcp config
apn doctor keychain [--profile <profile>]
apn wallet ensure [--profile <profile>]
apn wallet import --profile <profile> --key-file <absolute-path> --key-name <env-name> --expected-address <checksummed-address>
apn wallet connect --profile <profile> --provider <provider-id> [--auth-method <method>] [--expected-revision <positive-integer>] [--permission-cap-usdc-atomic <atomic>] [--permission-expires-at <unix-seconds>] [--idempotency-key <key>]
apn wallet permission list --profile <profile>
apn wallet permission sync --profile <profile> --expected-revision <positive-integer>
apn wallet permission disable --profile <profile> --expected-revision <positive-integer>
apn wallet permission forget --profile <profile> --expected-revision <positive-integer>
apn wallet metamask native-transfer --profile <profile> --chain <chain> --recipient <address> --amount-atomic <usdc> --idempotency-key <key>
apn wallet metamask native-transfer-status --operation <id>
apn wallet metamask native-transfer-observe --operation <id>
apn wallet status [--profile <profile>]
apn wallet policy show --profile <profile> [--chain <caip2>] [--asset <token>]
apn wallet policy set --profile <profile> [--chain <caip2>] [--asset <token>] --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic> [--max-balance-eth-wei <wei>] [--x402-payees <address,...|unrestricted>]
apn x402 inspect [--chain <caip2>] [--asset <token>] --url <https-url> [--method <method>] [--headers-json <json>] [--body-base64 <base64>] [--payer <address>]
apn x402 fetch prepare --profile <profile> [--chain <caip2>] [--asset <token>] --url <https-url> --idempotency-key <key> --rpc-url <https-url> [--max-amount-atomic <atomic>] [--method <method>] [--headers-json <json>] [--body-base64 <base64>]
apn x402 fetch approve --operation <operation-id> --rpc-url <https-url>
apn pay transfer prepare --profile <profile> --idempotency-key <key> --to <address> --amount-usdc <decimal> --rpc-url <https-url>
apn pay transfer approve --operation <operation-id> [--rpc-url <https-url>]
apn operation status --operation <operation-id> [--refresh-allowance]
apn operation abandon --operation <operation-id>
apn operation resume --operation <operation-id> [--rpc-url <https-url>] [--wait-seconds <1..300>] [--observe-only true] [--coinbase-observation-rpc publicnode-base] [--observation-rpc-env <APN_ENV_RPC_URL>]
apn operation recover-provider-request --operation <operation-id> --provider-request-id <provider-request-id>
apn operation recover-transaction-settlement --operation <operation-id> --transaction-hash <transaction-hash> --idempotency-key <key> --rpc-url <https-url>
apn receipt get --operation <operation-id>
apn wallet ensure-solana --profile <profile> --provider <local-or-coinbase-awal> [--accept-risk true]
apn wallet balance-solana --profile <profile> --asset <sol-usdc-or-usdt>
apn wallet capabilities-solana [--profile <profile>]
apn policy admit-solana --profile <profile> --asset <sol-usdc-or-usdt> --max-per-transfer <decimal> --daily-limit <decimal> --max-fee-sol <decimal>
apn pay transfer prepare-solana --profile <profile> --asset <sol-usdc-or-usdt> --to <solana-address> --amount <decimal> --max-fee-sol <decimal> --idempotency-key <key>
apn wallet ensure-tron --profile <profile> --provider local --accept-risk true
apn wallet balance-tron --profile <profile> --asset <trx-or-usdt>
apn wallet capabilities-tron [--profile <profile>]
apn policy admit-tron --profile <profile> --asset <trx-or-usdt> --max-per-transfer <decimal> --daily-limit <decimal> --max-fee-trx <decimal>
apn pay transfer prepare-tron --profile <profile> --asset <trx-or-usdt> --to <tron-address> --amount <decimal> --max-fee-trx <decimal> --idempotency-key <key>
apn wallet portfolio [--profile <profile>] [--refresh]
apn bridge capabilities [--profile <profile>]
apn bridge inventory
apn bridge routes --profile <profile> --from-chain <caip2> --to-chain <caip2> --from-token <address> --to-token <address> --amount <decimal> --to <address> --min-output <decimal> --max-native-debit-wei <uint> --max-route-fee <decimal> --slippage-bps <uint>
apn bridge prepare --profile <profile> --quote <snapshot-hash> --route <route-id> --idempotency-key <key>
apn bridge approve --operation <operation-id>
apn circle approval prepare --profile <profile> --cap-atomic <USDC atomic> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei>
apn circle approval revoke --profile <profile> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei>
apn circle approval execute --operation <approval-id>
apn circle approval status --operation <approval-id>
apn circle source submit --profile <profile> --expected-payer <base-address> --recipient-owner <solana-address> --recipient-setup <existing_ata|create_ata> --amount-atomic <uint> --max-source-fee-atomic <uint> --max-allowance-atomic <uint> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei> --idempotency-key <key>
apn sei funding prepare --profile <profile> --expected-payer <address> --amount-atomic <wei> --minimum-output-atomic <sei-wei> --maximum-fee-atomic <wei> --idempotency-key <key>
apn sei funding approve --operation <operation-id>
apn sei funding status --operation <operation-id>
apn circle evm prepare --profile <profile> --destination-profile <profile> --destination-chain <string> --idempotency-key <idempotency_key> --beneficiary <address> --gross-atomic <atomic_usdc> --max-issuer-fee-atomic <atomic_usdc> --min-mint-atomic <atomic_usdc>
apn circle evm approve-source --operation <operation_id>
apn circle evm adopt-external-mint --operation <operation_id> --transaction-hash <string>
apn circle evm approve-mint --operation <operation_id>
apn circle evm observe --operation <operation_id>
apn circle evm refresh-attestation --operation <operation_id>
apn circle evm cleanup --operation <operation_id>
apn circle evm status --operation <operation_id>
apn mega funding prepare --profile <profile> --expected-payer <address> --amount-atomic <wei> --minimum-output-atomic <mega-wei> --maximum-fee-atomic <wei> --idempotency-key <key>
apn mega funding approve --operation <operation-id>
apn mega funding status --operation <operation-id>
apn oneclick source submit --lane <lane> --profile <profile> --expected-payer <evm-address> --recipient <tron-or-solana-address> --amount-atomic <origin atomic> --min-output-atomic <destination atomic> --max-quoted-loss-atomic <lane loss atomic> --max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei> --idempotency-key <key>
apn oneclick source status --operation <operation-id>
apn gasless usdt prepare --profile <profile> --to <address> --amount <gross-USDT> --max-fee <USDT> --min-received <USDT> --idempotency-key <key>
apn gasless usdt status --profile-hash <hash> --operation <operation-id>
apn gasless usdt resume --profile-hash <hash> --operation <operation-id>
apn gasless usdt execute --profile-hash <hash> --operation <operation-id>
apn gasless usdt execution-status --profile-hash <hash> --operation <operation-id>
apn gasless usdt observe --profile-hash <hash> --operation <operation-id>
apn gasless capabilities [--profile <profile>]
apn gasless balance --profile <profile> --chain <chain-id>
apn gasless transfer quote --profile <profile> --chain 1 --owner <address> --to <address> --amount <gross-USDC> --max-fee <USDC> --min-received <USDC> --rpc-url <public-ethereum-rpc> [--rpc-max-batch-items <2-30>]
apn gasless transfer prepare --profile <profile> --chain <chain-id> --to <address> (--amount <gross-USDC> --max-fee <USDC> --min-received <USDC> | --net-amount-atomic <net> --max-gross-atomic <gross-cap> --max-fee-atomic <fee-cap>) --idempotency-key <key>
apn gasless transfer approve --operation <operation-id>
apn gasless transfer revoke --operation <operation-id>
apn gasless transfer approve-sealed --operation <operation-id>
apn allowlist inventory
apn allowlist resolve --chain <exact-network-identity> --kind <native|token> [--identifier <exact-token-identifier>]
apn allowlist policy prepare --profile <profile> --account <canonical-account> --overlay-version <version> --chain <network> --kind <native|token> [--identifier <token>] --rail <rail> --max-per-transfer-atomic <atomic> --daily-limit-atomic <atomic> --effective-at <ISO-instant> [--expires-at <ISO-instant>] [--mechanism-provider <provider> --mechanism-reference <reference>] [--expected-revision <revision>]
apn allowlist policy stage --profile <profile> --file <absolute-policy-file> [--expected-revision <revision>]
apn allowlist policy activate --profile <profile> --revision <revision>
apn allowlist policy revoke --profile <profile> --revision <revision>
apn allowlist policy status --profile <profile>
apn swap ethereum uniswap inventory
apn swap ethereum uniswap quote --profile <profile> --account <address> --to <address> --output-token <address> --amount <wei> --slippage-bps <string> --owner-slippage-cap-bps <string> --deadline <string> --max-gas-limit <wei> --max-fee-per-gas <wei> --max-priority-fee-per-gas <wei>
apn swap ethereum uniswap prepare --profile <profile> --quote <string> --idempotency-key <idempotency_key>
apn swap ethereum uniswap status --operation <operation_id>
apn swap ethereum uniswap approve --operation <operation_id>
apn swap ethereum uniswap execute --operation <operation_id>
apn swap ethereum uniswap-token inventory
apn swap ethereum uniswap-token quote --profile <profile> --account <address> --to <address> --source-token <address> --output-token <address> --amount <string> --minimum-output <string> --approval-cap <string> --deadline <string> --max-approval-gas-limit <wei> --max-swap-gas-limit <wei> --max-cleanup-gas-limit <wei> --max-fee-per-gas <wei> --max-priority-fee-per-gas <wei> --max-native-debit <wei>
apn swap ethereum uniswap-token prepare --profile <profile> --quote <string> --idempotency-key <idempotency_key>
apn swap ethereum uniswap-token status --operation <operation_id>
apn swap ethereum uniswap-token approve --operation <operation_id>
apn swap ethereum uniswap-token execute --operation <operation_id>
apn swap ethereum uniswap-token cleanup --operation <operation_id> [--max-fee-per-gas <wei>] [--max-priority-fee-per-gas <wei>]
apn swap tron sunswap inventory
apn swap tron sunswap quote --profile <profile> --account <string> --to <string> --amount <sun> --slippage-bps <string> --owner-slippage-cap-bps <string> --fee-limit-sun <sun> --deadline <string>
apn swap tron sunswap prepare --profile <profile> --quote <string> --idempotency-key <idempotency_key>
apn swap tron sunswap status --operation <operation_id>
apn swap tron sunswap approve --operation <operation_id>
apn swap tron sunswap execute --operation <operation_id>
apn swap solana jupiter inventory
apn swap solana jupiter quote --profile <profile> --account <string> --to <string> --amount <lamports> --slippage-bps <string> --owner-slippage-cap-bps <string>
apn swap solana jupiter prepare --profile <profile> --quote <string> --idempotency-key <idempotency_key>
apn swap solana jupiter status --operation <operation_id>
apn swap solana jupiter approve --operation <operation_id>
apn swap solana jupiter execute --operation <operation_id>
apn swap solana orca stable-status --operation <operation_id>
apn swap solana orca stable-release --operation <operation_id>
apn swap solana orca stable-recover-no-send --operation <operation_id>
apn swap solana orca stable-observe --operation <operation_id>
apn swap solana orca inventory
apn swap solana orca quote --pool <string> --profile <profile> --account <string> --amount <atomic> --slippage-bps <string> --owner-slippage-cap-bps <string> --compute-unit-limit <string> --compute-unit-price <string>
apn swap solana orca prepare --profile <profile> --quote <string> --idempotency-key <idempotency_key>
apn swap solana orca status --operation <operation_id>
apn swap solana orca approve --operation <operation_id>
apn swap solana orca execute --operation <operation_id>
```
<!-- END APN COMMAND CATALOG -->
