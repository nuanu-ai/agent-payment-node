import { SecureStateStore } from "../../secure-state-store.js";
import type { TokenEffectKind } from "./token-execution.js";
import type { UniswapTokenOperation } from "./token-operation.js";
export type TokenNonceEvidence = "reserved" | "committed" | null;
type Evidence = (operationId: string, kind: TokenEffectKind, nonce: string) => Promise<TokenNonceEvidence>;
/** Called while the shared account custody lock is held. Only reservations without a durable signed-effect marker may be reclaimed. */
export declare class UniswapTokenNonceStore extends SecureStateStore {
    occupied(accountValue: string): Promise<readonly bigint[]>;
    reconcile(accountValue: string, evidence: Evidence): Promise<void>;
    allocate(op: UniswapTokenOperation, kind: TokenEffectKind, pending: bigint, occupied?: readonly bigint[]): Promise<string>;
    release(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<boolean>;
    commit(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    private path;
}
export {};
