/** Manifest v2 removed these v1 commands. A merged command names the v2 command that performs the same request, so
 * `apn help --json` clients can migrate and an old invocation fails with the replacement as its next action. A command
 * removed without a successor has `replacement: null` and a short `reason`. */
export type RemovedV1Command =
  | { readonly path: readonly string[]; readonly replacement: string }
  | { readonly path: readonly string[]; readonly replacement: null; readonly reason: string };

const REPLACED_V1_COMMANDS: readonly RemovedV1Command[] = [
  { path: ["wallet", "policy", "show-network"], replacement: "apn wallet policy show --profile <profile> --chain <caip2>" },
  { path: ["wallet", "policy", "set-network"], replacement: "apn wallet policy set --profile <profile> --chain <caip2> --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic>" },
  { path: ["x402", "inspect-network"], replacement: "apn x402 inspect --chain <caip2> --url <https-url>" },
  { path: ["x402", "fetch", "prepare-network"], replacement: "apn x402 fetch prepare --profile <profile> --chain <caip2> --url <https-url> --idempotency-key <key> --rpc-url <https-url>" },
  { path: ["wallet", "balance-asset"], replacement: "apn wallet balance --profile <profile> --chain <caip2> --asset <native-or-contract> --rpc-url <https-url>" },
  // Relay (owner decision OD-5): one prepare/execute/observe surface; the route comes from the chains or the saved operation.
  { path: ["relay", "base", "prepare"], replacement: "apn relay prepare --profile <profile> --source-chain eip155:1 --asset usdc --destination-chain eip155:8453 --recipient <address> --amount-atomic <usdc> --min-output-atomic <wei> --max-approval-network-fee-wei <wei> --max-deposit-network-fee-wei <wei> --idempotency-key <key>" },
  { path: ["relay", "native", "prepare"], replacement: "apn relay prepare --profile <profile> --source-chain <eip155:56|eip155:8453> --asset native --destination-chain <caip2> --recipient <address> --amount-atomic <wei> --min-output-atomic <destination-atomic> --max-deposit-network-fee-wei <wei> --idempotency-key <key>" },
  { path: ["relay", "arbitrum", "prepare"], replacement: "apn relay prepare --profile <profile> --source-chain eip155:42161 --asset usdc --destination-chain eip155:1 --recipient <address> --payer <address> --amount-atomic <usdc> --min-output-atomic <usdc> --max-provider-fee-atomic <usdc> --max-approval-network-fee-wei <wei> --max-deposit-network-fee-wei <wei> --quote-file <absolute-json-path> --idempotency-key <key>" },
  { path: ["relay", "preflight"], replacement: "apn relay execute --profile <profile> --operation <operation-id> --rpc-url <ethereum-rpc>" },
  { path: ["relay", "native", "execute"], replacement: "apn relay execute --profile <profile> --operation <operation-id> --rpc-url <source-rpc>" },
  { path: ["relay", "arbitrum", "approval-check"], replacement: "apn relay execute --profile <profile> --operation <operation-id> --rpc-url <arbitrum-rpc>" },
  { path: ["relay", "arbitrum", "approval-execute"], replacement: "apn relay execute --profile <profile> --operation <operation-id> --rpc-url <arbitrum-rpc>" },
  { path: ["relay", "arbitrum", "deposit-dispatch"], replacement: "apn relay execute --profile <profile> --operation <operation-id> --rpc-url <arbitrum-rpc>" },
  { path: ["relay", "base", "observe"], replacement: "apn relay observe --profile <profile> --operation <operation-id> --rpc-url <ethereum-rpc> --destination-rpc-url <base-rpc>" },
  { path: ["relay", "arbitrum", "observe"], replacement: "apn relay observe --profile <profile> --operation <operation-id> --rpc-url <arbitrum-rpc> [--destination-rpc-url <ethereum-rpc>]" },
  // Orca (SWAP-10): USDC to USDT is the usdc-usdt pool of the keyless Orca route; stable-status/release/recover-no-send/observe
  // stay to finish operations a released version prepared.
  { path: ["swap", "solana", "orca", "stable-inventory"], replacement: "apn swap solana orca inventory" },
  { path: ["swap", "solana", "orca", "stable-quote"], replacement: "apn swap solana orca quote --pool usdc-usdt --profile <profile> --account <solana-address> --amount <usdc-atomic> --slippage-bps <bps> --owner-slippage-cap-bps <bps> --compute-unit-limit <units> --compute-unit-price <micro-lamports>" },
  { path: ["swap", "solana", "orca", "stable-prepare"], replacement: "apn swap solana orca prepare --profile <profile> --quote <hash-of-a-usdc-usdt-quote> --idempotency-key <key>" },
  { path: ["swap", "solana", "orca", "stable-approve"], replacement: "apn swap solana orca approve --operation <operation-id>" },
  { path: ["swap", "solana", "orca", "stable-execute"], replacement: "apn swap solana orca execute --operation <operation-id>" },
];

const HISTORICAL_CIRCLE = "Historical Circle CCTP recovery for operations that are now terminal.";
/** v1 commands that the phase-4a pruning deletes without a successor. Each is listed once its command has left the
 * catalog; while it is still a command it stays out of the list, and the validator refuses a listed current path. */
const RETIRED_V1_COMMANDS: readonly RemovedV1Command[] = [
  { path: ["circle", "evm", "cleanup85-prepare"], replacement: null, reason: HISTORICAL_CIRCLE },
  { path: ["circle", "evm", "cleanup85-cancel"], replacement: null, reason: HISTORICAL_CIRCLE },
  { path: ["circle", "evm", "cleanup86-approve"], replacement: null, reason: HISTORICAL_CIRCLE },
  { path: ["circle", "evm", "cleanup-nonce"], replacement: null, reason: "Circle v1 nonce retirement; every v1 Circle operation is now terminal and read-only." },
  { path: ["operation", "repair-deployment"], replacement: null, reason: "Historical LI.FI deployment repair for an operation that is now terminal." },
];

/** The manifest's removed list for the given current command paths: every merged command, and each retired command
 * that is no longer current. */
export function removedV1Commands(currentPaths: ReadonlySet<string>): readonly RemovedV1Command[] {
  return [...REPLACED_V1_COMMANDS, ...RETIRED_V1_COMMANDS.filter((entry) => !currentPaths.has(entry.path.join(" ")))];
}

/** The removed v1 command an argv names, if any. */
export function removedV1Command(argv: readonly string[], removed: readonly RemovedV1Command[]): RemovedV1Command | undefined {
  return removed.find((entry) => entry.path.every((token, index) => argv[index] === token));
}

/** The failure message for an invocation of a removed v1 command. */
export function removedV1CommandMessage(entry: RemovedV1Command): string {
  return entry.replacement === null ? `This command was removed in command manifest v2: ${entry.reason}`
    : `This command was replaced in command manifest v2; use: ${entry.replacement}`;
}
