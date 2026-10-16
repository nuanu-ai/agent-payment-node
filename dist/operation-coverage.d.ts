import type { StoredMoneyOperation } from "./operation-service.js";
/** Kinds that `apn operation status|resume` and `apn receipt get` resolve (OperationService.required). */
export declare const GENERIC_OPERATION_KINDS: readonly StoredMoneyOperation["kind"][];
/** Kinds `apn operation abandon` can close with owner consent (operation-abandon-service.ts). */
export declare const ABANDON_OPERATION_KINDS: readonly StoredMoneyOperation["kind"][];
/**
 * Turns a bare "operation not found" from a generic operation command into an exact answer: either the operation
 * belongs to a family those commands do not cover yet (with that family's own commands), or it is unknown to every
 * store. Only names are listed (no record is parsed), so a damaged record of another family cannot change the answer.
 */
export declare function explainOperationNotFound(root: string, request: {
    readonly command: string;
}, error: unknown): Promise<unknown>;
