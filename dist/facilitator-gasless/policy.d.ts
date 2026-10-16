import { type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import type { FacilitatorAllowlistBinding, FacilitatorIntent, FacilitatorOperationRecord } from "./operation-model.js";
/** The owner's allowlist pins this exact relaying route: PayAI's public x402 facilitator on Avalanche C-Chain. */
export declare const FACILITATOR_GASLESS_MECHANISM: Readonly<{
    provider: "payai-x402-facilitator";
    reference: `eip155:43114:${string}`;
}>;
/** The saved binding is checked only against its own operation (rule R2); the current pin is compared before effects. */
export declare function validateFacilitatorAllowlist(op: Pick<FacilitatorOperationRecord, "operationId" | "intent">): FacilitatorAllowlistBinding;
/**
 * Owner admission, caps and the shared asset-usage ledger for Avalanche facilitator transfers (rail `gasless`). Called
 * only while the operation's profile lock and the allowlist profile lock are held; ledger bucket locks nest inside.
 */
export declare class FacilitatorGaslessPolicy {
    private readonly now;
    private readonly store;
    private readonly usage;
    constructor(root: string, now: () => number);
    private active;
    private admit;
    prepare(intent: Pick<FacilitatorIntent, "profile" | "owner" | "request">, operationId: string): Promise<FacilitatorAllowlistBinding>;
    /** Recheck the unchanged owner activation and caps; `requireReservation` before the authorization leaves APN. */
    assert(op: FacilitatorOperationRecord, requireReservation: boolean): Promise<ActiveAssetPolicy>;
    /** Charges the exact gross before the owner signs; a replay returns the same reservation. */
    reserve(op: FacilitatorOperationRecord): Promise<void>;
    /**
     * The saved operation is authoritative; a crash between the journal and the ledger is repaired on the next read.
     * Exposure keeps the full charge until finalized evidence proves delivery or an unused, expired authorization.
     */
    reconcile(op: FacilitatorOperationRecord): Promise<void>;
    private checked;
}
