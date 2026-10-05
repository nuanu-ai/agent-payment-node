import type { Address, Hex } from "../model.js";
import { type Permit2ProductionRecord } from "./production-repository.js";
import { type Permit2ProductionSigned } from "./production-signed.js";
/** Strict projection from a future trusted read adapter; no RPC or finality claim at this boundary. */
export interface Permit2DirectTransactionInput {
    readonly chainId: "0xa86a";
    readonly to: Address;
    readonly value: "0x0";
    readonly input: Hex;
    readonly hash: Hex;
    readonly blockHash: Hex;
    readonly blockNumber: string;
}
export interface Permit2DirectAttribution {
    readonly source: "pinned-direct-proxy-canonical-abi.v1";
    readonly operationDigest: string;
    readonly headerHash: string;
    readonly calldataHash: Hex;
    readonly transactionHash: Hex;
    readonly blockHash: Hex;
    readonly blockNumber: string;
    readonly proxy: Address;
    readonly proxyCodeHash: Hex;
    readonly settledEvent: "Settled" | "SettledWithPermit";
    readonly settledTopic: Hex;
    readonly transfer: {
        readonly token: Address;
        readonly from: Address;
        readonly to: Address;
        readonly amountAtomic: string;
    };
    /** The source catches token.permit failures; even successful settlement does not prove token approval succeeded. */
    readonly tokenPermitOutcome: "not_requested" | "not_proven";
}
export declare function encodePermit2ProductionProxyCall(record: Permit2ProductionRecord, value: unknown): Promise<Hex>;
/** Binds all calldata bytes to the saved signatures/plan. Unknown batchers and builder suffixes refuse. */
export declare function attributePermit2DirectTransaction(record: Permit2ProductionRecord, signed: Permit2ProductionSigned, value: unknown): Promise<Permit2DirectAttribution>;
export declare function permit2FactHash(value: unknown): value is Hex;
export declare function permit2FactQuantity(value: unknown): value is string;
