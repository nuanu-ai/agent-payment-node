import { chainDisplay } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import type { GuardedSwapApprovalIntent } from "../runtime.js";
import { assertSwapMaterialMatchesIntent, requiredDisplay as required } from "../tty-consent.js";
import { UNISWAP_ROUTER } from "../uniswap-pin.js";
import type { SavedUniswapQuoteStore } from "./material.js";
import { uniswapV3Pair } from "./pins.js";

/** The exact foreground screen for one guarded Uniswap swap (consent: TtyGuardedSwapApproval "uniswap"). */
export async function uniswapApprovalScreen(quotes: Pick<SavedUniswapQuoteStore, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]> {
  const material = await quotes.load(intent.quoteHash);
  if (material === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared swap quote was not found.");
  const quote = material.quote, pool = material.execution.evidence.pool, pair = uniswapV3Pair(quote.destinationAsset.identifier!);
  assertSwapMaterialMatchesIntent(material, intent, { deadline: false });
  const gas = intent.gasOrEnergy, deadline = Math.floor(Date.parse(intent.deadline) / 1000);
  return [
    "Agent Payment Node guarded swap approval: Ethereum mainnet (eip155:1), Uniswap V3, keyless",
    `Profile: ${intent.profile}`, `Operation: ${intent.operationId}`, `Signer (local wallet, non-custodial): ${intent.account}`,
    `You send: ${chainDisplay(intent.inputAmountAtomic, 18)} ETH (${intent.inputAmountAtomic} wei), native, exact input`,
    `Recipient of ${pair.outputSymbol}: ${intent.recipient}`,
    `Expected in: ${chainDisplay(intent.expectedOutputAtomic, pair.outputDecimals)} ${pair.outputSymbol} (${intent.expectedOutputAtomic} atomic, QuoterV2 at block ${quote.simulation.blockNumber})`,
    `Minimum in: ${chainDisplay(intent.minimumOutputAtomic, pair.outputDecimals)} ${pair.outputSymbol} (${intent.minimumOutputAtomic} atomic); the router reverts below this`,
    `Slippage cap: ${intent.slippageBps} basis points`,
    `Price impact vs pool spot after the ${pool.fee / 10_000}% LP fee: ${pool.priceImpactBps} basis points`,
    `Pool: ${pool.pool} (WETH/${pair.outputSymbol}, fee tier ${pool.fee}); router: Universal Router 2.2.0 ${UNISWAP_ROUTER}`,
    `Gas limit: ${gas.gasLimit}; max fee per gas: ${gas.maxFeePerGas} wei; max priority fee per gas: ${gas.maxPriorityFeePerGas} wei`,
    `Maximum network fee: ${chainDisplay(required(gas, "maximumGasCostWei"), 18)} ETH (${required(gas, "maximumGasCostWei")} wei)`,
    `Token approval cap: ${material.approvalCapAtomic} (native ETH input needs no ERC20 or Permit2 allowance)`,
    `Deadline: ${intent.deadline} (unix ${deadline})`,
    `Quote: ${intent.quoteHash}`, `Policy: ${intent.policyDigest}`, `Mechanism: ${intent.mechanismDigest}`,
    "APN signs locally and sends exactly once. After that attempt, status only observes this exact transaction.",
  ];
}
