/**
 * One send-time fee admission rule for a frozen EIP-1559 envelope.
 *
 * The spend bound is the envelope's own signed `gas × maxFeePerGas`, which the owner approves at consent
 * against the operation's network-fee ceiling. A fresh `2 × base + tip` estimate is not a spend bound, so
 * comparing it with the frozen maximum refuses a still-includable envelope whenever the base fee rises.
 * The only question at send time is whether the frozen envelope can be included now: the current base fee
 * plus the envelope's own priority fee must fit under its signed maximum fee per gas.
 */
export interface EvmFrozenFeeEnvelope {
    readonly maxFeePerGasWei: bigint;
    readonly maxPriorityFeePerGasWei: bigint;
}
export declare function evmFrozenFeeAdmitted(baseFeePerGasWei: bigint, envelope: EvmFrozenFeeEnvelope): boolean;
