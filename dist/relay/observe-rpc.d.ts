/** Bounded, keyless JSON-RPC adapters. Every batchCall here is one physical POST. */
import type { Hex } from "viem";
import { HttpsBaseRpc } from "../rpc.js";
import type { RelayDepositObservation } from "./deposit-effect.js";
import type { RelayBnbProofPorts, RelayBnbBlock, RelayBnbReceipt, RelayBnbTransaction } from "./destination-proof.js";
import type { RelaySourceFinalityPorts } from "./observe.js";
export declare class RelayEthereumFinalityRpc implements RelaySourceFinalityPorts {
    private readonly rpc;
    private lastStart;
    private pending;
    constructor(url: string, rpc?: HttpsBaseRpc);
    private read;
    finalizedDeposit(hash: Hex): Promise<RelayDepositObservation | null>;
}
export declare class RelayBnbReadOnlyRpc implements RelayBnbProofPorts {
    private readonly rpc;
    private posts;
    private lastStart;
    private pending;
    constructor(url: string, rpc?: HttpsBaseRpc);
    get physicalPosts(): number;
    private read;
    private readSerial;
    chainId(): Promise<number>;
    transaction(hash: string): Promise<RelayBnbTransaction | null>;
    receipt(hash: string): Promise<RelayBnbReceipt | null>;
    block(number: bigint): Promise<RelayBnbBlock | null>;
    finalityCheckpoint(): Promise<RelayBnbBlock | null>;
    nativeTrace(): Promise<null>;
}
