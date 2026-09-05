import { renderHelp, renderReadmeCommandReference } from "./command-help.js";
import { assertCompatibleManifestEvolution, validateCommandManifest } from "./command-manifest-validation.js";
export { renderHelp, renderReadmeCommandReference };
export { assertCompatibleManifestEvolution, validateCommandManifest };
export * from "./command-catalog-parser.js";
export type ScalarType = "string" | "profile" | "provider_id" | "provider_auth_method" | "positive_integer" | "https_url" | "address" | "decimal_usdc" | "atomic_usdc" | "wei" | "operation_id" | "transaction_hash" | "provider_request_id" | "idempotency_key" | "integer_seconds";
export type EffectClass = "none" | "local_read" | "network_read" | "local_write" | "payment_prepare" | "payment_submit" | "recovery";
export type ApprovalClass = "none" | "foreground_tty" | "prior_profile_policy" | "prior_operation_authorization";
export interface CommandOption {
    readonly name: `--${string}`;
    readonly type: ScalarType;
    readonly required: boolean;
    readonly default: {
        readonly kind: "none";
    } | {
        readonly kind: "literal";
        readonly value: string;
    };
    readonly constraints: readonly string[];
    readonly sensitivity: "public" | "operator_input" | "sensitive_input";
}
export interface CommandGroup {
    readonly path: readonly string[];
    readonly summary: string;
    readonly kind: "group";
}
export interface CommandDefinition {
    readonly path: readonly string[];
    readonly synopsis: string;
    readonly summary: string;
    readonly options: readonly CommandOption[];
    readonly effect: {
        readonly class: EffectClass;
        readonly summary: string;
    };
    readonly approval: {
        readonly class: ApprovalClass;
        readonly when: string;
    };
    readonly output: {
        readonly contract: "text" | "apn.cli.v1";
        readonly success_exit: 0;
        readonly failure_exit: 1;
        readonly success: string;
        readonly failures: readonly string[];
    };
    readonly states: {
        readonly terminal: readonly string[];
        readonly non_terminal: readonly string[];
    };
    readonly recovery: readonly {
        readonly command_path: readonly string[];
        readonly when: string;
    }[];
    readonly examples: readonly string[];
}
export declare const COMMAND_GROUPS: readonly CommandGroup[];
export declare const COMMANDS: readonly CommandDefinition[];
export declare const COMMAND_MANIFEST: {
    readonly schema_version: "apn.command-manifest.v1";
    readonly product: "agent-payment-node";
    readonly product_version: "0.5.7";
    readonly cli_envelope_version: "apn.cli.v1";
    readonly compatibility: {
        readonly additive_optional_within_version: true;
        readonly breaking_change_requires_new_schema: readonly ["field_remove_or_rename", "meaning_or_unit_change", "optional_to_required", "enum_contraction"];
    };
    readonly discovery: {
        readonly root_text_forms: readonly ["apn --help", "apn help"];
        readonly scoped_text_forms: readonly ["apn <path...> --help", "apn help <path...>"];
        readonly machine_form: "apn help --json";
        readonly options: readonly [{
            readonly name: "--help";
            readonly type: "flag";
            readonly scope: "root_group_or_command";
        }, {
            readonly name: "--json";
            readonly type: "flag";
            readonly scope: "root_help_only";
        }];
    };
    readonly groups: readonly CommandGroup[];
    readonly commands: readonly CommandDefinition[];
};
