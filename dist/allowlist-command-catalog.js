const noDefault = { kind: "none" };
const completed = { terminal: ["completed", "classified_failure"], non_terminal: [] };
const option = (name, required, constraints) => ({
    name, type: "string", required, default: noDefault, constraints, sensitivity: "public",
});
export const ALLOWLIST_COMMAND_GROUPS = [
    { path: ["allowlist"], summary: "Inspect the frozen candidate asset inventory without granting execution authority.", kind: "group" },
    { path: ["allowlist", "policy"], summary: "Prepare and inspect profile-bound allowlist policy overlays without activating money authority.", kind: "group" },
];
export const ALLOWLIST_COMMANDS = [
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
    {
        path: ["allowlist", "policy", "prepare"],
        synopsis: "apn allowlist policy prepare --profile <profile> --account <canonical-account> --overlay-version <version> --chain <network> --kind <native|token> [--identifier <token>] --rail <rail> --max-per-transfer-atomic <atomic> --daily-limit-atomic <atomic> --effective-at <ISO-instant> [--expires-at <ISO-instant>] [--mechanism-provider <provider> --mechanism-reference <reference>] [--expected-revision <revision>]",
        summary: "Compile and durably stage one exact inventory admission; this command never activates the resulting registry.",
        options: [
            option("--profile", true, ["matches_[a-z0-9][a-z0-9._-]{0,63}"]),
            option("--account", true, ["canonical_for_selected_family"]), option("--overlay-version", true, ["bounded_version"]),
            option("--chain", true, ["exact_frozen_network_identity"]), option("--kind", true, ["literal_native_or_token"]),
            option("--identifier", false, ["omitted_for_native", "exact_for_token"]),
            option("--rail", true, ["direct_gasless_x402_bridge", "swap_refused_card3"]),
            option("--max-per-transfer-atomic", true, ["positive_uint256", "no_default"]),
            option("--daily-limit-atomic", true, ["positive_uint256", "no_default"]),
            option("--effective-at", true, ["canonical_ISO_instant"]), option("--expires-at", false, ["canonical_ISO_instant_after_effective"]),
            option("--mechanism-provider", false, ["required_with_reference_for_gasless_x402_bridge"]),
            option("--mechanism-reference", false, ["required_with_provider_for_gasless_x402_bridge"]),
            option("--expected-revision", false, ["required_for_update", "positive_safe_integer"]),
        ],
        effect: { class: "local_write", summary: "Creates one owner-only immutable staged policy version under the profile lock." },
        approval: { class: "none", when: "Preparation grants no execution authority; activation is a separate foreground operator step." },
        output: { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
            success: "One staged_unadmitted apn.cli.v1 envelope.", failures: ["One classified-failure apn.cli.v1 envelope."] },
        states: completed, recovery: [], examples: ["apn allowlist policy prepare --profile default --account <account> --overlay-version owner.1 --chain eip155:1 --kind native --rail direct --max-per-transfer-atomic <positive> --daily-limit-atomic <positive> --effective-at <ISO-instant>"],
    },
    {
        path: ["allowlist", "policy", "status"], synopsis: "apn allowlist policy status --profile <profile>",
        summary: "Read and authenticate the latest staged allowlist policy version without admitting it.",
        options: [option("--profile", true, ["matches_[a-z0-9][a-z0-9._-]{0,63}"])],
        effect: { class: "local_read", summary: "Reads owner-only staged policy state." }, approval: { class: "none", when: "Never." },
        output: { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
            success: "One authenticated staged status or explicit not_present result.", failures: ["One classified-failure apn.cli.v1 envelope."] },
        states: completed, recovery: [], examples: ["apn allowlist policy status --profile default"],
    },
];
//# sourceMappingURL=allowlist-command-catalog.js.map