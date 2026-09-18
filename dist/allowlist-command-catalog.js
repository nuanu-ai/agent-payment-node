import { ApnError } from "./errors.js";
const noDefault = { kind: "none" };
const completed = { terminal: ["completed", "classified_failure"], non_terminal: [] };
const option = (name, required, constraints, type = "string") => ({
    name, type, required, default: noDefault, constraints, sensitivity: "public",
});
const profileOption = option("--profile", true, ["matches_[a-z0-9][a-z0-9._-]{0,63}"]);
const revisionOption = option("--revision", true, ["exact_staged_revision", "positive_safe_integer"], "positive_integer");
const envelope = (success) => ({ contract: "apn.cli.v1", success_exit: 0, failure_exit: 1,
    success, failures: ["One classified-failure apn.cli.v1 envelope."] });
export const ALLOWLIST_COMMAND_GROUPS = [
    { path: ["allowlist"], summary: "Inspect the frozen candidate asset inventory without granting execution authority.", kind: "group" },
    { path: ["allowlist", "policy"], summary: "Stage, activate, inspect and revoke owner allowlist policies; activation and revocation need the foreground terminal.", kind: "group" },
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
        summary: "Compile and durably stage one exact inventory admission; use stage for several admissions or swap pins. Never activates.",
        options: [
            option("--profile", true, ["matches_[a-z0-9][a-z0-9._-]{0,63}"]),
            option("--account", true, ["canonical_for_selected_family"]), option("--overlay-version", true, ["bounded_version"]),
            option("--chain", true, ["exact_frozen_network_identity"]), option("--kind", true, ["literal_native_or_token"]),
            option("--identifier", false, ["omitted_for_native", "exact_for_token"]),
            option("--rail", true, ["direct_gasless_x402_bridge", "swap_requires_stage_file_pin"]),
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
        path: ["allowlist", "policy", "stage"],
        synopsis: "apn allowlist policy stage --profile <profile> --file <absolute-policy-file> [--expected-revision <revision>]",
        summary: "Stage one owner-written policy file: many assets x rails, EVM/TRON/Solana accounts, per-rail caps and swap pins. Never activates.",
        options: [profileOption,
            option("--file", true, ["absolute_canonical_path", "apn.allowlist-policy-file.v1", "owner_owned_not_group_or_world_writable"]),
            option("--expected-revision", false, ["required_for_update", "positive_safe_integer"], "positive_integer")],
        effect: { class: "local_write", summary: "Creates one owner-only immutable staged policy revision under the profile lock." },
        approval: { class: "none", when: "Staging grants no execution authority; activation is a separate foreground operator step." },
        output: envelope("One staged_unadmitted apn.cli.v1 envelope."), states: completed, recovery: [],
        examples: ["apn allowlist policy stage --profile default --file /Users/owner/apn-policy.json"],
    },
    {
        path: ["allowlist", "policy", "activate"], synopsis: "apn allowlist policy activate --profile <profile> --revision <revision>",
        summary: "Show every admission of one staged revision and, after the typed approval code, write the sealed ACTIVE record.",
        options: [profileOption, revisionOption],
        effect: { class: "local_write", summary: "Appends one sealed, hash-chained activation entry that rails load as the profile's active policy." },
        approval: { class: "foreground_tty", when: "Always; the owner reads the exact admission screen and types its six-character code." },
        output: envelope("One owner_activated_allowlist_policy envelope."), states: completed, recovery: [],
        examples: ["apn allowlist policy activate --profile default --revision 1"],
    },
    {
        path: ["allowlist", "policy", "revoke"], synopsis: "apn allowlist policy revoke --profile <profile> --revision <revision>",
        summary: "Show the active revision and, after the typed approval code, record that no allowlist policy is active.",
        options: [profileOption, revisionOption],
        effect: { class: "local_write", summary: "Appends one sealed, hash-chained revocation entry; rails that require an active policy refuse." },
        approval: { class: "foreground_tty", when: "Always; the owner reads the exact revocation screen and types its six-character code." },
        output: envelope("One owner_revoked_allowlist_policy envelope."), states: completed, recovery: [],
        examples: ["apn allowlist policy revoke --profile default --revision 1"],
    },
    {
        path: ["allowlist", "policy", "status"], synopsis: "apn allowlist policy status --profile <profile>",
        summary: "Authenticate and show the latest staged revision, the active revision and the last owner decision.",
        options: [profileOption],
        effect: { class: "local_read", summary: "Reads owner-only staged and activation policy state." }, approval: { class: "none", when: "Never." },
        output: envelope("One authenticated staged and active status."), states: completed, recovery: [],
        examples: ["apn allowlist policy status --profile default"],
    },
];
export function bindAllowlistCommand(path, options) {
    switch (path) {
        case "allowlist inventory": return { command: "allowlist.inventory" };
        case "allowlist resolve": return { command: "allowlist.resolve", chain: value(options, "--chain"), kind: kind(options),
            ...(options["--identifier"] === undefined ? {} : { identifier: options["--identifier"] }) };
        case "allowlist policy status": return { command: "allowlist.policy.status", profile: value(options, "--profile") };
        case "allowlist policy stage": return { command: "allowlist.policy.stage", profile: value(options, "--profile"),
            file: value(options, "--file"), ...expectedRevision(options) };
        case "allowlist policy activate":
        case "allowlist policy revoke": return { command: path === "allowlist policy activate" ? "allowlist.policy.activate" : "allowlist.policy.revoke",
            profile: value(options, "--profile"), revision: revision(value(options, "--revision")) };
        case "allowlist policy prepare": {
            const rail = value(options, "--rail");
            if (rail !== "direct" && rail !== "gasless" && rail !== "x402" && rail !== "bridge" && rail !== "swap") {
                throw new ApnError("APN_INVALID_INPUT", "Allowlist policy rail is invalid.", { reason: "invalid_rail" });
            }
            return { command: "allowlist.policy.prepare", profile: value(options, "--profile"),
                account: value(options, "--account"), overlayVersion: value(options, "--overlay-version"),
                chain: value(options, "--chain"), kind: kind(options), ...(options["--identifier"] === undefined ? {} : { identifier: options["--identifier"] }),
                rail, maximumPerTransferAtomic: value(options, "--max-per-transfer-atomic"),
                dailyLimitAtomic: value(options, "--daily-limit-atomic"), effectiveAt: value(options, "--effective-at"),
                ...(options["--expires-at"] === undefined ? {} : { expiresAt: options["--expires-at"] }),
                ...(options["--mechanism-provider"] === undefined ? {} : { mechanismProvider: options["--mechanism-provider"] }),
                ...(options["--mechanism-reference"] === undefined ? {} : { mechanismReference: options["--mechanism-reference"] }),
                ...expectedRevision(options) };
        }
        default: throw new ApnError("APN_UNSUPPORTED_COMMAND", "Unsupported allowlist command.");
    }
}
function kind(options) {
    const selected = value(options, "--kind");
    if (selected !== "native" && selected !== "token") {
        throw new ApnError("APN_ALLOWLIST_IDENTITY_INVALID", "Asset kind must be exactly native or token.", { reason: "invalid_kind" });
    }
    return selected;
}
function expectedRevision(options) {
    const selected = options["--expected-revision"];
    if (selected === undefined)
        return {};
    if (!/^[1-9][0-9]*$/u.test(selected) || !Number.isSafeInteger(Number(selected))) {
        throw new ApnError("APN_INVALID_INPUT", "Expected revision must be a positive safe integer.", { reason: "invalid_revision" });
    }
    return { expectedRevision: Number(selected) };
}
function revision(selected) {
    if (!/^[1-9][0-9]*$/u.test(selected) || !Number.isSafeInteger(Number(selected))) {
        throw new ApnError("APN_INVALID_INPUT", "Revision must be a positive safe integer.", { reason: "invalid_revision" });
    }
    return Number(selected);
}
function value(options, name) {
    const selected = options[name];
    if (selected === undefined)
        throw new ApnError("APN_INTERNAL", "The command catalog omitted a required request binding.");
    return selected;
}
//# sourceMappingURL=allowlist-command-catalog.js.map