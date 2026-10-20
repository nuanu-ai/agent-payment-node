import { type Hex } from "viem";
import type { EvmRpcCall } from "../../evm-ports.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { StateStore } from "../../state.js";
import { UniswapTokenEffectJournal } from "./token-effects.js";
import type { TokenEffectKind, TokenSealedEffect } from "./token-execution.js";
import { type UniswapTokenOperation } from "./token-operation.js";
export interface TokenTransactionEnvelope {
    readonly chainId: 1;
    readonly from: string;
    readonly to: string;
    readonly data: Hex;
    readonly value: "0";
    readonly nonce: string;
    readonly gasLimit: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
}
/** Local encrypted-wallet custody plus the durable one-way broadcast boundary. */
export declare class UniswapTokenCustody {
    private readonly state;
    private readonly call;
    private readonly now;
    private readonly effects;
    private readonly wallets;
    private readonly nonces;
    private readonly operations;
    constructor(state: StateStore, wrapping: WrappingSecretPort, call: EvmRpcCall, now: () => Date, effects?: UniswapTokenEffectJournal);
    withAccountLock<T>(op: UniswapTokenOperation, work: () => Promise<T>): Promise<T>;
    private assertOwner;
    allocateNonce(op: UniswapTokenOperation, kind: TokenEffectKind): Promise<string>;
    /**
     * True when custody holds no signed bytes for the effect and its reservation is free; false when a signed effect committed
     * it, found now or committed earlier (a committed reservation counts as signed even when its bytes are not here).
     */
    releaseNonce(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<boolean>;
    commitNonce(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    private reconcileNonceReservations;
    /**
     * The allowance at the latest block. With `landed` (a transaction of this account that landed, e.g. the approval), one node
     * first shows its head and that transaction at or below it, and the read is then pinned to that head by hash (EIP-1898,
     * requireCanonical): a node behind the transaction's block would answer the allowance from before it, so it is refused.
     */
    currentAllowance(op: UniswapTokenOperation, landed?: string): Promise<string>;
    seal(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect>;
    private sealUnlocked;
    probeSealed(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect | null>;
    send(op: UniswapTokenOperation, kind: TokenEffectKind): Promise<"accepted" | "ambiguous">;
    private sendUnlocked;
    /** Recovery reads only the public signed-effect journal; it never opens custody. */
    probeJournaled(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect | null>;
    bindEffectProvider(op: UniswapTokenOperation, kind: TokenEffectKind, hash: string): Promise<void>;
    private bindProvider;
}
export declare function envelopeOf(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): TokenTransactionEnvelope;
