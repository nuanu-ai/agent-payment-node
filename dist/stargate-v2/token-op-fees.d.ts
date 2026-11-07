import { type Hex } from "viem";
import { type EvmActualFee } from "../evm-direct-actual-fee.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { StargateTokenConfirmedReceipt, StargateTokenEnvelope, StargateTokenOpStackFee, StargateTokenOpStackFees, StargateTokenOperation } from "./token-model.js";
type PinnedBlock = Readonly<{
    numberAtomic: string;
    hash: Hex;
}>;
/** The exact unsigned EIP-1559 bytes the custody signer signs for this envelope: the oracle's `_unsignedTxSize`. */
export declare function unsignedEnvelopeBytes(e: StargateTokenEnvelope): bigint;
/** The L1 data fee plus operator fee upper bound of one envelope; an absent envelope (no approval) adds nothing. */
export declare function opStackFeeOf(fee: StargateTokenOpStackFee | undefined): bigint;
/**
 * OP Mainnet charges every transaction an L1 data fee and an operator fee on top of gas x fee per gas, and the signed
 * fields bound neither. The GasPriceOracle predeploy and ABI that direct transfers use give their upper bounds, read for
 * each frozen envelope at one block pinned by hash (EIP-1898). A failed or malformed read refuses: nothing is assumed zero.
 */
export declare function readStargateOpStackFees(call: EvmRpcCall, block: PinnedBlock, approval: StargateTokenEnvelope | undefined, bridge: StargateTokenEnvelope): Promise<StargateTokenOpStackFees>;
/**
 * Stored bounds bind their envelopes: read at the pinned block for at least each envelope's unsigned bytes and gas limit
 * (both bounds rise with them), with exactly one row per frozen envelope and an exact total.
 */
export declare function validateStargateOpStackFees(value: unknown, block: PinnedBlock, approval: StargateTokenEnvelope | undefined, bridge: StargateTokenEnvelope): StargateTokenOpStackFees;
/** The approval's actual fee from its own safe receipt, only when the receipt carries every part of OP Mainnet's charge. */
export declare function approvalActualFee(op: StargateTokenOperation, receipt: StargateTokenConfirmedReceipt): EvmActualFee | undefined;
/**
 * What a sent approval costs the owner's cap: its actual fee once its safe receipt proved every part, otherwise its gas
 * limit at the signed max fee plus the larger of its prepare and approval-marker L1 data and operator fee bounds. A v6
 * record always has the prepare bound; with no bound at all the bridge is refused, never charged zero.
 */
export declare function approvalNativeCharge(op: StargateTokenOperation): bigint;
/** The approval fee evidence of a v6 record binds its own approval: marker bounds for both envelopes, a complete own-receipt fee. */
export declare function validateApprovalFeeEvidence(op: StargateTokenOperation): void;
export {};
