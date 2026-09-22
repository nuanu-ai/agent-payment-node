import { SecureStateStore } from "../../secure-state-store.js";
import type { TokenEffectKind } from "./token-execution.js";
import type { UniswapTokenOperation } from "./token-operation.js";
/** Called while the shared account custody lock is held. Gaps are safe; reuse is forbidden. */
export declare class UniswapTokenNonceStore extends SecureStateStore {
    allocate(op: UniswapTokenOperation, kind: TokenEffectKind, pending: bigint): Promise<string>;
    private path;
}
