import { BASE_USDC } from "./constants.js";
import { ApnError } from "./errors.js";
import { checkEvmTransferFunding } from "./evm-transfer-approval.js";
import { parseAtomic } from "./money.js";
import type { Economics, Hex, OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
import { requireFunding, validateBalance, validateEconomics } from "./transfer-policy.js";

export async function checkTransferApproval(
  rpc: RpcPort,
  operation: OperationRecord & { readonly economics: Economics; readonly transactionData: Hex },
  failBeforeEffect: (reason: string) => Promise<never>,
  stateRoot?: string,
): Promise<void> {
  if (operation.evm !== undefined) {
    try { await checkEvmTransferFunding(rpc, operation, true, stateRoot); }
    catch (error) {
      if (error instanceof ApnError && error.code === "APN_REPREPARE_REQUIRED") await failBeforeEffect("fee_or_nonce_changed");
      throw error;
    }
    return;
  }
  await rpc.assertBaseChain();
  const [balances, nonceAtomic, currentFees] = await Promise.all([
    rpc.getBalances(operation.walletAddress),
    rpc.getPendingNonce(operation.walletAddress),
    rpc.estimateDirectTransfer({ from: operation.walletAddress, to: BASE_USDC, data: operation.transactionData }),
  ]);
  validateBalance(balances, operation.walletAddress);
  if (parseAtomic(nonceAtomic).toString() !== operation.economics.nonceAtomic) await failBeforeEffect("pending_nonce_changed");
  try { requireFunding(balances, operation.amountAtomic, operation.economics.maximumGasCostAtomic); }
  catch (error) {
    if (error instanceof ApnError && ["APN_INSUFFICIENT_USDC", "APN_INSUFFICIENT_GAS"].includes(error.code)) await failBeforeEffect("funding_changed");
    throw error;
  }
  const fresh = validateEconomics(nonceAtomic, currentFees);
  if (fresh.gasLimitAtomic !== operation.economics.gasLimitAtomic ||
      fresh.maxFeePerGasAtomic !== operation.economics.maxFeePerGasAtomic ||
      fresh.maxPriorityFeePerGasAtomic !== operation.economics.maxPriorityFeePerGasAtomic) await failBeforeEffect("fee_economics_changed");
}
