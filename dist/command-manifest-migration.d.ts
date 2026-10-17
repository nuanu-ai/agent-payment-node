/** Manifest v2 removed these v1 commands. A merged command names the v2 command that performs the same request, so
 * `apn help --json` clients can migrate and an old invocation fails with the replacement as its next action. A command
 * removed without a successor has `replacement: null` and a short `reason`. */
export type RemovedV1Command = {
    readonly path: readonly string[];
    readonly replacement: string;
} | {
    readonly path: readonly string[];
    readonly replacement: null;
    readonly reason: string;
};
/** The manifest's removed list for the given current command paths: every merged command, and each retired command
 * that is no longer current. */
export declare function removedV1Commands(currentPaths: ReadonlySet<string>): readonly RemovedV1Command[];
/** The removed v1 command an argv names, if any. */
export declare function removedV1Command(argv: readonly string[], removed: readonly RemovedV1Command[]): RemovedV1Command | undefined;
/** The failure message for an invocation of a removed v1 command. */
export declare function removedV1CommandMessage(entry: RemovedV1Command): string;
