/** These runtime bytes bind both new-family parsing and the shared lookup/guard/recovery routes. */
export declare const SA_RECOVERY_REQUIRED_ARTIFACTS: string[];
export interface SmartAccountGaslessRecoveryTarget {
    readonly stateRoot: string;
    readonly archive: string;
    readonly manifest: string;
    /** Obtain from independent archive/source/installation verification, never from the target manifest itself. */
    readonly manifestSha256: string;
    readonly packageRoot: string;
}
/** Read-only selection preflight. It never imports or invokes a target executable, initializes state, or repairs receipts. */
export declare function selectSmartAccountGaslessRecoveryArchive(input: SmartAccountGaslessRecoveryTarget): Promise<{
    readonly proof_class: "verified_archive_recovery_selection";
    readonly target_execution_performed: false;
    readonly archive: string;
    readonly archive_sha256: string;
    readonly manifest_sha256: string;
    readonly package_root: string;
    readonly source_commit: string;
    readonly files_verified: number;
    readonly supports_smart_account_gasless: boolean;
    readonly required_runtime_hashes: Record<string, string>;
    readonly state_digest: string;
    readonly smart_account_operations: number;
    readonly guards_held: number;
}>;
