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
    /** The family's saved record behind an ID; an ID the index does not hold may belong to a family without an adapter yet. */
    private found;
    /** The option combinations no family accepts, checked before any state is read (as before the index). */
    private assertResumeOptions;
}
/** The owner release of an index entry whose record cannot be read; the record file and any ledger hold stay as they are. */
export declare const abandonCommand: (operationId: string) => string;
export {};
