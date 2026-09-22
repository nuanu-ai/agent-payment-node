import { SecureStateStore } from "../../secure-state-store.js";
import type { TokenEffectKind } from "./token-execution.js";
import type { UniswapTokenOperation } from "./token-operation.js";
type Durable = (operationId: string, kind: TokenEffectKind) => Promise<boolean>;
/** Called while the shared account custody lock is held. Only reservations without a durable signed-effect marker may be reclaimed. */
export declare class UniswapTokenNonceStore extends SecureStateStore {
    allocate(op: UniswapTokenOperation, kind: TokenEffectKind, pending: bigint, durable: Durable, occupied?: readonly bigint[]): Promise<string>;
    release(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string, durable: Durable): Promise<boolean>;
    commit(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    private path;
}
export {};
