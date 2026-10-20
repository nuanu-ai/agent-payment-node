import { ApnError } from "../errors.js";
import { directEvmNetwork } from "../evm-direct-networks.js";
import { formatAtomic } from "../money.js";
import type { MetaMaskGaslessChainId, MetaMaskGaslessRequest } from "./model.js";
import { MM_REASON_CODES } from "./reasons.js";

/** Economic refusals stated with both amounts in USDC atoms and USDC, the network, and what set the limit. */
const usdc = (atoms: bigint | string) => `${atoms} USDC atoms (${formatAtomic(atoms.toString(), 6)} USDC)`;
const where = (chainId: MetaMaskGaslessChainId) => `on ${directEvmNetwork(chainId).name} (chain ${chainId})`;

/** The server wallet's USDC, on APN's own validated `balanceOf` read, below the net amount plus the quoted fee. */
export function mmUsdcShortfallMessage(chainId: MetaMaskGaslessChainId, current: bigint | string, required: bigint | string,
  read: string): string {
  return `The MetaMask server wallet ${where(chainId)} holds ${usdc(current)}, below the ${usdc(required)} this transfer plus ` +
    `MetaMask's quoted USDC relay fee needs (APN's own balanceOf read ${read}).`;
}
export function mmUsdcShortfall(chainId: MetaMaskGaslessChainId, current: bigint, required: bigint, read: string,
  facts: Readonly<Record<string, string | number>>): ApnError {
  return new ApnError(MM_REASON_CODES.mm_gasless_balance, mmUsdcShortfallMessage(chainId, current, required, read), {
    reason: "mm_gasless_balance", chain_id: chainId, network: directEvmNetwork(chainId).name,
    usdc_current_atomic: current.toString(), usdc_required_atomic: required.toString(), ...facts });
}

/**
 * The owner's fee cap is the lower of the fee ceiling and the room the amounts leave (gross minus the recipient floor);
 * the refusal names whichever set it, in the request's own mode.
 */
export function mmFeeCapRefusal(request: MetaMaskGaslessRequest, fee: bigint, cap: bigint): ApnError {
  const ceiling = BigInt(request.maxFeeAtomic), room = BigInt(request.grossAtomic) - BigInt(request.minReceivedAtomic);
  const option = request.fixedNet ? (ceiling <= room ? "--max-fee-atomic" : "--max-gross-atomic minus --net-amount-atomic")
    : ceiling <= room ? "--max-fee" : "--amount minus --min-received";
  return new ApnError(MM_REASON_CODES.mm_gasless_fee_cap, `MetaMask quoted a USDC relay fee of ${usdc(fee)} for this transfer ` +
    `${where(request.chainId)}, above the owner's fee cap of ${usdc(cap)} set by ${option}.`, {
    reason: "mm_gasless_fee_cap", chain_id: request.chainId, network: directEvmNetwork(request.chainId).name,
    fee_atomic: fee.toString(), fee_cap_atomic: cap.toString(), fee_cap_option: option });
}

/** Prepare-time next action: a higher cap, only if the owner accepts the quoted fee; the same prepare may then run. */
export function mmFeeCapNextAction(request: MetaMaskGaslessRequest, fee: bigint): string {
  const raise = request.fixedNet
    ? `--max-fee-atomic of at least ${fee} and --max-gross-atomic of at least ${BigInt(request.fixedNet.netAtomic) + fee}`
    : `--max-fee of at least ${formatAtomic(fee.toString(), 6)} and --amount minus --min-received of at least ${formatAtomic(fee.toString(), 6)}`;
  return `No operation was written and nothing was sent. Only if the owner accepts a relay fee of ${usdc(fee)}, rerun the ` +
    `same prepare with ${raise}; the fee is quoted again then.`;
}
