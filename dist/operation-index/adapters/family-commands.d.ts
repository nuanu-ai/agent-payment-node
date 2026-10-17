/**
 * The generic `apn operation status|resume|abandon` answers of the families phase 4b WP2 added. Each delegates to the
 * family's own command code (loaded when called, so the adapters add nothing to the module graph the index loads).
 */
export declare const OPERATION_STATUS = "apn operation status --operation <operation-id>";
export declare const OPERATION_RESUME = "apn operation resume --operation <operation-id>";
export declare const OPERATION_ABANDON = "apn operation abandon --operation <operation-id>";
/** The family runtime a command needs, or the same refusal its own command gives when it is not installed. */
export declare function installed<T>(service: T | undefined, message: string): T;
