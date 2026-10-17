import type { StateStore } from "../state.js";
import type { GaslessAllowlistBinding, GaslessIntent } from "./model.js";
import type { GaslessChainId } from "./model.js";
import type { GaslessOperationRecord } from "./operation-model.js";
export type GaslessPolicyChain = `eip155:${number}`;
/**
 * Every executable Circle gasless chain moves USDC only under the owner's allowlist and asset-usage caps, exactly like
 * a direct transfer. Only the historical, non-executable Avalanche row of this adapter has no policy chain.
 */
export declare function gaslessPolicyChain(chainId: GaslessChainId): GaslessPolicyChain | null;
/** The reference names the canonical Circle USDC paymaster for the selected network. */
export declare function localGaslessMechanism(chainId: GaslessChainId): {
    provider: "local";
    reference: string;
};
/** Called only while the common profile lock is held. Ledger bucket locks are nested after it. */
export declare class GaslessAssetPolicy {
    private readonly state;
    private readonly now;
    private readonly store;
    private readonly usage;
    constructor(state: StateStore, now: () => number);
    private active;
    private admit;
    prepare(intent: Pick<GaslessIntent, "profile" | "owner" | "request" | "token">, operationId: string): Promise<GaslessAllowlistBinding>;
    /** Recheck the owner activation and caps before every first signature, disclosure and dispatch. */
    assert(op: GaslessOperationRecord, requireReservation: boolean): Promise<void>;
    /** Fresh consent can use only the already charged unknown lease; never a replacement reservation. */
    assertSealedFirstSend(op: GaslessOperationRecord): Promise<void>;
    reserve(op: GaslessOperationRecord): Promise<void>;
    /** A saved operation is authoritative; a crash between journal and ledger writes is repaired on the next read. */
    reconcile(op: GaslessOperationRecord): Promise<void>;
    /** Runs on every read (reconcile): only the saved binding's own fields, which `validateGaslessIntent` also checks. */
    private assertBinding;
    private checkedReservation;
}
