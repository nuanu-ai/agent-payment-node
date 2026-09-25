import type { StateStore } from "../state.js";
import type { GaslessAllowlistBinding, GaslessIntent } from "./model.js";
import type { GaslessChainId } from "./model.js";
import type { GaslessOperationRecord } from "./operation-model.js";
export declare const BASE_GASLESS_CHAIN: "eip155:8453";
export declare const ETHEREUM_GASLESS_CHAIN: "eip155:1";
export declare function gaslessPolicyChain(chainId: GaslessChainId): typeof BASE_GASLESS_CHAIN | typeof ETHEREUM_GASLESS_CHAIN | null;
/** The reference names the canonical Circle USDC paymaster for the selected network. */
export declare function localGaslessMechanism(chainId: GaslessChainId): {
    provider: "local";
    reference: string;
};
export declare const baseLocalGaslessMechanism: () => {
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
    reserve(op: GaslessOperationRecord): Promise<void>;
    /** A saved operation is authoritative; a crash between journal and ledger writes is repaired on the next read. */
    reconcile(op: GaslessOperationRecord): Promise<void>;
    private assertBinding;
    private checkedReservation;
}
