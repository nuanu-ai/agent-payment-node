import type { OperationAbandonIntent } from "../operation-abandon-approval.js";
import type { StargateTokenJournal, StargateTokenOperation } from "./token-model.js";
/**
 * R4 exit 3, the last resort: the owner closes a token Stargate journal that no proof decided, once its prepare expiry
 * passed (no new effect is signed after it), with TTY consent. The journal becomes `abandoned_unknown` and the operation
 * index releases the account; the usage ledger stays as it is (charged). Nothing is signed: a signed approval, send or
 * cleanup may still land, and a residual allowance may remain, which the consent states.
 */
export declare function abandonStargateV2Token(id: string, journal: StargateTokenJournal, approve: (intent: OperationAbandonIntent) => Promise<void>, now: () => number): Promise<StargateTokenOperation>;
