import type { OperationResumeOptions } from "../adapter.js";
/**
 * The generic `apn operation status|resume|abandon` answers of the families phase 4b WP2 added. Each delegates to the
 * family's own command code (loaded when called, so the adapters add nothing to the module graph the index loads).
 */
export declare const OPERATION_STATUS = "apn operation status --operation <operation-id>";
export declare const OPERATION_RESUME = "apn operation resume --operation <operation-id>";
export declare const OPERATION_ABANDON = "apn operation abandon --operation <operation-id>";
/**
 * A family whose recovery reads none of the `operation resume` options refuses each one with the message the generic
 * command used (phase 4b WP3 keeps the shared helper; this is its no-option case).
 */
export declare function assertNoResumeOptions(options: OperationResumeOptions, family: string): void;
/** The family runtime a command needs, or the same refusal its own command gives when it is not installed. */
export declare function installed<T>(service: T | undefined, message: string): T;
