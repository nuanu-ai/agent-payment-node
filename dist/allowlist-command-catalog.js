const noDefault = { kind: "none" };
const completed = { terminal: ["completed", "classified_failure"], non_terminal: [] };
const option = (name, required, constraints) => ({
    name, type: "string", required, default: noDefault, constraints, sensitivity: "public",
});
export const ALLOWLIST_COMMAND_GROUPS = [
    { path: ["allowlist"], summary: "Inspect the frozen candidate asset inventory without granting execution authority.", kind: "group" },
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
];
//# sourceMappingURL=allowlist-command-catalog.js.map