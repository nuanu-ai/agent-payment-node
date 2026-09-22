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
    allocateNonce(op: UniswapTokenOperation, kind: TokenEffectKind): Promise<string>;
    releaseNonce(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    commitNonce(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    private reconcileNonceReservations;
    currentAllowance(op: UniswapTokenOperation): Promise<string>;
    seal(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect>;
    private sealUnlocked;
    probeSealed(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect | null>;
    send(op: UniswapTokenOperation, kind: TokenEffectKind): Promise<"accepted" | "ambiguous">;
    private sendUnlocked;
}
export declare function envelopeOf(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): TokenTransactionEnvelope;
