import { type GaslessTransport } from "../gasless/https.js";
import type { GaslessBlock } from "../gasless/model.js";
import type { Address, Hex } from "../model.js";
export interface FacilitatorEvidence {
    readonly transactionHash: Hex;
    readonly block: GaslessBlock;
    readonly finalized: GaslessBlock;
    readonly receiptHash: string;
    readonly deliveredAtomic: string;
}
export interface FacilitatorTransferQuery {
    readonly transactionHash: Hex;
    readonly owner: Address;
    readonly recipient: Address;
    readonly amountAtomic: string;
    readonly nonce: Hex;
}
export interface FacilitatorRpcPort {
    readonly rpcOrigin: string;
    readonly rpcEndpointHash: string;
    assertChain(): Promise<void>;
    finalized(): Promise<GaslessBlock>;
    usdcBalance(owner: Address, block: GaslessBlock): Promise<bigint>;
    authorizationUsed(owner: Address, nonce: Hex, block: GaslessBlock): Promise<boolean>;
    /** A unique log transaction hash, null when absent, or "ambiguous"; the scan stops once blocks reach `validBefore`. */
    findAuthorizationLog(owner: Address, nonce: Hex, from: GaslessBlock, to: GaslessBlock, validBefore: bigint): Promise<Hex | null | "ambiguous">;
    /** Evidence only for a finalized successful receipt with the exact authorization and transfer; otherwise null. */
    settledTransfer(query: FacilitatorTransferQuery): Promise<FacilitatorEvidence | null>;
}
export declare function avalancheFacilitatorRpc(environment: Readonly<Record<string, string | undefined>>, transport?: GaslessTransport): FacilitatorRpcPort;
export declare class AvalancheFacilitatorRpc implements FacilitatorRpcPort {
    private readonly transport;
    readonly rpcOrigin: string;
    readonly rpcEndpointHash: string;
    private readonly endpoint;
    private sequence;
    private readonly call;
    constructor(rpcUrl: string, transport?: GaslessTransport);
    assertChain(): Promise<void>;
    finalized(): Promise<GaslessBlock>;
    usdcBalance(owner: Address, block: GaslessBlock): Promise<bigint>;
    authorizationUsed(owner: Address, nonce: Hex, block: GaslessBlock): Promise<boolean>;
    findAuthorizationLog(owner: Address, nonce: Hex, from: GaslessBlock, to: GaslessBlock, validBefore: bigint): Promise<Hex | null | "ambiguous">;
    settledTransfer(query: FacilitatorTransferQuery): Promise<FacilitatorEvidence | null>;
    private request;
}
