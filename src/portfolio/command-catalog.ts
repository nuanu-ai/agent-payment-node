import type { CommandDefinition } from "../command-catalog.js";

export const PORTFOLIO_COMMANDS: readonly CommandDefinition[] = [
  {
    path: ["wallet", "portfolio"], synopsis: "apn wallet portfolio [--profile <profile>] [--refresh]",
    summary: "Read every native coin and list token on all frozen-list networks in one batched, read-only pass.",
    options: [{ name: "--profile", type: "profile", required: false, default: { kind: "literal", value: "default" },
      constraints: ["matches_[a-z0-9][a-z0-9._-]{0,63}"], sensitivity: "public" },
      { name: "--refresh", type: "boolean", required: false, default: { kind: "literal", value: "false" },
        constraints: ["bypass_15_second_balance_result_cache"], sensitivity: "public" }],
    effect: { class: "network_read", summary: "A successful read may reuse a private 15-second balance result; --refresh bypasses it. Fresh reads use one batch per network through APN_*_RPC_URL or its pinned keyless public default; never signs, submits or moves funds." },
    approval: { class: "none", when: "Never." },
    output: { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
      success: "Per-network rows with ok, unavailable (with reason), no_account or rpc_not_configured status, endpoint source and RPC call counts; a failed read is never reported as zero.",
      failures: ["One classified-failure apn.cli.v1 envelope."] },
    states: { terminal: ["completed", "classified_failure"], non_terminal: [] }, recovery: [],
    examples: ["apn wallet portfolio --profile default"],
  },
] as const;
