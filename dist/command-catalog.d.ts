import { renderHelp, renderReadmeCommandReference } from "./command-help.js";
import { assertCompatibleManifestEvolution, validateCommandManifest } from "./command-manifest-validation.js";
import type { CommandDefinition, CommandGroup } from "./command-catalog-types.js";
export { renderHelp, renderReadmeCommandReference };
export { assertCompatibleManifestEvolution, validateCommandManifest };
export * from "./command-catalog-parser.js";
export type { ApprovalClass, CommandDefinition, CommandGroup, CommandOption, EffectClass, ScalarType } from "./command-catalog-types.js";
export declare const COMMAND_GROUPS: readonly CommandGroup[];
export declare const COMMANDS: readonly CommandDefinition[];
export declare const COMMAND_MANIFEST: {
    readonly schema_version: "apn.command-manifest.v1";
    readonly product: "agent-payment-node";
    readonly product_version: "0.5.24";
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
