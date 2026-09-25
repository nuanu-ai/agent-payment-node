/** Bounded, keyless JSON-RPC adapters. Every batchCall here is one physical POST. */
import type { Hex } from "viem";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
import type { RelayDepositObservation } from "./deposit-effect.js";
import type { RelayBnbProofPorts, RelayBnbBlock, RelayBnbReceipt, RelayBnbTransaction } from "./destination-proof.js";
import type { RelaySourceFinalityPorts } from "./observe.js";
export declare class RelayEthereumFinalityRpc implements RelaySourceFinalityPorts {
    private readonly url;
    private readonly guardFactory;
    private readonly rpc;
    constructor(url: string, state: StateStore, rpc?: HttpsBaseRpc, guardFactory?: () => EvmDirectRpcGuard);
    private read;
    finalizedDeposit(hash: Hex): Promise<RelayDepositObservation | null>;
}
export declare class RelayBnbReadOnlyRpc implements RelayBnbProofPorts {
    private readonly url;
    private readonly rpc;
    private readonly guard;
    constructor(url: string, state: StateStore, rpc?: HttpsBaseRpc, guard?: EvmDirectRpcGuard);
    get physicalPosts(): number;
    private read;
    chainId(): Promise<number>;
    transaction(hash: string): Promise<RelayBnbTransaction | null>;
    receipt(hash: string): Promise<RelayBnbReceipt | null>;
    block(number: bigint): Promise<RelayBnbBlock | null>;
    finalityCheckpoint(): Promise<RelayBnbBlock | null>;
    nativeTrace(): Promise<null>;
}
