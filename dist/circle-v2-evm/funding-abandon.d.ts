import type { OperationAbandonApprovalPort } from "../operation-abandon-approval.js";
import type { StateStore } from "../state.js";
/** The journal reason of a Circle funding route the owner closed with a possibly-sent effect no proof decided. */
export declare const CIRCLE_FUNDING_OWNER_ABANDON = "owner_abandoned_unknown";
/**
 * R4 exit 3 of a Circle CCTP V2 funding route that a possibly-sent approval, burn, mint or cleanup keeps open and no proof
 * decides (an envelope frozen before eras were recorded never proves never-lands; a pruned node proves nothing). Past the
 * route's expiry, the owner's TTY consent ends it `abandoned_unknown`: nothing is signed or sent, every usage hold stays
 * charged, and the operation index releases both accounts and profiles. The effect may still land; the consent says so.
 */
export declare function abandonCircleFunding(state: StateStore, operationId: string, consent: OperationAbandonApprovalPort, now: () => number): Promise<unknown>;
