import type { EvmRpcCall } from "../../evm-ports.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { StateStore } from "../../state.js";
import type { TokenEffectKind } from "./token-execution.js";
import type { UniswapTokenMaterial } from "./token-material.js";
import type { UniswapTokenOperation } from "./token-operation.js";
import type { UniswapTokenUsage } from "./token-usage.js";
export declare class UniswapTokenSigningGuard {
    private readonly state;
    private readonly call;
    private readonly usage;
    private readonly now;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort, call: EvmRpcCall, usage: UniswapTokenUsage, now: () => Date);
    confirm(material: UniswapTokenMaterial): Promise<void>;
    inspect(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
    private common;
    private wallet;
}
