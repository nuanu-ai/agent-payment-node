/** Manifest v2 removed these v1 commands. Each names the v2 command that performs the same request, so `apn help --json`
 * clients can migrate and an old invocation fails with the replacement as its next action. */
export interface RemovedV1Command {
  readonly path: readonly string[];
  readonly replacement: string;
}

export const REMOVED_V1_COMMANDS: readonly RemovedV1Command[] = [
  { path: ["wallet", "policy", "show-network"], replacement: "apn wallet policy show --profile <profile> --chain <caip2>" },
  { path: ["wallet", "policy", "set-network"], replacement: "apn wallet policy set --profile <profile> --chain <caip2> --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic>" },
  { path: ["x402", "inspect-network"], replacement: "apn x402 inspect --chain <caip2> --url <https-url>" },
  { path: ["x402", "fetch", "prepare-network"], replacement: "apn x402 fetch prepare --profile <profile> --chain <caip2> --url <https-url> --idempotency-key <key> --rpc-url <https-url>" },
  { path: ["wallet", "balance-asset"], replacement: "apn wallet balance --profile <profile> --chain <caip2> --asset <native-or-contract> --rpc-url <https-url>" },
];

/** The removed v1 command an argv names, if any. */
export function removedV1Command(argv: readonly string[]): RemovedV1Command | undefined {
  return REMOVED_V1_COMMANDS.find((entry) => entry.path.every((token, index) => argv[index] === token));
}
