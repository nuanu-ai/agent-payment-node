import type { OperationAbandonIntent } from "../operation-abandon-approval.js";
import type { StargateTokenJournal, StargateTokenOperation } from "./token-model.js";
/**
 * R4 exit 3 of a token Stargate journal (the shared token abandon): its deadline is the prepare expiry, after which no
 * new effect is signed; a pending ledger transition is settled by `apn stargate token status` first, so the abandoned
 * journal keeps a settled hold. Its consent names any signed approval, send or cleanup and the pool allowance.
 */
export declare function abandonStargateV2Token(id: string, journal: StargateTokenJournal, approve: (intent: OperationAbandonIntent) => Promise<void>, now: () => number): Promise<StargateTokenOperation>;
