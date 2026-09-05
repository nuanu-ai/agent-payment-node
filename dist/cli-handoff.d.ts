export interface CliHandoff {
    readonly argv: readonly string[];
    readonly shell: string;
}
export interface CliHandoffDetails {
    readonly cli_handoff: string;
    readonly cli_handoff_argv: readonly string[];
}
export declare function containsRawControlCharacters(value: string): boolean;
export declare function createCliHandoff(input: readonly string[]): CliHandoff;
export declare function cliHandoffDetails(handoff: CliHandoff): CliHandoffDetails;
