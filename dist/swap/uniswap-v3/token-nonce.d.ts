import { SecureStateStore } from "../../secure-state-store.js";
import type { TokenEffectKind } from "./token-execution.js";
import { type UniswapTokenOperation } from "./token-operation.js";
export type TokenNonceEvidence = "reserved" | "committed" | null;
type Evidence = (operationId: string, kind: TokenEffectKind, nonce: string) => Promise<TokenNonceEvidence>;
/** Where one lane keeps its nonce reservations: the directory and the hash domain of each account's file. */
export interface TokenNonceSpace {
    readonly directory: string;
    readonly accountDomain: string;
}
/** The Ethereum lane's reservations, where every earlier release kept them. */
export declare const ETHEREUM_TOKEN_NONCE_SPACE: TokenNonceSpace;
/** BNB Smart Chain's own reservations: a chain-56 nonce never excludes a chain-1 nonce of the same account, nor the reverse. */
export declare const BNB_TOKEN_NONCE_SPACE: TokenNonceSpace;
/**
 * Called while the shared account custody lock is held. Only reservations without a durable signed-effect marker may be
 * reclaimed. One store per lane's nonce space.
 */
export declare class UniswapTokenLaneNonceStore extends SecureStateStore {
    private readonly space;
    constructor(root: string, space: TokenNonceSpace, options?: ConstructorParameters<typeof SecureStateStore>[1]);
    occupied(accountValue: string): Promise<readonly bigint[]>;
    reconcile(accountValue: string, evidence: Evidence): Promise<void>;
    allocate(op: UniswapTokenOperation, kind: TokenEffectKind, pending: bigint, occupied?: readonly bigint[]): Promise<string>;
    /** True when the effect's slot holds no reservation afterwards (released now, or none); false when a committed (signed) one keeps it. */
    release(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<boolean>;
    commit(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    private path;
}
/** The Ethereum lane's nonce store. */
export declare class UniswapTokenNonceStore extends UniswapTokenLaneNonceStore {
    constructor(root: string, options?: ConstructorParameters<typeof SecureStateStore>[1]);
}
export {};
