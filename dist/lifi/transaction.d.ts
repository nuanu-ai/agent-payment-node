import type { Address, Hex } from "../model.js";
import type { BridgeEnvelope, BridgeProtocolReceipt } from "./model.js";
export declare function approvalData(spender: Address, amount: string): Hex;
export declare function approvalIncluded(receipt: BridgeProtocolReceipt, token: Address, owner: Address, spender: Address, amount: string): void;
/** Only validation is exported; custody owns the one operation-bound signing entry. */
export declare function verifyBridgeSigned(raw: Hex, expectedHash: Hex, e: BridgeEnvelope): Promise<void>;
