import type { OperationAbandonApprovalPort } from "../operation-abandon-approval.js";
import type { StateStore } from "../state.js";
import { type MerchantOperation } from "./model.js";
import type { MerchantRpcPort } from "./rpc.js";
/** The locks every command that changes one merchant payment holds. */
export declare function merchantLocks(profileHash: string, operationId: string, idempotencyHash: string, payer: string): string[];
/**
 * The exits of a merchant payment that holds no payment receipt (phase 4c R4). Proof first, with no consent: a payment
 * never signed, or whose signature never left a process that died before sealing it, ends `failed_before_effect` once
 * its local deadline passed (custody refuses to sign after it); a signed transaction ends `failed_proven_superseded`
 * once another transaction took its nonce at the finalized tag and the node knows neither it nor a receipt. Both
 * release the payment's holds. When no proof decides, the owner's TTY consent ends it `abandoned_unknown` with both
 * holds still charged. Nothing here signs, sends or delivers.
 */
export declare class MerchantExits {
    private readonly state;
    private readonly rpc;
    private readonly now;
    private readonly records;
    private readonly fences;
    private readonly ledger;
    constructor(state: StateStore, rpc: MerchantRpcPort, now: () => Date);
    /** The proven exit of an attempt without a receipt, or null while none is proven (nothing changes). The caller holds merchantLocks. */
    settle(o: MerchantOperation): Promise<MerchantOperation | null>;
    abandon(idInput: string, consent: OperationAbandonApprovalPort): Promise<MerchantOperation>;
    /** Holds first (a retry after a crash repeats the same outcome digest), then the terminal record. */
    private finish;
    private required;
}
