/** v2 removed and merged v1 commands; `removed_v1_commands` names each replacement. */
export declare const COMMAND_MANIFEST_SCHEMA = "apn.command-manifest.v2";
export declare function validateCommandManifest(value: unknown): void;
export declare function assertCompatibleManifestEvolution(previous: unknown, next: unknown): void;
