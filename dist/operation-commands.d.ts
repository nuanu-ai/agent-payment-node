import type { CommandOutcome, CommandRequest } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
type ResumeRequest = Extract<CommandRequest, {
    readonly command: "operation.resume";
}>;
/**
 * `apn operation status|resume|abandon` and `apn receipt get` for every family: one operation-index lookup, then the
 * family's adapter, which delegates to that family's own functions. There is no generic state machine here: a family
 * without a generic resume, receipt or owner exit answers with the command that is its exit. The owner exit of a record
 * that cannot be read (or of an admission whose prepare crashed) is the index's own release, behind TTY consent.
 */
export declare class OperationCommands {
    private readonly context;
    private readonly index;
    constructor(context: RuntimeContext);
    status(operationId: string): Promise<CommandOutcome>;
    resume(request: ResumeRequest): Promise<CommandOutcome>;
    receipt(operationId: string): Promise<CommandOutcome>;
    abandon(operationIdInput: string): Promise<CommandOutcome>;
    /** The family's own terminal rule on the record just read; a lifecycle that cannot be decided is not terminal. */
    private terminal;
    /** The family's saved record behind an ID; the index holds every family's operations. */
    private found;
    /** Every family's operations are indexed except a gasless USDT preparation that never executed, which has its own status. */
    private notIndexed;
    /** The option combinations no family accepts, checked before any state is read (as before the index). */
    private assertResumeOptions;
}
/**
 * The family command whose runtime a generic operation command delegates to, read before that runtime is built: the
 * runtime factory builds a family runtime only for the commands that name it. Null for any other command, when the
 * family answers this one without its runtime, and when the lookup refuses (an unknown ID, an unreadable record): the
 * command repeats the same lookup and answers that refusal itself.
 */
export declare function operationRuntimeCommand(root: string, request: CommandRequest): Promise<CommandRequest["command"] | null>;
/** The owner release of an index entry whose record cannot be read; the record file and any ledger hold stay as they are. */
export declare const abandonCommand: (operationId: string) => string;
export {};
