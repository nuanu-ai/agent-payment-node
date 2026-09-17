import type { CommandDefinition, CommandGroup, CommandOption } from "./command-catalog.js";

const noDefault = { kind: "none" } as const;
const completed = { terminal: ["completed", "classified_failure"], non_terminal: [] } as const;
const option = (name: `--${string}`, required: boolean, constraints: readonly string[]): CommandOption => ({
  name, type: "string", required, default: noDefault, constraints, sensitivity: "public",
});

export const ALLOWLIST_COMMAND_GROUPS: readonly CommandGroup[] = [
  { path: ["allowlist"], summary: "Inspect the frozen candidate asset inventory without granting execution authority.", kind: "group" },
] as const;

export const ALLOWLIST_COMMANDS: readonly CommandDefinition[] = [
  {
    path: ["allowlist", "inventory"], synopsis: "apn allowlist inventory",
    summary: "List frozen networks, asset identities, verified deployments, disabled rails, provenance and digests.", options: [],
    effect: { class: "local_read", summary: "Reads and verifies the bundled frozen candidate dataset only." },
    approval: { class: "none", when: "Never." },
    output: { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
      success: "One successful apn.cli.v1 envelope.", failures: ["One classified-failure apn.cli.v1 envelope."] },
    states: completed, recovery: [], examples: ["apn allowlist inventory"],
  },
  {
    path: ["allowlist", "resolve"],
    synopsis: "apn allowlist resolve --chain <exact-network-identity> --kind <native|token> [--identifier <exact-token-identifier>]",
    summary: "Resolve one exact frozen native or token identity without symbol or address fallback.",
    options: [
      option("--chain", true, ["exact_eip155_solana_or_tron_network_identity"]),
      option("--kind", true, ["literal_native_or_token"]),
      option("--identifier", false, ["omitted_for_native", "required_exact_canonical_deployment_for_token"]),
    ],
    effect: { class: "local_read", summary: "Reads and verifies the bundled frozen candidate dataset only." },
    approval: { class: "none", when: "Never." },
    output: { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
      success: "One successful apn.cli.v1 envelope.", failures: ["One classified-failure apn.cli.v1 envelope."] },
    states: completed, recovery: [],
    examples: ["apn allowlist resolve --chain eip155:1 --kind token --identifier <exact-token-identifier>"],
  },
] as const;
