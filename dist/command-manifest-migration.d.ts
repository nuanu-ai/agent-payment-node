/** Manifest v2 removed these v1 commands. Each names the v2 command that performs the same request, so `apn help --json`
 * clients can migrate and an old invocation fails with the replacement as its next action. */
export interface RemovedV1Command {
    readonly path: readonly string[];
    readonly replacement: string;
}
export declare const REMOVED_V1_COMMANDS: readonly RemovedV1Command[];
/** The removed v1 command an argv names, if any. */
export declare function removedV1Command(argv: readonly string[]): RemovedV1Command | undefined;
