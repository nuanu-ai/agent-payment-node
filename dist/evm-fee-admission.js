export function evmFrozenFeeAdmitted(baseFeePerGasWei, envelope) {
    const { maxFeePerGasWei: maxFee, maxPriorityFeePerGasWei: priority } = envelope;
    if (baseFeePerGasWei < 0n || priority < 0n || maxFee <= 0n || priority > maxFee)
        return false;
    return baseFeePerGasWei + priority <= maxFee;
}
//# sourceMappingURL=evm-fee-admission.js.map