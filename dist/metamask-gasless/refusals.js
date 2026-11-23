import { ApnError } from "../errors.js";
import { directEvmNetwork } from "../evm-direct-networks.js";
import { formatAtomic } from "../money.js";
import { MM_REASON_CODES } from "./reasons.js";
import { mmRegistry, mmTokenSymbol } from "./registry.js";
/**
 * Economic refusals stated with both amounts in the transfer token's atoms and at its own decimal scale, the network,
 * and what set the limit. `token` is the request's token field: needed only on a chain with several tokens.
 */
function tokenUnits(chainId, token) {
    const row = mmRegistry(chainId, token).row, symbol = mmTokenSymbol(row.token);
    return { symbol, decimal: (atoms) => formatAtomic(atoms.toString(), row.decimals),
        atoms: (atoms) => `${atoms} ${symbol} atoms (${formatAtomic(atoms.toString(), row.decimals)} ${symbol})` };
}
const where = (chainId) => `on ${directEvmNetwork(chainId).name} (chain ${chainId})`;
/** The server wallet's token balance, on APN's own validated `balanceOf` read, below the net amount plus the quoted fee. */
export function mmUsdcShortfallMessage(chainId, current, required, read, token) {
    const units = tokenUnits(chainId, token);
    return `The MetaMask server wallet ${where(chainId)} holds ${units.atoms(current)}, below the ${units.atoms(required)} this transfer plus ` +
        `MetaMask's quoted ${units.symbol} relay fee needs (APN's own balanceOf read ${read}).`;
}
export function mmUsdcShortfall(chainId, current, required, read, facts, token) {
    return new ApnError(MM_REASON_CODES.mm_gasless_balance, mmUsdcShortfallMessage(chainId, current, required, read, token), {
        reason: "mm_gasless_balance", chain_id: chainId, network: directEvmNetwork(chainId).name,
        usdc_current_atomic: current.toString(), usdc_required_atomic: required.toString(), ...facts
    });
}
/**
 * The owner's fee cap is the lower of the fee ceiling and the room the amounts leave (gross minus the recipient floor);
 * the refusal names whichever set it, in the request's own mode.
 */
export function mmFeeCapRefusal(request, fee, cap) {
    const ceiling = BigInt(request.maxFeeAtomic), room = BigInt(request.grossAtomic) - BigInt(request.minReceivedAtomic);
    const option = request.fixedNet ? (ceiling <= room ? "--max-fee-atomic" : "--max-gross-atomic minus --net-amount-atomic")
        : ceiling <= room ? "--max-fee" : "--amount minus --min-received";
    const units = tokenUnits(request.chainId, request.token);
    return new ApnError(MM_REASON_CODES.mm_gasless_fee_cap, `MetaMask quoted a ${units.symbol} relay fee of ${units.atoms(fee)} for this transfer ` +
        `${where(request.chainId)}, above the owner's fee cap of ${units.atoms(cap)} set by ${option}.`, {
        reason: "mm_gasless_fee_cap", chain_id: request.chainId, network: directEvmNetwork(request.chainId).name,
        fee_atomic: fee.toString(), fee_cap_atomic: cap.toString(), fee_cap_option: option
    });
}
/** Prepare-time next action: a higher cap, only if the owner accepts the quoted fee; the same prepare may then run. */
export function mmFeeCapNextAction(request, fee) {
    const units = tokenUnits(request.chainId, request.token);
    const raise = request.fixedNet
        ? `--max-fee-atomic of at least ${fee} and --max-gross-atomic of at least ${BigInt(request.fixedNet.netAtomic) + fee}`
        : `--max-fee of at least ${units.decimal(fee)} and --amount minus --min-received of at least ${units.decimal(fee)}`;
    return `No operation was written and nothing was sent. Only if the owner accepts a relay fee of ${units.atoms(fee)}, rerun the ` +
        `same prepare with ${raise}; the fee is quoted again then.`;
}
//# sourceMappingURL=refusals.js.map